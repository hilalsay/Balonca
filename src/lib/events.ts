/**
 * Tells the server how the app is used (phase 5), for the admin panel: active minutes and a few kinds of events.
 * Only the event's kind and a short tag go out (a language code, a grade) — never words, sentences or texts.
 * Nothing without an account.
 */
import { account } from './account.svelte';

const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';
export type EventType = 'heartbeat' | 'video_open' | 'text_open' | 'word_save' | 'review';

export function report(type: EventType, meta?: Record<string, string | number>) {
  if (account.status !== 'in' || typeof fetch === 'undefined') return;
  void fetch(`${BASE}/events`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, meta }) }).catch(() => {});
}

/**
 * A heartbeat each minute while someone is really using the app: the tab is visible and they touched it in the
 * last three minutes, or a video or a text is playing (`busy`). One heartbeat = one active minute.
 */
export function startHeartbeat(busy: () => boolean): () => void {
  let last = Date.now();
  const seen = () => { last = Date.now(); };
  const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
  for (const e of evs) addEventListener(e, seen, { passive: true, capture: true });
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible' && (busy() || Date.now() - last < 180_000)) report('heartbeat');
  }, 60_000);
  return () => { clearInterval(timer); for (const e of evs) removeEventListener(e, seen, { capture: true }); };
}
