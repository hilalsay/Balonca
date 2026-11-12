import type { Cue } from '../types';
import { TranslateError } from './runner';

/** Same base as the subtitle service (nginx proxies /api). */
const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export const SERVER_TRANSLATE_ENABLED = BASE !== 'off';

export type ServerEvent =
  | { type: 'meta'; total: number; model: string; cached: number }
  | { type: 'queued'; ahead: number }
  | { type: 'cues'; done: number; cues: Cue[] }
  | { type: 'ping' }
  | { type: 'done' }
  | { type: 'error'; error: string };

const CODES: Record<string, TranslateError['code']> = {
  'rate-limit': 'rate-limit', busy: 'busy', cancelled: 'cancelled', 'bad-request': 'bad-response',
  'llm-unreachable': 'unavailable', 'llm-model-missing': 'unavailable', 'llm-failed': 'api', 'llm-bad-response': 'bad-response',
  timeout: 'api',
};

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
 * Translates a track with Balonca's own server (local Ollama model). The server regroups subtitle lines into
 * sentences, so the result has its own timings (one cue per sentence). `onCues` receives them in order as they
 * are translated; the returned promise resolves with all of them.
 */
export async function serverTranslate(opts: {
  cues: Cue[]; from: string; to: string; signal: AbortSignal;
  onCues?: (cues: Cue[], done: number, total: number) => void;
  onQueued?: (ahead: number) => void;
  fetchImpl?: typeof fetch;
}): Promise<Cue[]> {
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(`${BASE}/translate`, {
      method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: opts.from, to: opts.to, cues: opts.cues.map(({ start, end, text }) => ({ start, end, text })) }),
    });
  } catch {
    throw new TranslateError(opts.signal.aborted ? 'cancelled' : 'network');
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new TranslateError(body?.error ? (CODES[body.error] ?? 'api') : 'unavailable');
  }
  const all: Cue[] = [];
  let total = 0, finished = false;
  try {
    for await (const ev of readEvents(res.body)) {
      if (ev.type === 'meta') total = ev.total;
      else if (ev.type === 'queued') opts.onQueued?.(ev.ahead);
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
