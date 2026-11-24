import type { Cue } from '../types';
import { TranslateError } from './runner';

/** Same base as the subtitle service (nginx proxies /api). */
const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const SERVER_TRANSLATE_ENABLED = BASE !== 'off';

export type ServerEvent =
  | { type: 'meta'; total: number; model: string; cached: number }
  | { type: 'queued'; ahead: number }
  | { type: 'cues'; done: number; cues: (Cue & { i?: number; src?: string })[] }
  | { type: 'pivot'; done: number; total: number }
  | { type: 'ping' }
  | { type: 'done' }
  | { type: 'error'; error: string };

const CODES: Record<string, TranslateError['code']> = {
  'rate-limit': 'rate-limit', busy: 'busy', cancelled: 'cancelled', 'bad-request': 'bad-response',
  'llm-unreachable': 'unavailable', 'llm-model-missing': 'unavailable', 'llm-failed': 'api', 'llm-bad-response': 'bad-response',
  timeout: 'api', 'no-subs': 'unavailable', 'not-in-library': 'unavailable', 'login-required': 'unavailable',
};

/**
 * What the server translates (it reads the text itself, phase 2): a YouTube subtitle, or a text of the user's
 * library (synced to the account first).
 */
export type TranslateSource = { v: string; code: string; kind: 'auto' | 'manual' } | { libraryId: string };

/**
 * A translated line that holds pieces of the model's JSON (`It's just a ditch.”, “2”:”What…`). Older server
 * versions saved such lines; a track containing one is translated again. Same test as `isLeak` in
 * server/translate.mjs.
 */
export function isBrokenLine(text: string): boolean {
  const t = text.replace(/[“”„‟″〝〞＂]/g, '"');
  return /"\s*\d+\s*"\s*:/.test(t) || /"\s*,\s*"/.test(t) || /^\s*[{[]?\s*"?\d+"?\s*:\s*"/.test(t);
}

/** Splits a byte stream into NDJSON events. Exported for tests. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? dec.decode() : dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) { try { yield JSON.parse(line) as ServerEvent; } catch { /* ignore a broken line */ } }
    }
    if (done) break;
  }
  if (buf.trim()) { try { yield JSON.parse(buf) as ServerEvent; } catch {} }
}

/**
 * Translates a YouTube subtitle or a library text with Balonca's own server. For a video the server regroups
 * subtitle lines into sentences, so the result has its own timings (one cue per sentence); for a text every cue
 * carries the sentence it translates (`i`, `src`). `onCues` receives them in order as they are translated; the
 * returned promise resolves with all of them.
 */
export async function serverTranslate(opts: {
  source: TranslateSource; to: string; signal: AbortSignal;
  onCues?: (cues: (Cue & { i?: number; src?: string })[], done: number, total: number) => void;
  onQueued?: (ahead: number) => void;
  /** Progress of the English made first (Turkish via English). */
  onPivot?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
}): Promise<Cue[]> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(`${BASE}/translate`, {
      method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...opts.source, to: opts.to }),
    });
  } catch {
    throw new TranslateError(opts.signal.aborted ? 'cancelled' : 'network');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new TranslateError(body?.error ? (CODES[body.error] ?? 'api') : 'unavailable');
  }
  const all: (Cue & { i?: number; src?: string })[] = [];
  let total = 0, finished = false;
  try {
    for await (const ev of readEvents(res.body)) {
      if (ev.type === 'meta') total = ev.total;
      else if (ev.type === 'queued') opts.onQueued?.(ev.ahead);
      else if (ev.type === 'pivot') opts.onPivot?.(ev.done, ev.total);
      else if (ev.type === 'cues') { all.push(...ev.cues); opts.onCues?.(ev.cues, ev.done, total); }
      else if (ev.type === 'error') throw new TranslateError(CODES[ev.error] ?? 'api', ev.error);
      else if (ev.type === 'done') finished = true;
    }
  } catch (e) {
    if (e instanceof TranslateError) throw e;
    throw new TranslateError(opts.signal.aborted ? 'cancelled' : 'network');
  }
  if (!finished) throw new TranslateError(opts.signal.aborted ? 'cancelled' : 'network', 'stream ended early');
  return all;
}

/** Settings the server announces (GET /api/config). `pivot: 'en'`: Turkish is made from the English translation. */
export const serverConfig = $state({ pivot: 'en' as 'en' | 'off' });
if (SERVER_TRANSLATE_ENABLED && typeof fetch !== 'undefined' && typeof window !== 'undefined') {
  void fetch(`${BASE}/config`).then((r) => (r.ok ? r.json() : null)).then((c: { pivot?: string } | null) => {
    if (c?.pivot === 'off' || c?.pivot === 'en') serverConfig.pivot = c.pivot;
  }).catch(() => {});
}
