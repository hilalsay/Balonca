// Grammar (sentence parsing) and speech for the reading mode, through the Python worker in nlp.py (spaCy + Piper).
//   POST /api/parse  {lang, sents: [...]}  -> {docs: [[token...]...]}   (see nlp.py for the token shape)
//   GET  /api/tts?lang=nl&text=...         -> audio/wav, cached on disk
//   GET  /api/nlp                          -> {parse: [langs], tts: [langs]}
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ApiError, LANG_RE } from './lib.mjs';
import { readBody } from './translate.mjs';

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
    c.stderr?.on('data', (d) => { const s = String(d).trim(); if (s) console.error(`[nlp] ${s.slice(0, 500)}`); });
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
    c.on('error', (e) => { console.error(`[nlp] ${e.message}`); fail(); });
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
  const sents = b.sents.map((s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NLP_LIMITS.chars));
  if (sents.some((s) => !s) || sents.join('').length > NLP_LIMITS.total) throw new ApiError(400, 'bad-request');
  return { lang, sents };
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};

export function createParseHandler({ worker, info, cacheSize = 3000 }) {
  const cache = new Map(); // `${lang}\n${sentence}` -> tokens
  return async function parseRoute(req, res) {
    const { lang, sents } = parseParseRequest(await readBody(req, 64_000));
    if (!(await info()).parse.includes(lang)) throw new ApiError(422, 'unsupported-lang');
    const keys = sents.map((s) => `${lang}\n${s}`);
    const todo = [...new Set(keys.filter((k) => !cache.has(k)))];
    if (todo.length) {
      const r = await worker.call({ op: 'parse', lang, sents: todo.map((k) => k.slice(lang.length + 1)) });
      todo.forEach((k, i) => {
        cache.set(k, r.docs?.[i] ?? []);
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
      });
    }
    json(res, 200, { docs: keys.map((k) => cache.get(k)) }, { 'cache-control': 'no-store' });
  };
}

/** Validates GET /api/tts. */
export function parseTtsQuery(url) {
  const lang = String(url.searchParams.get('lang') ?? '').toLowerCase();
  const text = String(url.searchParams.get('text') ?? '').replace(/\s+/g, ' ').trim();
  if (!LANG_RE.test(lang) || !text || text.length > NLP_LIMITS.chars) throw new ApiError(400, 'bad-request');
  return { lang, text };
}

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

export function createTtsHandler({ worker, info, cacheDir, maxCacheBytes = 1_500_000_000 }) {
  let writes = 0;
  const inflight = new Map(); // one synthesis per sentence, however many ask at once
  const ready = mkdir(cacheDir, { recursive: true });
  void ready.then(() => pruneDir(cacheDir, maxCacheBytes));
  return async function ttsRoute(req, res, url) {
    const { lang, text } = parseTtsQuery(url);
    const voices = (await info()).tts;
    if (!voices.includes(lang)) throw new ApiError(422, 'unsupported-lang');
    await ready;
    const file = path.join(cacheDir, `${createHash('sha256').update(JSON.stringify(['v1', lang, text])).digest('hex').slice(0, 32)}.wav`);
    let st = await stat(file).catch(() => null);
    if (!st) {
      if (!inflight.has(file)) {
        inflight.set(file, worker.call({ op: 'tts', lang, text, out: file }).finally(() => inflight.delete(file)));
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
      'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff',
      ...(status === 206 ? { 'content-range': `bytes ${from}-${to}/${st.size}` } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start: from, end: to }).pipe(res);
  };
}
