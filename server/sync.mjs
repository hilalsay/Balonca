// Keeping a user's data the same on every device.
//   GET  /api/sync?since=<ms>  -> { words, known, settings, library, now }   (changed after `since`, deleted ones too)
//   POST /api/sync { words?, known?, settings?, library? } -> { now }
// The browser keeps its own copy (IndexedDB) and sends what changed; on a conflict the newer `updatedAt` wins.
// Everything is validated here: the server never trusts the browser's copy.
import { ApiError, ID_RE } from './lib.mjs';
import { readBody } from './translate.mjs';

export const SYNC_LIMITS = { body: 2 * 1024 * 1024, words: 50_000, word: 20_000, text: 200_000, library: 2_000 };
const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const KINDS = new Set(['youtube', 'link', 'text', 'pdf', 'subfile']);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/** A changed word from the browser: { id, lang, updatedAt, deleted?, data? } (data = the SavedWord). */
export function cleanWord(x, now) {
  if (!x || typeof x !== 'object') return null;
  const id = str(x.id, 100), lang = str(x.lang, 12);
  if (!id || !lang || !LANG.test(lang) || !id.startsWith(`${lang}:`) || !isNum(x.updatedAt)) return null;
  const data = x.deleted ? '{}' : JSON.stringify(x.data ?? {});
  if (data.length > SYNC_LIMITS.word) return null;
  return { id, lang, data, updatedAt: Math.min(x.updatedAt, now + 60_000), deleted: !!x.deleted };
}
export function cleanKnown(x, now) {
  if (!x || typeof x !== 'object') return null;
  const lang = str(x.lang, 12), w = str(x.w, 60);
  if (!lang || !LANG.test(lang) || !w || !isNum(x.updatedAt)) return null;
  return { lang, w, updatedAt: Math.min(x.updatedAt, now + 60_000), deleted: !!x.deleted };
}
export function cleanLibrary(x, now) {
  if (!x || typeof x !== 'object') return null;
  const id = str(x.id, 40), kind = str(x.kind, 10);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !kind || !KINDS.has(kind) || !isNum(x.updatedAt)) return null;
  const vid = x.vid == null ? null : str(x.vid, 11);
  if (vid !== null && !ID_RE.test(vid)) return null;
  const url = x.url == null ? null : str(x.url, 2000);
  if (url !== null && !/^https?:\/\//i.test(url)) return null;
  const body = x.deleted ? null : x.body == null ? null : str(x.body, SYNC_LIMITS.text);
  if (x.body != null && !x.deleted && body === null) return null;
  const meta = x.meta == null ? null : JSON.stringify(x.meta);
  if (meta && meta.length > 400_000) return null;
  return {
    id, kind, vid, url, body, meta, title: x.title == null ? null : str(x.title, 200),
    createdAt: isNum(x.createdAt) ? x.createdAt : x.updatedAt, openedAt: isNum(x.openedAt) ? x.openedAt : null,
    updatedAt: Math.min(x.updatedAt, now + 60_000), deleted: !!x.deleted,
  };
}

export function createSync({ db, now = Date.now }) {
  return async function syncRoute(req, res, url, user) {
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0);
      if (!Number.isFinite(since) || since < 0) throw new ApiError(400, 'bad-request');
      const t = now();
      const s = db.settings(user.id);
      return send({
        now: t,
        words: db.wordsSince(user.id, since).map((r) => ({ id: r.id, lang: r.lang, updatedAt: r.updated_at, deleted: !!r.deleted, ...(r.deleted ? {} : { data: JSON.parse(r.data) }) })),
        known: db.knownSince(user.id, since).map((r) => ({ lang: r.lang, w: r.w, updatedAt: r.updated_at, deleted: !!r.deleted })),
        settings: s && s.updated_at > since ? { data: JSON.parse(s.data), updatedAt: s.updated_at } : null,
        library: db.librarySince(user.id, since).map((r) => ({
          id: r.id, kind: r.kind, title: r.title, url: r.url, vid: r.vid, body: r.body, meta: r.meta ? JSON.parse(r.meta) : null,
          createdAt: r.created_at, openedAt: r.opened_at, updatedAt: r.updated_at, deleted: !!r.deleted,
        })),
      });
    }
    if (req.method !== 'POST') throw new ApiError(405, 'method');
    let b;
    try { b = JSON.parse(await readBody(req, SYNC_LIMITS.body)); } catch (e) { throw e instanceof ApiError ? e : new ApiError(400, 'bad-request'); }
    if (!b || typeof b !== 'object') throw new ApiError(400, 'bad-request');
    const t = now();
    const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
    const words = list(b.words, SYNC_LIMITS.words).map((x) => cleanWord(x, t)).filter(Boolean);
    const known = list(b.known, 100_000).map((x) => cleanKnown(x, t)).filter(Boolean);
    const library = list(b.library, SYNC_LIMITS.library).map((x) => cleanLibrary(x, t)).filter(Boolean);
    const newWords = words.filter((w) => !w.deleted).length;
    if (newWords && db.countWords(user.id) + newWords > SYNC_LIMITS.words) throw new ApiError(413, 'too-many-words');
    db.tx(() => {
      for (const w of words) db.putWord(user.id, w);
      for (const k of known) db.putKnown(user.id, k);
      for (const x of library) db.putLibrary(user.id, x);
      if (b.settings && typeof b.settings === 'object' && isNum(b.settings.updatedAt)) {
        const data = JSON.stringify(b.settings.data ?? {});
        if (data.length <= 20_000) db.putSettings(user.id, data, Math.min(b.settings.updatedAt, t + 60_000));
      }
    })();
    send({ now: t, saved: { words: words.length, known: known.length, library: library.length } });
  };
}
