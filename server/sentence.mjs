// POST /api/sentence: one saved sentence in another language (the "My words" cards), via the local model.
import { createHash } from 'node:crypto';
import { ApiError, LANG_RE } from './lib.mjs';
import { diskCache, modelFor, ollamaTranslator, readBody } from './translate.mjs';

/** Validates the POST body: {text, from, to}. */
export function parseSentenceRequest(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { throw new ApiError(400, 'bad-request'); }
  const text = String(b?.text ?? '').trim(), from = String(b?.from ?? '').toLowerCase(), to = String(b?.to ?? '').toLowerCase();
  if (!text || text.length > 500) throw new ApiError(400, 'bad-request');
  if (!LANG_RE.test(from) || !LANG_RE.test(to) || from === to) throw new ApiError(400, 'bad-request');
  return { text, from, to };
}

/** Results are cached on disk per sentence, languages and model. `chat` is injectable for tests. */
export function createSentenceHandler({ llm, cacheDir = '', chat } = {}) {
  const cache = diskCache(cacheDir);
  return async function sentenceRoute(req, res) {
    const q = parseSentenceRequest(await readBody(req, 4_000));
    const key = 's1-' + createHash('sha256').update(JSON.stringify([modelFor(llm, q.to), q.from, q.to, q.text])).digest('hex').slice(0, 32);
    let out = await cache.get(key);
    if (!out) {
      const ctl = new AbortController();
      res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
      const tr = ollamaTranslator({ ...llm, model: modelFor(llm, q.to), from: q.from, to: q.to, ...(chat ? { chat } : {}) });
      const [text] = await tr([q.text], [], ctl.signal);
      if (!text || text === q.text) throw new ApiError(502, 'llm-bad-response');
      out = { text };
      await cache.set(key, out);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(out));
  };
}
