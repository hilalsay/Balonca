import type { WordMeaning } from '../types';

const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const DEFINE_ENABLED = BASE !== 'off';

export type DefineErrorCode = 'unavailable' | 'rate-limit' | 'network' | 'failed' | 'cancelled';
export class DefineError extends Error {
  constructor(public readonly code: DefineErrorCode) { super(code); this.name = 'DefineError'; }
}

/** Where the word was seen: the server only uses the sentence when it finds it there (phase 2). */
export type DefineRef = { v: string } | { libraryId: string } | { wordId: string };

/**
 * Meaning of a word, explained in `to`, from Balonca's server (dictionary + model). `ctx` is the sentence on
 * screen; `flush` syncs once when the server does not know a just-saved word yet.
 */
export async function defineWord(opts: {
  word: string; lang: string; to: string; ctx: string; ref: DefineRef; signal?: AbortSignal; fetchImpl?: typeof fetch; flush?: () => Promise<void>;
}): Promise<WordMeaning> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const ask = async () => {
    try {
      return await doFetch(`${BASE}/define`, {
        method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ word: opts.word, lang: opts.lang, to: opts.to, ctx: opts.ctx, ref: opts.ref }),
      });
    } catch {
      throw new DefineError(opts.signal?.aborted ? 'cancelled' : 'network');
    }
  };
  let res = await ask();
  if (res.status === 404 && opts.flush) { await opts.flush().catch(() => {}); res = await ask(); }
  const body = (await res.json().catch(() => null)) as (Partial<WordMeaning> & { error?: string }) | null;
  if (!res.ok || !body) {
    const e = body?.error;
    throw new DefineError(e === 'rate-limit' ? 'rate-limit' : e?.startsWith('llm-unreachable') || e === 'llm-model-missing' || !body ? 'unavailable' : 'failed');
  }
  if (!Array.isArray(body.senses) || typeof body.inContext !== 'string') throw new DefineError('failed');
  return {
    lemma: body.lemma ?? opts.word, inContext: body.inContext, senses: body.senses, source: body.source === 'ai' ? 'ai' : 'dictionary',
    ...(body.temporary ? { temporary: true } : {}), at: Date.now(),
  };
}

const POS = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'numeral', 'article', 'determiner', 'particle', 'proper noun', 'phrase'] as const;
/** i18n key for an English part-of-speech label, or null for one we do not translate. */
export const posKey = (pos: string) => {
  const p = pos.toLowerCase().trim();
  return (POS as readonly string[]).includes(p) ? (`pos.${p.replace(' ', '-')}` as const) : null;
};
