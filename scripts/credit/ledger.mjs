// Spending of the credit scripts, apart from the live site's daily budget: one usage folder per job
// (scripts/credit/out/usage/<job>), summed over every day and month.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out/usage');

/** Total dollars recorded in a usage folder. */
export async function spentIn(dir) {
  let usd = 0;
  try {
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      for (const line of (await readFile(path.join(dir, f), 'utf8')).split('\n')) if (line) usd += JSON.parse(line).usd ?? 0;
    }
  } catch {}
  return usd;
}

export function ledger(job) {
  const dir = path.join(root, job);
  let cache = { at: 0, usd: 0 };
  return {
    dir,
    /** Total for this job so far (re-read at most every 10 s). */
    async spent() {
      if (Date.now() - cache.at > 10_000) cache = { at: Date.now(), usd: await spentIn(dir) };
      return cache.usd;
    },
  };
}

/** Every job's total. */
export async function allSpent() {
  const out = {};
  try { for (const job of await readdir(root)) out[job] = await spentIn(path.join(root, job)); } catch {}
  return out;
}
