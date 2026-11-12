import type { WordMeaning } from '../types';

const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const DEFINE_ENABLED = BASE !== 'off';

export type DefineErrorCode = 'unavailable' | 'rate-limit' | 'network' | 'failed' | 'cancelled';
export class DefineError extends Error {
  constructor(public readonly code: DefineErrorCode) { super(code); this.name = 'DefineError'; }
}

/** Meaning of a saved word, explained in `to`, from Balonca's server (Wiktionary + local model). */
export async function defineWord(opts: {
  word: string; lang: string; to: string; ctx: string; signal?: AbortSignal; fetchImpl?: typeof fetch;
}): Promise<WordMeaning> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(`${BASE}/define`, {
      method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word: opts.word, lang: opts.lang, to: opts.to, ctx: opts.ctx }),
    });
  } catch {
    throw new DefineError(opts.signal?.aborted ? 'cancelled' : 'network');
  }
  const body = (await res.json().catch(() => null)) as (Partial<WordMeaning> & { error?: string }) | null;
  if (!res.ok || !body) {
    const e = body?.error;
    throw new DefineError(e === 'rate-limit' ? 'rate-limit' : e?.startsWith('llm-unreachable') || e === 'llm-model-missing' || !body ? 'unavailable' : 'failed');
  }
  if (!Array.isArray(body.senses) || typeof body.inContext !== 'string') throw new DefineError('failed');
  return { lemma: body.lemma ?? opts.word, inContext: body.inContext, senses: body.senses, source: body.source === 'ai' ? 'ai' : 'dictionary', at: Date.now() };
}

const POS = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'numeral', 'article', 'determiner', 'particle', 'proper noun', 'phrase'] as const;
/** i18n key for an English part-of-speech label, or null for one we do not translate. */
export const posKey = (pos: string) => {
  const p = pos.toLowerCase().trim();
  return (POS as readonly string[]).includes(p) ? (`pos.${p.replace(' ', '-')}` as const) : null;
};
