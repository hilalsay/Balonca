// POST /api/sentence: one sentence in another language, read by the server from where it is (phase 2):
//   { wordId, to }             the sentence a saved word came from ("My words" cards)
//   { libraryId, text, to }    a sentence of a library text (the reading mode's sentence panel); `text` must be in it
// The browser never hands over a sentence of its own.
import { createHash } from 'node:crypto';
import { llmContext, fellBack } from './llm/index.mjs';
import { ApiError, LANG_RE } from './lib.mjs';
import { norm, parseRef } from './sources.mjs';
import { diskCache, modelFor, ollamaTranslator, readBody } from './translate.mjs';

/** Validates the POST body. */
export function parseSentenceRequest(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { throw new ApiError(400, 'bad-request'); }
  const to = String(b?.to ?? '').toLowerCase();
  if (!LANG_RE.test(to)) throw new ApiError(400, 'bad-request');
  const ref = parseRef(b);
  if (ref.v) throw new ApiError(400, 'bad-request');
  const text = ref.libraryId ? norm(b.text) : '';
  if (ref.libraryId && (!text || text.length > 600)) throw new ApiError(400, 'bad-request');
  return { ref, text, to };
}

/** Results are cached on disk per sentence, languages and model (per user: these are the user's own texts). */
/** pivot 'en': Turkish is made from the English translation, which is answered too ({ text, en }). */
export function createSentenceHandler({ llm, cacheDir = '', chat, sources, pivot = 'off' } = {}) {
  const cache = diskCache(cacheDir);
  return (req, res, ip, user) => llmContext.run({}, () => sentenceRoute(req, res, user));
  async function sentenceRoute(req, res, user) {
    if (!sources) throw new ApiError(404, 'not-found-route');
    const q = parseSentenceRequest(await readBody(req, 4_000));
    let text, from;
    if (q.ref.wordId) {
      const w = await sources.savedWord(user, q.ref.wordId);
      if (!w.ctx) throw new ApiError(404, 'not-in-source');
      text = w.ctx; from = w.lang;
    } else {
      const lib = sources.libraryText(user, q.ref.libraryId);
      if (!(await sources.contains(q.ref, user, q.text))) throw new ApiError(404, 'not-in-source');
      text = q.text; from = lib.lang;
    }
    if (!LANG_RE.test(from) || from === q.to) throw new ApiError(400, 'bad-request');
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    const one = async (src, a, b) => {
      const key = `s2-${user?.id ?? 0}-` + createHash('sha256').update(JSON.stringify([modelFor(llm, b), a, b, src])).digest('hex').slice(0, 32);
      const hit = await cache.get(key);
      if (hit?.text) return hit.text;
      const tr = ollamaTranslator({ ...llm, model: modelFor(llm, b), from: a, to: b, ...(chat ? { chat } : {}) });
      const [t] = await tr([src], [], ctl.signal);
      if (!t || t === src) throw new ApiError(502, 'llm-bad-response');
      if (!fellBack()) await cache.set(key, { text: t }); // a fallback answer is shown, not kept
      return t;
    };
    let out;
    if (pivot === 'en' && q.to === 'tr' && from !== 'en') {
      const en = await one(text, from, 'en');
      out = { text: await one(en, 'en', q.to), en };
    } else out = { text: await one(text, from, q.to) };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(out));
  }
}
