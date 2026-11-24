import type { Cue, SavedWord, StoredTrack } from '../types';

const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const SENTENCE_ENABLED = BASE !== 'off';

/** The line on screen at the word's moment in a track of that video (respecting the track's sync offset). */
export function lineAt(tracks: StoredTrack[], lang: string, t: number): string | null {
  // A finished track before one still being written; the user's own (manual) ones are just as good.
  const order = [...tracks].filter((x) => x.lang === lang).sort((a, b) => Number(a.label.endsWith('…)')) - Number(b.label.endsWith('…)')));
  for (const tr of order) {
    const at = t - tr.offset;
    const hit = tr.cues.find((c: Cue) => c.start <= at + 0.05 && at < c.end);
    if (hit?.text.trim()) return hit.text.trim();
  }
  return null;
}

/** The language a card should show its translation and meaning in: the chosen one, unless that is the word's own. */
export const shownLang = (word: SavedWord, pref: string): string | null => (pref && pref !== word.lang ? pref : null);

export class SentenceError extends Error {
  constructor(public readonly code: 'unavailable' | 'rate-limit' | 'network' | 'failed' | 'cancelled') { super(code); }
}

/** What /api/sentence translates: a saved word's sentence, or a sentence of a library text (phase 2). */
export type SentenceSource = { wordId: string } | { libraryId: string; text: string };

/**
 * One sentence translated by Balonca's server, which reads it from the account itself. Something just saved may
 * not have reached the account yet: then the device syncs once and asks again. `en`: the English it was made
 * from (Turkish via English).
 */
export async function translateSentence(opts: { source: SentenceSource; to: string; signal?: AbortSignal; fetchImpl?: typeof fetch; flush?: () => Promise<void> }): Promise<{ text: string; en?: string }> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  const ask = async () => {
    try {
      return await doFetch(`${BASE}/sentence`, {
        method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...opts.source, to: opts.to }),
      });
    } catch {
      throw new SentenceError(opts.signal?.aborted ? 'cancelled' : 'network');
    }
  };
  let res = await ask();
  if (res.status === 404 && opts.flush) { await opts.flush().catch(() => {}); res = await ask(); }
  const body = (await res.json().catch(() => null)) as { text?: string; en?: string; error?: string } | null;
  if (!res.ok || typeof body?.text !== 'string') {
    const e = body?.error ?? '';
    throw new SentenceError(e === 'rate-limit' ? 'rate-limit' : e.startsWith('llm-unreachable') || e === 'llm-model-missing' || e === 'not-in-source' || e === 'not-in-library' || !body ? 'unavailable' : 'failed');
  }
  return { text: body.text, ...(typeof body.en === 'string' ? { en: body.en } : {}) };
}
