// When Tinker stops: the service then runs on Ollama alone. Decided at start-up, so caches are keyed by the model that
// really writes (answers a fallback writes are not cached, which would leave every translation uncached for good).
//   TINKER_END=2026-12-10   the first day without Tinker (local midnight)
//   credit marker           written when Tinker says the credit is gone (402/403); delete it to try Tinker again
// Crossing either while running, the service exits so pm2 restarts it in Ollama mode.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** '' when Tinker may be used, otherwise why not: 'date' (TINKER_END reached) or 'credit' (marker file present). */
export function tinkerOff({ end = '', markerFile = '', now = Date.now() } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(end).trim());
  if (m && now >= new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) return 'date';
  if (markerFile && existsSync(markerFile)) return 'credit';
  return '';
}

/** Records that the credit is gone (kept across restarts and deploys). */
export function markCreditGone(markerFile, now = Date.now()) {
  if (!markerFile) return;
  try { mkdirSync(path.dirname(markerFile), { recursive: true }); writeFileSync(markerFile, `${new Date(now).toISOString()} Tinker answered 402/403\n`); } catch {}
}

/**
 * Restarts the service into Ollama mode once: under pm2 (pm_id set) it exits after `delayMs` (in-flight work is saved
 * per batch); otherwise it only logs, and calls keep falling back to Ollama one by one.
 */
export function restarter({ env = process.env, exit = (c) => process.exit(c), log = console.log, delayMs = 60_000 } = {}) {
  let planned = false;
  return (why) => {
    if (planned) return false;
    planned = true;
    if (env.pm_id === undefined) { log(`Tinker off (${why}); restart the service to run on Ollama alone`); return false; }
    log(`Tinker off (${why}): restarting in ${Math.round(delayMs / 1000)} s to run on Ollama alone`);
    setTimeout(() => exit(0), delayMs).unref?.();
    return true;
  };
}
