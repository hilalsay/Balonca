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

/** One sentence translated by Balonca's server (local model), for a saved word whose video had no such track. */
export async function translateSentence(opts: { text: string; from: string; to: string; signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(`${BASE}/sentence`, {
      method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: opts.text, from: opts.from, to: opts.to }),
    });
  } catch {
    throw new SentenceError(opts.signal?.aborted ? 'cancelled' : 'network');
  }
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof body?.text !== 'string') {
    const e = body?.error ?? '';
    throw new SentenceError(e === 'rate-limit' ? 'rate-limit' : e.startsWith('llm-unreachable') || e === 'llm-model-missing' || !body ? 'unavailable' : 'failed');
  }
  return body.text;
}
