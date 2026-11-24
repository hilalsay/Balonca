// Tiny yt-dlp wrapper API for Balonca. Zero dependencies. See README "Subtitle service".
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logError } from './redact.mjs';
import { createYouTube } from './youtube.mjs';

export const ID_RE = /^[A-Za-z0-9_-]{11}$/;
// No dots or regex metacharacters: yt-dlp treats --sub-langs values as regular expressions.
export const LANG_RE = /^[A-Za-z0-9_-]{1,24}$/;

export class ApiError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

/** Runs yt-dlp without a shell (arguments are an array), with a timeout and an output cap. */
export function runYtDlp(args, { bin = 'yt-dlp', timeoutMs = 60_000, maxBytes = 30 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', size = 0, done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, new ApiError(504, 'timeout')); }, timeoutMs);
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > maxBytes) { child.kill('SIGKILL'); finish(reject, new ApiError(502, 'too-large')); } else out += d;
    });
    child.stderr.on('data', (d) => { if (err.length < 20_000) err += d; });
    child.on('error', (e) => finish(reject, new ApiError(500, e.code === 'ENOENT' ? 'ytdlp-missing' : 'failed')));
    child.on('close', (code) => (code === 0 ? finish(resolve, { stdout: out, stderr: err }) : finish(reject, classify(err))));
  });
}

/** Version of the yt-dlp on this machine (the one found on PATH, or YTDLP_BIN), or null when it is not installed. */
export async function checkYtDlp(run = runYtDlp, bin = 'yt-dlp') {
  try {
    const { stdout } = await run(['--version'], { bin, timeoutMs: 10_000 });
    return stdout.trim() || null;
  } catch { return null; }
}

export function classify(stderr) {
  const detail = stderr.trim().split('\n').filter((l) => /error/i.test(l)).pop()?.slice(0, 300) ?? stderr.slice(0, 300);
  // YouTube often refuses to serve its machine-translated captions to scripts; the original track is unaffected.
  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) return new ApiError(503, 'yt-rate-limit', detail);
  if (/Sign in to confirm|not a bot|confirm you.re not a bot/i.test(stderr)) return new ApiError(503, 'bot-check', detail);
  if (/Video unavailable|Private video|has been removed|not available|does not exist|members-only/i.test(stderr)) return new ApiError(404, 'not-found', detail);
  return new ApiError(502, 'failed', detail);
}

/** yt-dlp -J output -> the list the website shows. Manual first, then original auto-captions, then auto-translations. */
export function parseTracks(info) {
  const tracks = [];
  const add = (map, auto) => {
    for (const [code, formats] of Object.entries(map ?? {})) {
      if (code === 'live_chat' || !LANG_RE.test(code) || !Array.isArray(formats) || !formats.length) continue;
      const kind = !auto ? 'manual' : code.endsWith('-orig') ? 'auto' : 'auto-translated';
      tracks.push({ code, name: String(formats[0].name ?? code).slice(0, 80), kind });
    }
  };
  add(info.subtitles, false);
  add(info.automatic_captions, true);
  const rank = { manual: 0, auto: 1, 'auto-translated': 2 };
  tracks.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  return { id: String(info.id), title: String(info.title ?? ''), duration: Number(info.duration) || 0, tracks };
}

const BASE = ['--skip-download', '--no-playlist', '--no-warnings', '--no-progress'];
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

export async function listTracks(id, run) {
  const { stdout } = await run([...BASE, '--dump-single-json', '--', watch(id)], { timeoutMs: 60_000 });
  let info;
  try { info = JSON.parse(stdout); } catch { throw new ApiError(502, 'failed'); }
  return parseTracks(info);
}

export async function fetchTrack(id, lang, kind, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'balonca-'));
  try {
    await run([...BASE, kind === 'auto' ? '--write-auto-subs' : '--write-subs', '--sub-langs', lang,
      '--sub-format', 'json3/vtt/srt', '-o', path.join(dir, '%(id)s'), '--', watch(id)], { timeoutMs: 90_000 });
    const file = (await readdir(dir)).find((f) => f.startsWith(`${id}.${lang}.`));
    if (!file) throw new ApiError(404, 'no-subs');
    return { name: file, text: await readFile(path.join(dir, file), 'utf8') };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Counts requests per key in a sliding minute. */
export function rateLimiter(maxPerMinute, now = Date.now) {
  const hits = new Map();
  return (key) => {
    const t = now(), recent = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < 60_000)) hits.delete(k);
    return recent.length <= maxPerMinute;
  };
}

/** Allows at most `limit` jobs at once; more than `queueMax` waiting are refused. */
export function semaphore(limit, queueMax) {
  let active = 0;
  const waiting = [];
  const next = () => { while (active < limit && waiting.length) { active++; waiting.shift()(); } };
  return async (fn) => {
    if (active >= limit && waiting.length >= queueMax) throw new ApiError(503, 'busy');
    await new Promise((r) => { waiting.push(r); next(); });
    try { return await fn(); } finally { active--; next(); }
  };
}

/**
 * Only the site itself may use the API (not other sites, not a shared link opened in the address bar):
 * browsers mark their own requests `Sec-Fetch-Site: same-origin`, and a POST must come from the site's origin.
 * Origins listed in ALLOWED_ORIGINS (development front ends) are let through too. A script can fake both
 * headers, so this is a first wall, not authentication.
 */
export function checkSource(req, { publicOrigin = '', allowedOrigins = [] } = {}) {
  const origin = String(req.headers.origin ?? '');
  const listed = !!origin && allowedOrigins.includes(origin);
  const site = req.headers['sec-fetch-site'];
  // Safari before iOS 16.4 sends no Sec-Fetch-Site: then the Referer must be a page of this site.
  // (A link opened directly has no Referer; another site's page has its own.)
  const ownPage = (u) => { try { const x = new URL(u); return publicOrigin ? x.origin === publicOrigin : x.host === req.headers.host; } catch { return false; } };
  const same = site === 'same-origin' || (site === undefined && ownPage(String(req.headers.referer ?? '')));
  if (!same && !listed) throw new ApiError(403, 'forbidden');
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    let own = listed;
    if (!own && origin) {
      try { own = publicOrigin ? origin === publicOrigin : new URL(origin).host === req.headers.host; } catch { own = false; }
    }
    if (!own) throw new ApiError(403, 'forbidden');
  }
}

export function createHandler({
  run = runYtDlp, ytdlpInstalled = true, allowedOrigins = [], trustProxy = false, ratePerMinute = 30,
  ttlMs = 10 * 60_000, now = Date.now, translate = null, define = null, sentence = null, llmStatus = null,
  parse = null, tts = null, nlpStatus = null, publicOrigin = '', parsePerMinute = 60, youtube = null, appConfig = { pivot: 'en' },
  auth = null, sync = null, // accounts (auth.mjs, sync.mjs): with them, every route but health needs a signed-in user
} = {}) {
  // All YouTube calls: cache, shared budget, circuit breaker (youtube.mjs). Without a cache dir: memory only.
  const yt = youtube ?? createYouTube({ run, limits: { gapMs: [0, 0] } });
  const limit = rateLimiter(ratePerMinute, now);
  // Grammar is asked one sentence at a time while reading: its own limit (speech has its own, in nlp.mjs).
  const parseLimit = rateLimiter(parsePerMinute, now);
  return async function handle(req, res) {
    const origin = req.headers.origin;
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=60',
        ...(origin && allowedOrigins.includes(origin)
          ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', vary: 'Origin' } : {}),
      });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      if (req.method === 'OPTIONS') return send(204, '');
      const url = new URL(req.url ?? '/', 'http://x');
      // Google sends the browser back to the callback from its own site; that request is tied to this browser by the
      // state cookie instead (auth.mjs).
      if (url.pathname !== '/api/health' && url.pathname !== '/api/auth/google/callback') checkSource(req, { publicOrigin, allowedOrigins });
      const addr = (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
      // Signed in: limits count per user (a school or dorm network shares one address), else per address.
      let user = null;
      if (auth && url.pathname !== '/api/health') {
        if (url.pathname === '/api/me' || url.pathname.startsWith('/api/auth/')) { if (await auth.route(req, res, url, addr)) return; }
        user = auth.requireUser(req);
        if (!user) throw new ApiError(401, 'login-required');
      }
      const ip = user ? `u${user.id}` : addr;
      if (url.pathname === '/api/sync') {
        if (!sync || !user) throw new ApiError(404, 'not-found-route');
        if (!limit(ip)) throw new ApiError(429, 'rate-limit');
        return await sync(req, res, url, user);
      }
      if (url.pathname === '/api/translate') {
        if (!translate) throw new ApiError(404, 'not-found-route');
        if (req.method !== 'POST') throw new ApiError(405, 'method');
        if (!limit(ip)) throw new ApiError(429, 'rate-limit');
        return await translate(req, res, ip); // streams its own response
      }
      if (url.pathname === '/api/define') {
        if (!define) throw new ApiError(404, 'not-found-route');
        if (req.method !== 'POST') throw new ApiError(405, 'method');
        if (!limit(ip)) throw new ApiError(429, 'rate-limit');
        return await define(req, res, ip);
      }
      if (url.pathname === '/api/sentence') {
        if (!sentence) throw new ApiError(404, 'not-found-route');
        if (req.method !== 'POST') throw new ApiError(405, 'method');
        if (!limit(ip)) throw new ApiError(429, 'rate-limit');
        return await sentence(req, res, ip);
      }
      if (url.pathname === '/api/parse') {
        if (!parse) throw new ApiError(404, 'not-found-route');
        if (req.method !== 'POST') throw new ApiError(405, 'method');
        if (!parseLimit(ip)) throw new ApiError(429, 'rate-limit');
        return await parse(req, res, ip);
      }
      if (url.pathname === '/api/tts') {
        if (!tts) throw new ApiError(404, 'not-found-route');
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'method');
        return await tts(req, res, url, ip); // limits of its own: cached audio vs. new speech
      }
      if (req.method !== 'GET') throw new ApiError(405, 'method');
      if (url.pathname === '/api/config') return send(200, appConfig);
      if (url.pathname === '/api/me' || url.pathname.startsWith('/api/auth/')) throw new ApiError(404, 'no-accounts'); // accounts off
      if (url.pathname === '/api/nlp') return send(200, nlpStatus ? await nlpStatus() : { parse: [], tts: [] });
      if (url.pathname === '/api/health') {
        return send(200, { ok: true, ytdlp: ytdlpInstalled, youtube: yt.status(), ...(llmStatus ? { llm: await llmStatus() } : {}), ...(nlpStatus ? { nlp: await nlpStatus() } : {}) });
      }
      if (!limit(ip)) throw new ApiError(429, 'rate-limit');

      const id = url.searchParams.get('v') ?? '';
      if (!ID_RE.test(id)) throw new ApiError(400, 'bad-request');

      if (url.pathname === '/api/subs') return send(200, await yt.list(id, ip));
      if (url.pathname === '/api/sub') {
        const lang = url.searchParams.get('lang') ?? '';
        const kind = url.searchParams.get('kind') === 'manual' ? 'manual' : 'auto';
        if (!LANG_RE.test(lang)) throw new ApiError(400, 'bad-request');
        const r = await yt.sub(id, lang, kind, ip);
        return send(200, r.text, r.name.endsWith('.json3') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
      }
      throw new ApiError(404, 'not-found-route');
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(500, 'failed');
      // Only the path: query strings can hold what the user wrote (speech text).
      if (err.status >= 500) logError(`${new URL(req.url ?? '/', 'http://x').pathname} -> ${err.code}: ${err.detail ?? e?.message ?? ''}`);
      if (res.headersSent) res.end(); else send(err.status, { error: err.code });
    }
  };
}
