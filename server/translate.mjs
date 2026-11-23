// Subtitle translation through a local Ollama model. Zero dependencies. See README "Automatic translation".
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, LANG_RE } from './lib.mjs';
import { logError } from './redact.mjs';

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
  `- Write only ${to}. Never leave an item in ${from}.\n` +
  `- Inside the texts use ' for quotes, never " or ” (they would break the JSON).`;

/** Strict JSON schema: exactly the keys "1".."n", each a string. Ollama constrains the output to it. */
export const schemaFor = (n) => {
  const keys = Array.from({ length: n }, (_, i) => String(i + 1));
  return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])), required: keys, additionalProperties: false };
};

/** Output that ends in the same short piece over and over ("3: 3: 3: …"): the model is stuck and will not stop. */
export const isLooping = (s) => /(.{1,24}?)\1{9,}$/su.test(s.slice(-400));

/**
 * Streams one Ollama /api/chat call (node:http, so a Host header can be set for Ollama's DNS-rebinding guard).
 * Resolves with the generated text; stops early, with `looped: true`, when the model starts repeating itself.
 */
export function chatStream(url, body, { headers = {}, signal, timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify({ ...body, stream: true }));
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'POST', signal, timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': data.length, ...headers },
    }, (res) => {
      const status = res.statusCode ?? 0;
      let buf = '', content = '', raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        if (status !== 200) { raw += d; return; }
        buf += d;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          try { content += JSON.parse(line).message?.content ?? ''; } catch {}
        }
        if (isLooping(content)) { done(resolve, { status, content, looped: true }); req.destroy(); }
      });
      res.on('end', () => done(resolve, { status, content, raw }));
      res.on('error', (e) => done(reject, e));
    });
    req.on('timeout', () => req.destroy(new ApiError(504, 'timeout')));
    req.on('error', (e) => done(reject, signal?.aborted ? new ApiError(499, 'cancelled') : e instanceof ApiError ? e : new ApiError(502, 'llm-unreachable', e.message)));
    req.end(data);
  });
}

/** Curly and other look-alike double quotes, which models like to write instead of `"`. */
const SMART_QUOTES = /[“”„‟″〝〞＂]/g;
export const straightQuotes = (s) => s.replace(SMART_QUOTES, '"');

/** The `{…}` part of a reply: drops ```json fences and any chatter before or after the object. */
export function jsonPart(content) {
  const s = String(content).replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s.trim();
}

/**
 * A translated item that contains pieces of the batch's JSON (`…ditch.”, “2”:”What…`): the model wrote several
 * items into one value. Such a reply cannot be trusted at all (the other keys are usually shifted by one).
 */
export const isLeak = (s) => {
  const t = straightQuotes(String(s));
  return /"\s*\d+\s*"\s*:/.test(t) || /"\s*,\s*"/.test(t) || /^\s*[{\[]?\s*"?\d+"?\s*:\s*"/.test(t);
};

/**
 * Every complete `"n": "text"` pair in a model reply, even when the JSON as a whole is broken (a model that closes
 * a string with a curly quote, or got cut off). Returns { "1": "…", … }. Fences and chatter around the object are
 * ignored, and a reply that only parses once its curly quotes are made straight is read that way.
 */
export function salvage(content) {
  const body = jsonPart(content);
  for (const c of [content, body, straightQuotes(body)]) {
    try { const o = JSON.parse(c); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
  }
  const out = {};
  for (const m of body.matchAll(/"(\d+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try { out[m[1]] = JSON.parse(`"${m[2]}"`); } catch {}
  }
  return out;
}

/**
 * Checks a parsed reply against the batch it answers. Returns one translation (or null) per text, by key, never
 * by position. The whole reply is thrown away (all null) when it shows that the model lost track of the items:
 * an unknown key, an item that holds other items (`isLeak`), or two different sentences with the same translation
 * (the usual sign of answers shifted by one). The caller then retries in smaller pieces.
 */
export function checkReply(obj, texts) {
  const keys = texts.map((_, i) => String(i + 1));
  const none = texts.map(() => null);
  if (!obj || typeof obj !== 'object' || Object.keys(obj).some((k) => !keys.includes(k))) return none;
  const vals = keys.map((k) => (typeof obj[k] === 'string' ? clean(obj[k]) : ''));
  if (vals.some((v) => v && isLeak(v))) return none;
  const seen = new Map();
  for (let i = 0; i < vals.length; i++) {
    const v = norm(vals[i]);
    if (!v || texts[i].trim().split(/\s+/).length < 2) continue;
    const j = seen.get(v);
    if (j !== undefined && norm(texts[j]) !== norm(texts[i])) return none;
    seen.set(v, i);
  }
  return vals.map((t) => (t && !isLooping(t) ? t : null));
}

/**
 * A translate function for one batch: (texts, context, signal) -> translated texts (same length, same order).
 * Never fails on a bad answer: items the model got wrong are retried in smaller batches, then one by one as plain
 * text, and as a last resort keep their source text. Network / model-missing problems still throw.
 * `chat` is injectable for tests.
 */
export function ollamaTranslator({ baseUrl, model, hostHeader, from, to, chat = chatStream }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/chat`;
  const headers = hostHeader ? { host: hostHeader } : {};
  const fromName = languageName(from), toName = languageName(to);
  const sys = systemPrompt(fromName, toName);

  const ask = async (body, signal) => {
    const res = await chat(url, { model, keep_alive: '15m', ...body }, { headers, signal });
    if (res.status === 404) throw new ApiError(502, 'llm-model-missing', String(res.raw ?? '').slice(0, 200));
    if (res.status < 200 || res.status >= 300) throw new ApiError(502, 'llm-failed', `${res.status} ${String(res.raw ?? '').slice(0, 200)}`);
    return res.content;
  };

  /** One JSON call; null for every item that did not come back usable. */
  const batch = async (texts, context, signal, extra = '') => {
    const chars = texts.reduce((n, t) => n + t.length, 0);
    const content = await ask({
      format: schemaFor(texts.length),
      // A generous budget for the real answer; a runaway model is cut off long before the context fills up.
      options: { temperature: 0.2, num_ctx: 4096, num_predict: Math.min(2048, 64 + 16 * texts.length + 2 * chars) },
      messages: [{ role: 'system', content: sys + extra },
        { role: 'user', content: JSON.stringify({ context, translate: Object.fromEntries(texts.map((t, i) => [String(i + 1), t])) }) }],
    }, signal);
    return checkReply(salvage(content), texts);
  };

  /** Last resort for a single line: no JSON at all. */
  const plain = async (text, context, signal) => {
    const content = await ask({
      options: { temperature: 0.2, num_ctx: 2048, num_predict: Math.min(400, 48 + 3 * text.length) },
      messages: [
        { role: 'system', content: `Translate the user's ${fromName} subtitle line into natural, spoken ${toName}. Reply with the translation only: no quotes, no notes, no alternatives.` },
        { role: 'user', content: (context.length ? `(Earlier: ${context.join(' ')})\n\n` : '') + text },
      ],
    }, signal);
    const t = clean(content.split('\n').map((l) => l.trim()).find(Boolean) ?? '').replace(/^["“'‘]+|["”'’]+$/g, '').trim();
    return /\p{L}/u.test(t) && !isLooping(t) && !isLeak(t) ? t : null;
  };

  const isCopy = (t, src) => norm(t) === norm(src) && /\p{L}{3}/u.test(t);
  const copiedMost = (out, texts) => out.filter((t, i) => t && isCopy(t, texts[i])).length * 2 > texts.length;

  const fill = async (texts, context, signal) => {
    let out = await batch(texts, context, signal);
    // Small models sometimes just copy the input back. One retry with a firmer instruction.
    if (copiedMost(out, texts)) out = await batch(texts, context, signal, `\nIMPORTANT: your previous answer was still in ${fromName}. Answer in ${toName} only.`);
    // A sentence of several words that came back unchanged was skipped, not translated ("Oh hoi Bello."): ask again.
    // A lone name or tag ("Bello.", "[muziek]") may rightly stay as it is.
    out = out.map((t, i) => (t && isCopy(t, texts[i]) && texts[i].trim().split(/\s+/).length >= 2 ? null : t));
    const missing = out.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
    if (!missing.length) return out;
    if (texts.length === 1) return [(await plain(texts[0], context, signal)) ?? texts[0]];
    // Retry what is missing: as one smaller batch if part of the answer was fine, else split the batch in two.
    const groups = missing.length < texts.length ? [missing]
      : [missing.slice(0, Math.ceil(missing.length / 2)), missing.slice(Math.ceil(missing.length / 2))];
    for (const g of groups) {
      const sub = await fill(g.map((i) => texts[i]), context, signal);
      g.forEach((i, k) => (out[i] = sub[k]));
    }
    return out;
  };

  return (texts, context, signal) => fill(texts, context, signal);
}
/** Removes leftovers some models append: zero-width characters, a stray `"}` and whatever follows it. */
export const clean = (s) => s.replace(/[​-‍﻿]/g, '').replace(/["”]?\s*[}\]]+[\s\S]*$/, (m) => (/^\]/.test(m.trim()) ? m : '')).trim();
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
/** "tr=aya-expanse:8b,nl=other" -> { tr: 'aya-expanse:8b', nl: 'other' }: a stronger model for some target languages. */
export function parseModels(spec = '') {
  const out = {};
  for (const part of String(spec).split(',')) {
    const [lang, model] = part.split('=').map((x) => x?.trim());
    if (lang && model && LANG_RE.test(lang)) out[lang.toLowerCase()] = model;
  }
  return out;
}
/** The model that writes text in `to`. */
export const modelFor = (llm, to) => llm.models?.[to] ?? llm.model;

/**
 * A cached translation cut back to before the first batch that holds a broken item (one written by an older
 * version that did not check replies), so that batch and everything after it is translated again.
 */
export function healed(out, units) {
  if (!Array.isArray(out)) return [];
  const bad = out.findIndex((t) => typeof t !== 'string' || isLeak(t));
  if (bad < 0) return out;
  const start = batches(units).find((b) => b.includes(bad))?.[0] ?? bad;
  return out.slice(0, Math.min(bad, start));
}

export function createTranslateHandler({
  baseUrl = 'http://127.0.0.1:11434', model: defaultModel = 'gemma3:latest', models = {}, hostHeader = '', cacheDir = '',
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
    const model = modelFor({ model: defaultModel, models }, to);
    const units = toUnits(cues);
    const key = createHash('sha256').update(JSON.stringify([model, from, to, units.map((u) => u.text)])).digest('hex').slice(0, 32);
    const saved = (await cache.get(key)) ?? { out: [] };
    saved.out = healed(saved.out, units);
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
      if (err.code !== 'cancelled') logError(`translate ${from}->${to} -> ${err.code}: ${err.detail ?? ''}`);
      send({ type: 'error', error: err.code });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };
}
