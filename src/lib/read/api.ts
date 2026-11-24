import type { UdToken } from './grammar';
import type { ModelAnswer } from './grammar-model';

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

/** Who labelled the opened sentence: the model (its answer, turned into the panel by grammar-model.ts) or the parser. */
export type GrammarSource = { source: 'model'; answer: ModelAnswer } | { source: 'parser' };
const parsed = new Map<string, UdToken[]>();
const explained = new Map<string, GrammarSource>();

/**
 * Parses sentences on the server (spaCy). Results are kept for this visit. With `explain` (and `ui`, the interface
 * language), the first sentence is the one the reader opened: the server may label it with the model.
 */
export async function parseSentences(lang: string, sents: string[], opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; ref: { libraryId: string }; explain?: boolean; ui?: string }): Promise<UdToken[][]> {
  return (await grammarFor(lang, sents, opts)).docs;
}

/** Like parseSentences, and also who labelled the first sentence (when `explain`). */
export async function grammarFor(lang: string, sents: string[], opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; ref: { libraryId: string }; explain?: boolean; ui?: string }): Promise<{ docs: UdToken[][]; grammar: GrammarSource | null }> {
  const key = (s: string) => `${lang}\n${s}`;
  // The opened sentence needs its answer even when it was parsed before (as the "next" one).
  const ask = opts.explain && sents.length > 0 && !explained.has(key(sents[0]));
  const todo = [...new Set(sents.filter((s, i) => !parsed.has(key(s)) || (ask && i === 0)))];
  if (ask && todo[0] !== sents[0]) todo.unshift(sents[0]);
  if (todo.length) {
    const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
    let res: Response;
    try {
      res = await doFetch(`${BASE}/parse`, {
        method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang, ref: opts.ref, sents: todo, ...(ask ? { explain: true, ui: opts.ui ?? '' } : {}) }),
      });
    } catch {
      throw new GrammarError(opts.signal?.aborted ? 'cancelled' : 'unavailable');
    }
    const body = (await res.json().catch(() => null)) as { docs?: UdToken[][]; grammar?: GrammarSource; error?: string } | null;
    if (!res.ok || !Array.isArray(body?.docs)) {
      throw new GrammarError(body?.error === 'unsupported-lang' ? 'unsupported' : body?.error === 'rate-limit' ? 'rate-limit' : 'unavailable');
    }
    todo.forEach((s, i) => parsed.set(key(s), body.docs![i] ?? []));
    if (ask) explained.set(key(sents[0]), body.grammar?.source === 'model' && body.grammar.answer ? body.grammar : { source: 'parser' });
    if (parsed.size > 4000) parsed.delete(parsed.keys().next().value!);
    if (explained.size > 4000) explained.delete(explained.keys().next().value!);
  }
  return { docs: sents.map((s) => parsed.get(key(s)) ?? []), grammar: opts.explain && sents.length ? explained.get(key(sents[0])) ?? null : null };
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
