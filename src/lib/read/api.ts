import type { UdToken } from './grammar';

/** Same base as the other services (nginx proxies /api). */
const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const NLP_ENABLED = BASE !== 'off';

export interface NlpInfo { parse: string[]; tts: string[] }
let info: Promise<NlpInfo> | null = null;

/** Languages the server can explain (grammar) and read aloud. Asked once; asked again after a failure. */
export function nlpInfo(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<NlpInfo> {
  if (!NLP_ENABLED) return Promise.resolve({ parse: [], tts: [] });
  info ??= fetchImpl(`${BASE}/nlp`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: Partial<NlpInfo>) => ({ parse: Array.isArray(j.parse) ? j.parse : [], tts: Array.isArray(j.tts) ? j.tts : [] }))
    .catch(() => { info = null; return { parse: [], tts: [] }; });
  return info;
}

export class GrammarError extends Error {
  constructor(public readonly code: 'unsupported' | 'unavailable' | 'rate-limit' | 'cancelled') { super(code); }
}

const parsed = new Map<string, UdToken[]>();

/** Parses sentences on the server (spaCy). Results are kept for this visit. */
export async function parseSentences(lang: string, sents: string[], opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; ref: { libraryId: string } }): Promise<UdToken[][]> {
  const key = (s: string) => `${lang}\n${s}`;
  const todo = [...new Set(sents.filter((s) => !parsed.has(key(s))))];
  if (todo.length) {
    const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
    let res: Response;
    try {
      res = await doFetch(`${BASE}/parse`, {
        method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang, ref: opts.ref, sents: todo }),
      });
    } catch {
      throw new GrammarError(opts.signal?.aborted ? 'cancelled' : 'unavailable');
    }
    const body = (await res.json().catch(() => null)) as { docs?: UdToken[][]; error?: string } | null;
    if (!res.ok || !Array.isArray(body?.docs)) {
      throw new GrammarError(body?.error === 'unsupported-lang' ? 'unsupported' : body?.error === 'rate-limit' ? 'rate-limit' : 'unavailable');
    }
    todo.forEach((s, i) => parsed.set(key(s), body.docs![i] ?? []));
    if (parsed.size > 4000) parsed.delete(parsed.keys().next().value!);
  }
  return sents.map((s) => parsed.get(key(s)) ?? []);
}

/**
 * What Balonca's voice reads (phase 2: never free text): one word, a sentence of a library text (the server
 * checks it is in the text), or the sentence a saved word came from.
 */
export type SpeechSource = { word: string } | { lib: string; text: string } | { wordId: string };

/** Address of Balonca's own voice reading `src` (audio/wav, cached by the server and the browser). */
export function ttsUrl(lang: string, src: SpeechSource): string {
  const q = new URLSearchParams({ lang });
  if ('word' in src) q.set('word', src.word);
  else if ('wordId' in src) q.set('wordId', src.wordId);
  else { q.set('lib', src.lib); q.set('text', src.text.replace(/\s+/g, ' ').trim().slice(0, 600)); }
  return `${BASE}/tts?${q}`;
}
