// Grammar (sentence parsing) and speech for the reading mode, through the Python worker in nlp.py (spaCy + Piper).
//   POST /api/parse  {lang, ref, sents: [...], explain?, ui?}  -> {docs: [[token...]...], grammar?}   (see nlp.py for tokens)
//                    explain: the first sentence is the one the reader opened; with GRAMMAR_ENGINE=model it may get
//                    the model's labels: grammar = {source: 'model', answer} | {source: 'parser'} (server/grammar.mjs)
//   GET  /api/tts?lang=nl&word=huis                 one word
//   GET  /api/tts?lang=nl&lib=<id>&text=...         a sentence of a library text (must be in it)
//   GET  /api/tts?lang=nl&wordId=<id>               the sentence a saved word came from
//                                                   -> audio/wav, cached on disk
// Sentences are never taken from the browser alone (phase 2): they must be found in the named source (sources.mjs).
//   GET  /api/nlp                          -> {parse: [langs], tts: [langs]}
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ApiError, LANG_RE } from './lib.mjs';
import { readBody } from './translate.mjs';
import { logError } from './redact.mjs';
import { windowCounter } from './limits.mjs';
import { norm, parseRef } from './sources.mjs';
import { WORD_RE } from './define.mjs';
import { markFromDictionary } from './gen/shared.mjs';
export { windowCounter };

export const NLP_LIMITS = { sents: 80, chars: 600, total: 24_000, queue: 40 };

/**
 * A long-lived Python process answering one JSON line per request, in order. Started on first use and again after
 * it dies (at most `maxRestarts` times in ten minutes, so a broken install does not spin).
 */
export function pyWorker({ python, script, args = [], env = {}, spawnImpl = spawn, timeoutMs = 60_000, maxRestarts = 5, now = Date.now }) {
  let child = null, seq = 0;
  const pending = new Map();
  const restarts = [];
  const start = () => {
    const t = now();
    while (restarts.length && t - restarts[0] > 600_000) restarts.shift();
    if (restarts.length >= maxRestarts) throw new ApiError(503, 'nlp-unavailable');
    restarts.push(t);
    const c = spawnImpl(python, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    // Only the last line (the error), never more: a traceback can quote the text being processed.
    c.stderr?.on('data', (d) => { const s = String(d).trim().split('\n').pop() ?? ''; if (s) logError(`[nlp] ${s.slice(0, 200)}`); });
    createInterface({ input: c.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg); else p.reject(new ApiError(msg.error === 'unsupported-lang' ? 422 : 502, msg.error ?? 'failed', msg.detail));
    });
    const fail = () => {
      if (child === c) child = null;
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new ApiError(502, 'nlp-crashed')); pending.delete(id); }
    };
    c.on('exit', fail);
    c.on('error', (e) => { logError(`[nlp] ${e.code ?? e.name}`); fail(); });
    c.stdin.on('error', () => {});
    return c;
  };
  return {
    call(msg, ms = timeoutMs) {
      if (pending.size >= NLP_LIMITS.queue) return Promise.reject(new ApiError(503, 'busy'));
      try { child ??= start(); } catch (e) { return Promise.reject(e); }
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new ApiError(504, 'timeout')); }, ms);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ ...msg, id })}\n`);
      });
    },
    close() { child?.kill(); child = null; },
  };
}

/** What the worker can do, asked once (and again after a failure). */
export function nlpInfo(worker) {
  let cached = null;
  return async () => {
    if (cached) return cached;
    try {
      const r = await worker.call({ op: 'info' }, 90_000);
      cached = { parse: r.parse ?? [], tts: r.tts ?? [] };
    } catch { return { parse: [], tts: [] }; }
    return cached;
  };
}

/** Validates the POST /api/parse body. */
export function parseParseRequest(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { throw new ApiError(400, 'bad-request'); }
  const lang = String(b?.lang ?? '').toLowerCase();
  if (!LANG_RE.test(lang) || !Array.isArray(b?.sents) || !b.sents.length || b.sents.length > NLP_LIMITS.sents) throw new ApiError(400, 'bad-request');
  const sents = b.sents.map((s) => norm(s).slice(0, NLP_LIMITS.chars));
  if (sents.some((s) => !s) || sents.join('').length > NLP_LIMITS.total) throw new ApiError(400, 'bad-request');
  const ui = typeof b.ui === 'string' && /^[a-z]{2}$/.test(b.ui) ? b.ui : '';
  return { lang, sents, ref: parseRef(b.ref), explain: b.explain === true, ui };
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};

/**
 * `dictionary(lang, form)`: the phase 3b entry of a lower-case word form (db.dict), or null. The parse then carries
 * the dictionary's verb lemmas and separable particles for the grammar rules (markFromDictionary in grammar.ts).
 */
export function createParseHandler({ worker, info, cacheSize = 3000, sources, dictionary = null, grammar = null }) {
  const cache = new Map(); // `${lang}\n${sentence}` -> tokens
  return async function parseRoute(req, res, ip, user) {
    const { lang, sents, ref, explain, ui } = parseParseRequest(await readBody(req, 64_000));
    if (!(await info()).parse.includes(lang)) throw new ApiError(422, 'unsupported-lang');
    if (!sources) throw new ApiError(404, 'not-found-route');
    for (const s of new Set(sents)) if (!(await sources.contains(ref, user, s))) throw new ApiError(404, 'not-in-source');
    const keys = sents.map((s) => `${lang}\n${s}`);
    const todo = [...new Set(keys.filter((k) => !cache.has(k)))];
    if (todo.length) {
      const r = await worker.call({ op: 'parse', lang, sents: todo.map((k) => k.slice(lang.length + 1)) });
      todo.forEach((k, i) => {
        const doc = r.docs?.[i] ?? [];
        cache.set(k, dictionary && Array.isArray(doc) ? markFromDictionary(doc, lang, (form) => dictionary(lang, form)) : doc);
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      });
    }
    // Only the sentence the reader opened goes to the model (no prefetching of whole texts).
    const g = explain && grammar ? await grammar.explain({ lang, text: sents[0], ref, user, ui }) : null;
    json(res, 200, { docs: keys.map((k) => cache.get(k)), ...(g ? { grammar: g } : {}) }, { 'cache-control': 'no-store' });
  };
}

/** Text that may be read aloud: no control characters, no web or e-mail addresses, at least one letter. */
export function speakable(raw) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(text) ? text : '';
}

/** Validates GET /api/tts: { lang, word } | { lang, ref: {libraryId}, text } | { lang, ref: {wordId} }. */
export function parseTtsQuery(url) {
  const q = url.searchParams;
  const lang = String(q.get('lang') ?? '').toLowerCase();
  if (!LANG_RE.test(lang)) throw new ApiError(400, 'bad-request');
  if (q.has('word')) {
    const word = String(q.get('word')).trim();
    if (!WORD_RE.test(word)) throw new ApiError(400, 'bad-request');
    return { lang, word };
  }
  if (q.has('wordId')) return { lang, ref: parseRef({ wordId: String(q.get('wordId')) }) };
  if (q.has('lib')) {
    const raw = String(q.get('text') ?? '');
    if (raw.length > NLP_LIMITS.chars * 2) throw new ApiError(400, 'bad-request');
    return { lang, ref: parseRef({ libraryId: String(q.get('lib')) }), text: norm(raw) };
  }
  throw new ApiError(400, 'bad-request'); // free text (?text= alone) is no longer read aloud
}

/** The text to speak for a checked query, read from its source. */
async function ttsText(q, sources, user) {
  if (q.word) return q.word;
  if (!sources) throw new ApiError(404, 'not-found-route');
  if (q.ref.wordId) { const w = await sources.savedWord(user, q.ref.wordId); if (!w.ctx) throw new ApiError(404, 'not-in-source'); return w.ctx; }
  if (!q.text || !(await sources.contains(q.ref, user, q.text))) throw new ApiError(404, 'not-in-source');
  return q.text;
}

/** Speech limits per client: cached audio is cheap, new speech costs CPU and disk. Settable through env. */
export const TTS_LIMITS = {
  cachedPerMin: 120, newPer10Min: 60, charsPerDay: 30_000, concurrent: 2,
};

/** Deletes the oldest files once the folder is over `maxBytes`. */
export async function pruneDir(dir, maxBytes) {
  let files = [];
  try {
    files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.wav')).map(async (f) => {
      const s = await stat(path.join(dir, f)); return { f, size: s.size, at: s.mtimeMs };
    }));
  } catch { return; }
  let total = files.reduce((n, x) => n + x.size, 0);
  for (const x of files.sort((a, b) => a.at - b.at)) {
    if (total <= maxBytes) break;
    await unlink(path.join(dir, x.f)).catch(() => {});
    total -= x.size;
  }
}

export function createTtsHandler({ worker, info, cacheDir, maxCacheBytes = 1_500_000_000, limits = {}, now = Date.now, sources }) {
  const L = { ...TTS_LIMITS, ...limits };
  const cachedLimit = windowCounter(60_000, L.cachedPerMin, now);
  const newLimit = windowCounter(600_000, L.newPer10Min, now);
  const charLimit = windowCounter(86_400_000, L.charsPerDay, now);
  const running = new Map(); // client -> syntheses in progress
  // A daily line in the log: how much new speech was made (counts only, never the text or the address).
  let day = { start: now(), n: 0, chars: 0, clients: new Map() };
  const tally = (ip, chars) => {
    if (now() - day.start > 86_400_000) {
      if (day.n) console.log(`[tts] last 24h: ${day.n} new sentences, ${day.chars} characters, ${day.clients.size} clients, most by one client ${Math.max(...day.clients.values())} characters`);
      day = { start: now(), n: 0, chars: 0, clients: new Map() };
    }
    day.n++; day.chars += chars; day.clients.set(ip, (day.clients.get(ip) ?? 0) + chars);
  };
  let writes = 0;
  const inflight = new Map(); // one synthesis per sentence, however many ask at once
  const ready = mkdir(cacheDir, { recursive: true });
  void ready.then(() => pruneDir(cacheDir, maxCacheBytes));
  return async function ttsRoute(req, res, url, ip = '?', user = null) {
    if (!cachedLimit.has(ip)) throw new ApiError(429, 'rate-limit');
    cachedLimit.add(ip);
    const q = parseTtsQuery(url), lang = q.lang;
    const text = speakable(await ttsText(q, sources, user));
    if (!text || text.length > NLP_LIMITS.chars) throw new ApiError(400, 'bad-request');
    const voices = (await info()).tts;
    if (!voices.includes(lang)) throw new ApiError(422, 'unsupported-lang');
    await ready;
    const file = path.join(cacheDir, `${createHash('sha256').update(JSON.stringify(['v1', lang, text])).digest('hex').slice(0, 32)}.wav`);
    let st = await stat(file).catch(() => null);
    if (!st) {
      if (!inflight.has(file)) {
        // New speech: counted per client (sentences per 10 minutes, characters per day, two at a time).
        if (!newLimit.has(ip) || !charLimit.has(ip, text.length) || (running.get(ip) ?? 0) >= L.concurrent) throw new ApiError(429, 'rate-limit');
        newLimit.add(ip); charLimit.add(ip, text.length); tally(ip, text.length);
        running.set(ip, (running.get(ip) ?? 0) + 1);
        inflight.set(file, worker.call({ op: 'tts', lang, text, out: file }).finally(() => {
          inflight.delete(file);
          const r = (running.get(ip) ?? 1) - 1;
          if (r > 0) running.set(ip, r); else running.delete(ip);
        }));
        if (++writes % 300 === 0) void pruneDir(cacheDir, maxCacheBytes);
      }
      await inflight.get(file);
      st = await stat(file);
    }
    // Ranges, because Safari asks for audio in pieces.
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    let from = 0, to = st.size - 1, status = 200;
    if (m && (m[1] || m[2])) {
      from = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      to = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (from > to || from >= st.size) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
    }
    res.writeHead(status, {
      'content-type': 'audio/wav', 'content-length': to - from + 1, 'accept-ranges': 'bytes',
      // Private: no proxy or CDN keeps it, and search engines do not list it.
      'cache-control': 'private, max-age=86400', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff',
      ...(status === 206 ? { 'content-range': `bytes ${from}-${to}/${st.size}` } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start: from, end: to }).pipe(res);
  };
}
