// Where the text a model, the speech engine or the grammar parser gets comes from (phase 2): never from the browser.
// A request names a source and the server reads the text itself:
//   { v, code, kind }   a YouTube subtitle (through youtube.mjs: cache, budget, circuit breaker)
//   { v }               any subtitle of that video the server already has, or a translation it made
//   { libraryId }       a text in the signed-in user's library (synced by sync.mjs)
//   { wordId }          a word the signed-in user saved: its sentence must itself be found in its video or text
// When the browser names a sentence (the one on screen, the one being read), that sentence must occur in the source.
import { ApiError, ID_RE, LANG_RE } from './lib.mjs';
import { parseSubtitles, splitText, allSentences } from './gen/shared.mjs';

/** Text as it is compared: one kind of space, no zero-width characters, composed accents. */
export const norm = (s) => String(s ?? '').normalize('NFC').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
const LIB_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The source a request names, checked; throws 400 for anything else. */
export function parseRef(x) {
  if (!x || typeof x !== 'object') throw new ApiError(400, 'bad-request');
  if (typeof x.libraryId === 'string') {
    if (!LIB_ID.test(x.libraryId)) throw new ApiError(400, 'bad-request');
    return { libraryId: x.libraryId };
  }
  if (typeof x.wordId === 'string') {
    if (x.wordId.length > 100 || !x.wordId.includes(':')) throw new ApiError(400, 'bad-request');
    return { wordId: x.wordId };
  }
  if (typeof x.v === 'string' && ID_RE.test(x.v)) {
    if (x.code === undefined) return { v: x.v };
    const code = String(x.code), kind = x.kind === 'manual' ? 'manual' : x.kind === 'auto' ? 'auto' : '';
    if (!LANG_RE.test(code) || code.startsWith('-') || !kind) throw new ApiError(400, 'bad-request');
    return { v: x.v, code, kind };
  }
  throw new ApiError(400, 'bad-request');
}

/**
 * yt: youtube.mjs. db: db.mjs. madeFor(vid): texts of the translations the server made for a video (translate.mjs).
 */
export function createSources({ yt, db, madeFor = async () => [], now = Date.now }) {
  const parse = (text) => { try { return parseSubtitles(text).cues; } catch { return []; } };

  /** The cues of one YouTube subtitle (may call YouTube, within its budget). */
  async function transcript(vid, code, kind, client) {
    const cues = parse((await yt.sub(vid, code, kind, client)).text);
    if (!cues.length) throw new ApiError(404, 'no-subs');
    return cues;
  }

  // Everything known to be in a video, joined: asked for each word looked up, so kept for a minute.
  const videoCache = new Map();
  async function videoText(vid) {
    const hit = videoCache.get(vid);
    if (hit && now() - hit.at < 60_000) return hit.text;
    const parts = [];
    for (const s of await yt.cachedSubs(vid)) parts.push(...parse(s.text).map((c) => c.text));
    parts.push(...(await madeFor(vid)));
    const text = norm(parts.join(' \n '));
    if (videoCache.size > 200) videoCache.delete(videoCache.keys().next().value);
    videoCache.set(vid, { text, at: now() });
    return text;
  }

  /** A text of the user's library: { body, lang }. */
  function libraryText(user, id) {
    if (!user) throw new ApiError(401, 'login-required');
    const it = db.libraryItem(user.id, id);
    if (!it || it.kind !== 'text' || !it.body) throw new ApiError(404, 'not-in-library');
    let meta = {};
    try { meta = JSON.parse(it.meta ?? '{}') ?? {}; } catch {}
    const lang = typeof meta.lang === 'string' && LANG_RE.test(meta.lang) ? meta.lang.toLowerCase() : '';
    return { body: it.body, lang };
  }
  /** The sentences of a library text, numbered the way the reading mode numbers them. */
  function librarySentences(user, id) {
    const { body, lang } = libraryText(user, id);
    return { lang, sentences: allSentences(splitText(body, lang || 'en')).map((s) => s.text) };
  }

  /** A saved word whose sentence is found in its video or text: { w, lang, ctx }. */
  async function savedWord(user, id) {
    if (!user) throw new ApiError(401, 'login-required');
    const w = db.savedWord(user.id, id);
    if (!w || typeof w.w !== 'string' || typeof w.lang !== 'string') throw new ApiError(404, 'not-in-library');
    const ctx = norm(w.ctx);
    const ok = ctx && (typeof w.doc === 'string' && LIB_ID.test(w.doc) ? await contains({ libraryId: w.doc }, user, ctx)
      : typeof w.vid === 'string' && ID_RE.test(w.vid) ? await contains({ v: w.vid }, user, ctx) : false);
    return { w: w.w, lang: w.lang, ctx: ok ? ctx : '' };
  }

  /** Whether `needle` occurs in the source (as a whole, after `norm`). */
  async function contains(ref, user, needle) {
    const n = norm(needle);
    if (!n) return false;
    if (ref.libraryId) {
      try { return norm(libraryText(user, ref.libraryId).body).includes(n); } catch { return false; }
    }
    if (ref.v) return (await videoText(ref.v)).includes(n);
    if (ref.wordId) {
      try { return (await savedWord(user, ref.wordId)).ctx.includes(n); } catch { return false; }
    }
    return false;
  }

  return { transcript, videoText, libraryText, librarySentences, savedWord, contains, forget: (vid) => videoCache.delete(vid) };
}
