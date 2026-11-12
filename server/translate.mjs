// Subtitle translation through a local Ollama model. Zero dependencies. See README "Automatic translation".
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, LANG_RE } from './lib.mjs';

export const LIMITS = { maxBody: 1_000_000, maxCues: 5000, maxText: 600 };

// ---------------------------------------------------------------------------------------------------------------
// Sentences. Subtitle lines are cut wherever the captioner liked ("Ik graaf naar een verborgen" / "schat. Hoe…"),
// which small models cannot translate line by line without shifting words between lines. So we rebuild real
// sentences first, give each one a time span interpolated from the words it covers, and translate whole sentences.

const SENT_END = /[.!?…。！？]["'”’»)\]]*$/;
const TAG = /^[[(（♪][^\])）]*[\])）♪]?$/; // "[muziek]", "(laughs)", "♪"
const MAX_CHARS = 180; // soft: close at the next line boundary
const HARD_CHARS = 260; // hard: close at the next word
const GAP = 1.5; // seconds of silence that always ends a unit

/**
 * Cues -> sentence units `{start, end, text}`. Sound tags ("[muziek]") stay their own unit. Timing inside a cue is
 * spread evenly over its words, which is close enough for a sentence that starts or ends mid-line.
 */
export function toUnits(cues) {
  const units = [];
  let words = [], start = 0, end = 0, lastEnd = -Infinity;
  const close = () => {
    if (words.length) units.push({ start: round(start), end: round(end), text: words.join(' ') });
    words = [];
  };
  for (const c of cues) {
    const text = String(c.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const cs = Number(c.start) || 0, ce = Math.max(cs, Number(c.end) || cs);
    if (cs - lastEnd > GAP) close();
    if (TAG.test(text)) { close(); units.push({ start: round(cs), end: round(ce), text }); lastEnd = ce; continue; }
    if (words.length && words.join(' ').length >= MAX_CHARS) close(); // a line boundary is a good place to split
    const ws = text.split(' ');
    ws.forEach((w, i) => {
      const ws0 = cs + ((ce - cs) * i) / ws.length, ws1 = cs + ((ce - cs) * (i + 1)) / ws.length;
      if (!words.length) start = ws0;
      words.push(w);
      end = ws1;
      if (SENT_END.test(w) || words.join(' ').length >= HARD_CHARS) close();
    });
    lastEnd = ce;
  }
  close();
  return units;
}
const round = (n) => Math.round(n * 1000) / 1000;

/** Consecutive units grouped into model calls of at most `size` items / `maxChars` characters. */
export function batches(units, size = 8, maxChars = 1200) {
  const out = [];
  let cur = [], chars = 0;
  units.forEach((u, i) => {
    if (cur.length && (cur.length >= size || chars + u.text.length > maxChars)) { out.push(cur); cur = []; chars = 0; }
    cur.push(i);
    chars += u.text.length;
  });
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Ollama

const names = new Intl.DisplayNames(['en'], { type: 'language' });
export const languageName = (code) => {
  try { return names.of(code.replace(/-orig$/i, '')) ?? code; } catch { return code; }
};

export const systemPrompt = (from, to) =>
  `You are a professional subtitle translator from ${from} into ${to}.\n` +
  `The user sends JSON with "translate": an object whose keys are numbers and whose values are ${from} sentences from a video, ` +
  `and "context": earlier sentences, only to help you understand (do not translate them).\n` +
  `The sentences may come from automatic speech recognition: missing punctuation and misheard words are common; fix obvious mistakes from context.\n` +
  `Rules:\n` +
  `- Translate every item into natural, short, spoken ${to}, under the same key.\n` +
  `- Each item is translated on its own: never move words from one item to another, never merge or skip items.\n` +
  `- Keep names as they are. Translate sound tags like [music] too, keeping the brackets.\n` +
  `- Write only ${to}. Never leave an item in ${from}.`;

/** Strict JSON schema: exactly the keys "1".."n", each a string. Ollama constrains the output to it. */
export const schemaFor = (n) => {
  const keys = Array.from({ length: n }, (_, i) => String(i + 1));
  return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])), required: keys, additionalProperties: false };
};

/** POST JSON with node:http so a Host header can be set (Ollama's DNS-rebinding guard may require it). */
export function postJson(url, body, { headers = {}, signal, timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST', signal, timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': data.length, ...headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ApiError(504, 'timeout')));
    req.on('error', (e) => reject(signal?.aborted ? new ApiError(499, 'cancelled') : e instanceof ApiError ? e : new ApiError(502, 'llm-unreachable', e.message)));
    req.end(data);
  });
}

/**
 * A translate function for one batch: (texts, context, signal) -> translated texts (same length, same order).
 * `post` is injectable for tests.
 */
export function ollamaTranslator({ baseUrl, model, hostHeader, from, to, post = postJson }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/chat`;
  const headers = hostHeader ? { host: hostHeader } : {};
  const sys = systemPrompt(languageName(from), languageName(to));
  const once = async (texts, context, signal, extra = '') => {
    const translate = Object.fromEntries(texts.map((t, i) => [String(i + 1), t]));
    const res = await post(url, {
      model, stream: false, keep_alive: '15m', format: schemaFor(texts.length),
      options: { temperature: 0.2, num_ctx: 4096 },
      messages: [{ role: 'system', content: sys + extra }, { role: 'user', content: JSON.stringify({ context, translate }) }],
    }, { headers, signal });
    if (res.status === 404) throw new ApiError(502, 'llm-model-missing', res.text.slice(0, 200));
    if (res.status < 200 || res.status >= 300) throw new ApiError(502, 'llm-failed', `${res.status} ${res.text.slice(0, 200)}`);
    let obj;
    try { obj = JSON.parse(JSON.parse(res.text).message.content); } catch { throw new ApiError(502, 'llm-bad-response'); }
    return texts.map((src, i) => {
      const v = obj?.[String(i + 1)];
      const t = typeof v === 'string' ? clean(v) : '';
      return t || src;
    });
  };
  return async (texts, context, signal) => {
    const out = await once(texts, context, signal);
    // Small models sometimes just copy the input back. One retry with a firmer instruction, then accept.
    const copied = out.filter((t, i) => norm(t) === norm(texts[i]) && /\p{L}{3}/u.test(t)).length;
    if (copied * 2 > texts.length) return once(texts, context, signal, `\nIMPORTANT: your previous answer was still in ${languageName(from)}. Answer in ${languageName(to)} only.`);
    return out;
  };
}
/** Removes leftovers some models append: zero-width characters, a stray `"}` and whatever follows it. */
export const clean = (s) => s.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/["”]?\s*[}\]]+[\s\S]*$/, (m) => (/^\]/.test(m.trim()) ? m : '')).trim();
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Quick reachability check for /api/health. */
export async function ollamaStatus({ baseUrl, model, hostHeader }) {
  try {
    const u = new URL(`${baseUrl.replace(/\/+$/, '')}/api/tags`);
    const text = await new Promise((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).get(u, { timeout: 4000, headers: hostHeader ? { host: hostHeader } : {} }, (res) => {
        let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => resolve(res.statusCode === 200 ? t : ''));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
    const models = (JSON.parse(text).models ?? []).map((m) => m.name);
    return { ok: models.includes(model) || models.includes(`${model}:latest`), model };
  } catch { return { ok: false, model }; }
}

// ---------------------------------------------------------------------------------------------------------------
// Jobs: one model call at a time on this machine, progress cached on disk so a repeat (or a resumed cancel) is free.

export function diskCache(dir) {
  const ready = dir ? mkdir(dir, { recursive: true }).catch(() => {}) : null;
  const file = (key) => path.join(dir, `${key}.json`);
  return {
    async get(key) {
      if (!dir) return null;
      await ready;
      try { return JSON.parse(await readFile(file(key), 'utf8')); } catch { return null; }
    },
    async set(key, value) {
      if (!dir) return;
      await ready;
      await mkdir(dir, { recursive: true }).catch(() => {}); // the folder may have been cleaned up meanwhile
      const tmp = `${file(key)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(value)).then(() => rename(tmp, file(key))).catch(() => {});
    },
  };
}

/** Single-lane queue that knows how many jobs are ahead of you. */
export function lane(queueMax = 6) {
  let tail = Promise.resolve(), waiting = 0;
  return {
    get waiting() { return waiting; },
    async run(fn, onQueued) {
      if (waiting >= queueMax) throw new ApiError(503, 'busy');
      const ahead = waiting++;
      if (ahead > 0) onQueued?.(ahead);
      const prev = tail;
      let release;
      tail = new Promise((r) => (release = r));
      try { await prev; return await fn(); } finally { waiting--; release(); }
    },
  };
}

/** Validates the POST body: {from, to, cues:[{start,end,text}]}. */
export function parseRequest(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { throw new ApiError(400, 'bad-request'); }
  const from = String(b?.from ?? '').toLowerCase(), to = String(b?.to ?? '').toLowerCase();
  if (!LANG_RE.test(from) || !LANG_RE.test(to) || from === to) throw new ApiError(400, 'bad-request');
  if (!Array.isArray(b.cues) || !b.cues.length || b.cues.length > LIMITS.maxCues) throw new ApiError(400, 'bad-request');
  const cues = b.cues.map((c) => ({
    start: Number(c?.start), end: Number(c?.end), text: String(c?.text ?? '').slice(0, LIMITS.maxText),
  })).filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end));
  if (!cues.length) throw new ApiError(400, 'bad-request');
  return { from, to, cues };
}

export function readBody(req, max = LIMITS.maxBody) {
  return new Promise((resolve, reject) => {
    let size = 0, data = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { size += Buffer.byteLength(d); if (size > max) { reject(new ApiError(413, 'too-large')); req.destroy(); } else data += d; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Builds the POST /api/translate handler. The response is NDJSON, one event per line:
 *   {"type":"meta","total":N,"model":"…"}  {"type":"queued","ahead":k}  {"type":"cues","done":d,"cues":[…]}
 *   {"type":"done"}  or  {"type":"error","error":"code"}
 * Translated cues arrive in order, so the browser can show them while the rest is still being translated.
 */
export function createTranslateHandler({
  baseUrl = 'http://127.0.0.1:11434', model = 'gemma3:latest', hostHeader = '', cacheDir = '',
  jobsPerHour = 12, makeTranslator = ollamaTranslator, now = Date.now,
} = {}) {
  const cache = diskCache(cacheDir);
  const queue = lane(6);
  const hits = new Map();
  const allow = (ip) => {
    const t = now(), recent = (hits.get(ip) ?? []).filter((x) => t - x < 3_600_000);
    if (recent.length >= jobsPerHour) return false;
    recent.push(t); hits.set(ip, recent);
    return true;
  };

  return async function translate(req, res, ip) {
    const { from, to, cues } = parseRequest(await readBody(req));
    const units = toUnits(cues);
    const key = createHash('sha256').update(JSON.stringify([model, from, to, units.map((u) => u.text)])).digest('hex').slice(0, 32);
    const saved = (await cache.get(key)) ?? { out: [] };
    const complete = saved.out.length >= units.length;
    if (!complete && !allow(ip)) throw new ApiError(429, 'rate-limit');

    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no', // nginx: pass events through immediately
    });
    const send = (ev) => { if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`); };
    const timed = (from, to) => units.slice(from, to).map((u, i) => ({ start: u.start, end: u.end, text: saved.out[from + i] }));

    send({ type: 'meta', total: units.length, model, cached: saved.out.length });
    if (saved.out.length) send({ type: 'cues', done: saved.out.length, cues: timed(0, saved.out.length) });
    if (complete) { send({ type: 'done' }); return res.end(); }

    const heartbeat = setInterval(() => send({ type: 'ping' }), 15_000); // keeps proxies from timing out while queued
    try {
      await queue.run(async () => {
        const tr = makeTranslator({ baseUrl, model, hostHeader, from, to });
        for (const batch of batches(units)) {
          if (batch[0] < saved.out.length) continue; // already done in an earlier (cancelled) run
          if (ctl.signal.aborted) throw new ApiError(499, 'cancelled');
          const first = batch[0], context = units.slice(Math.max(0, first - 3), first).map((u) => u.text);
          const texts = await tr(batch.map((i) => units[i].text), context, ctl.signal);
          saved.out.push(...texts);
          await cache.set(key, saved);
          send({ type: 'cues', done: saved.out.length, cues: timed(first, saved.out.length) });
        }
      }, (ahead) => send({ type: 'queued', ahead }));
      send({ type: 'done' });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(502, 'llm-failed', e?.message);
      if (err.code !== 'cancelled') console.error(`[${new Date().toISOString()}] translate ${from}->${to} -> ${err.code}: ${err.detail ?? ''}`);
      send({ type: 'error', error: err.code });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };
}
