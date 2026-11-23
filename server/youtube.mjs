// Every call to YouTube goes through here, so this server's address is not blocked:
//  - a permanent disk cache (track lists for a day, subtitles for good): a video opened before costs no call;
//  - at most two calls per new video (the list, then the chosen subtitle read from the saved video info);
//  - one call for many identical requests at once;
//  - a budget for everyone together (per minute / hour / day); over it, requests wait, or get "yt-busy";
//  - a circuit breaker: after a 429 or a bot check, no calls at all for 15 min, 30 min, 1 h … up to 6 h;
//  - YouTube's own machine translations are never fetched (they are what gets refused; we translate ourselves);
//  - a daily number of new videos per client.
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError, ID_RE, LANG_RE, parseTracks } from './lib.mjs';
import { singleFlight, windowCounter } from './limits.mjs';
import { logError } from './redact.mjs';

export const YT_LIMITS = {
  perMin: 6, perHour: 120, perDay: 1000, // calls, all clients together
  maxWaitMs: 5 * 60_000, // longer than this in the queue: "yt-busy"
  newVideosPerDay: 30, // per client; videos already cached do not count
  listTtlMs: 24 * 3_600_000,
  infoFreshMs: 3 * 3_600_000, // saved video info is used to fetch subtitles while its links still work
  gapMs: [1000, 3000], // a random pause before every call
  breakerMs: [15 * 60_000, 6 * 3_600_000], // first and longest pause after a refusal
  backgroundPerHour: 30, // videos per hour for background jobs (pre-translation), only when nobody waits
};

const BASE = ['--skip-download', '--no-playlist', '--no-warnings', '--no-progress', '--sleep-requests', '1'];
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;
const BLOCKED = new Set(['yt-rate-limit', 'bot-check']);

/**
 * `run(args, opts)` runs yt-dlp (lib.mjs runYtDlp); `cacheDir` '' keeps everything in memory (tests, development).
 */
export function createYouTube({ run, cacheDir = '', limits = {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  const L = { ...YT_LIMITS, ...limits };
  const minute = windowCounter(60_000, L.perMin, now), hour = windowCounter(3_600_000, L.perHour, now), day = windowCounter(86_400_000, L.perDay, now);
  const background = windowCounter(3_600_000, L.backgroundPerHour, now);
  const newVideos = windowCounter(86_400_000, L.newVideosPerDay, now);
  const once = singleFlight();
  const mem = new Map(); // without a cache dir
  const stats = { hits: 0, misses: 0, calls: windowCounter(86_400_000, Infinity, now), lastSuccess: 0, lastBlock: 0, lastBlockCode: '' };
  const breaker = { failures: 0, until: 0, trial: false };
  let queue = Promise.resolve(), waiting = 0, live = 0;

  // ---- storage
  const dirOf = (vid) => path.join(cacheDir, vid.slice(0, 2), vid);
  async function load(vid, name) {
    if (!cacheDir) return mem.get(`${vid}/${name}`) ?? null;
    try { return { text: await readFile(path.join(dirOf(vid), name), 'utf8'), at: (await stat(path.join(dirOf(vid), name))).mtimeMs }; } catch { return null; }
  }
  async function save(vid, name, text) {
    if (!cacheDir) { mem.set(`${vid}/${name}`, { text, at: now() }); return; }
    const dir = dirOf(vid);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${name}.part`);
    await writeFile(tmp, text);
    await rename(tmp, path.join(dir, name));
  }
  async function known(vid) {
    if (!cacheDir) return [...mem.keys()].some((k) => k.startsWith(`${vid}/`));
    try { return (await readdir(dirOf(vid))).length > 0; } catch { return false; }
  }

  // ---- the gate every call passes
  function breakerCheck() {
    if (!breaker.until) return;
    if (now() < breaker.until || breaker.trial) throw new ApiError(503, 'yt-blocked');
    breaker.trial = true; // the pause is over: let exactly one call try
  }
  async function call(args, { priority = 'live' } = {}) {
    breakerCheck();
    const wait = Math.max(minute.waitFor('all'), hour.waitFor('all'), day.waitFor('all'));
    if (wait > L.maxWaitMs) { breaker.trial = false; throw new ApiError(503, 'yt-busy'); }
    if (priority === 'background' && (live > 0 || !background.has('all'))) { breaker.trial = false; throw new ApiError(503, 'yt-busy'); }
    if (priority === 'live') live++;
    waiting++;
    const mine = queue.then(async () => {
      // In line: wait for the budget, then a short random pause, then the call.
      for (let t = Math.max(minute.waitFor('all'), hour.waitFor('all'), day.waitFor('all')); t > 0; t = Math.max(minute.waitFor('all'), hour.waitFor('all'), day.waitFor('all'))) await sleep(t);
      breakerCheck2();
      await sleep(L.gapMs[0] + random() * (L.gapMs[1] - L.gapMs[0]));
      minute.add('all'); hour.add('all'); day.add('all'); stats.calls.add('all');
      if (priority === 'background') background.add('all');
    });
    queue = mine.catch(() => {});
    try {
      await mine;
      const out = await run(args);
      breaker.failures = 0; breaker.until = 0; breaker.trial = false; stats.lastSuccess = now();
      return out;
    } catch (e) {
      if (e instanceof ApiError && BLOCKED.has(e.code)) block(e.code);
      else breaker.trial = false;
      throw e;
    } finally {
      waiting--;
      if (priority === 'live') live--;
    }
  }
  // A call already in line when the breaker opened does not go out either.
  function breakerCheck2() { if (breaker.until && now() < breaker.until && !breaker.trial) throw new ApiError(503, 'yt-blocked'); }
  function block(code) {
    breaker.failures++;
    const ms = Math.min(L.breakerMs[0] * 2 ** (breaker.failures - 1), L.breakerMs[1]);
    breaker.until = now() + ms; breaker.trial = false;
    stats.lastBlock = now(); stats.lastBlockCode = code;
    logError(`youtube refused (${code}): no calls for ${Math.round(ms / 60_000)} min`);
  }

  // ---- the two things the site asks for
  async function list(vid, client = '?', opts = {}) {
    if (!ID_RE.test(vid)) throw new ApiError(400, 'bad-request');
    const hit = await load(vid, 'list.json');
    if (hit && now() - hit.at < L.listTtlMs) { stats.hits++; return JSON.parse(hit.text); }
    return once(`list:${vid}`, async () => {
      if (!(await known(vid)) && opts.priority !== 'background') {
        if (!newVideos.has(client)) throw new ApiError(429, 'daily-videos');
        newVideos.add(client);
      }
      stats.misses++;
      const { stdout } = await call([...BASE, '--dump-single-json', '--', watch(vid)], opts);
      let info;
      try { info = JSON.parse(stdout); } catch { throw new ApiError(502, 'failed'); }
      const data = parseTracks(info);
      await save(vid, 'info.json', stdout);
      await save(vid, 'list.json', JSON.stringify(data));
      return data;
    });
  }

  async function sub(vid, code, kind, client = '?', opts = {}) {
    // A code never starts with '-' (it would look like a yt-dlp option).
    if (!ID_RE.test(vid) || !LANG_RE.test(code) || code.startsWith('-') || (kind !== 'auto' && kind !== 'manual')) throw new ApiError(400, 'bad-request');
    const prefix = `sub.${kind}.${code}.`;
    const cached = await findSub(vid, prefix);
    if (cached) { stats.hits++; return cached; }
    const tracks = (await list(vid, client, opts)).tracks;
    const track = tracks.find((t) => t.code === code && (kind === 'manual' ? t.kind === 'manual' : t.kind !== 'manual'));
    if (!track) throw new ApiError(404, 'no-subs');
    if (track.kind === 'auto-translated') throw new ApiError(400, 'auto-translated');
    return once(`sub:${vid}:${kind}:${code}`, async () => {
      stats.misses++;
      const info = cacheDir ? await load(vid, 'info.json') : null;
      const tmp = cacheDir ? path.join(dirOf(vid), `dl-${process.pid}-${Math.round(random() * 1e9)}`) : null;
      const outDir = tmp ?? path.join((await import('node:os')).tmpdir(), `balonca-yt-${Math.round(random() * 1e9)}`);
      await mkdir(outDir, { recursive: true });
      try {
        // Fresh saved info: read the subtitle links from it (no new page visit).
        const from = info && now() - info.at < L.infoFreshMs ? ['--load-info-json', path.join(dirOf(vid), 'info.json')] : ['--', watch(vid)];
        await call([...BASE, kind === 'auto' ? '--write-auto-subs' : '--write-subs', '--sub-langs', code,
          '--sub-format', 'json3/vtt/srt', '-o', path.join(outDir, '%(id)s'), ...from], opts);
        const file = (await readdir(outDir)).find((f) => f.startsWith(`${vid}.${code}.`));
        if (!file) throw new ApiError(404, 'no-subs');
        const text = await readFile(path.join(outDir, file), 'utf8');
        const ext = file.split('.').pop();
        await save(vid, `${prefix}${ext}`, text);
        return { name: `${vid}.${code}.${ext}`, text };
      } finally {
        await rm(outDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  async function findSub(vid, prefix) {
    for (const ext of ['json3', 'vtt', 'srt']) {
      const hit = await load(vid, `${prefix}${ext}`);
      if (hit) return { name: `${vid}.${prefix.split('.')[2]}.${ext}`, text: hit.text };
    }
    return null;
  }

  function status() {
    const t = now();
    return {
      callsHour: hour.used('all'), callsDay: stats.calls.used('all'), waiting,
      cacheHitRate: stats.hits + stats.misses ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100) / 100 : null,
      paused: breaker.until > t ? { minutes: Math.ceil((breaker.until - t) / 60_000), reason: stats.lastBlockCode } : null,
      lastSuccess: stats.lastSuccess ? new Date(stats.lastSuccess).toISOString() : null,
      lastRefusal: stats.lastBlock ? new Date(stats.lastBlock).toISOString() : null,
    };
  }
  return { list, sub, status };
}
