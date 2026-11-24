// Nightly backup of the SQLite database (phase 6): a consistent copy made while the server runs (VACUUM INTO),
// readable only by its owner, kept for 14 days. Run from cron:
//   node scripts/backup-db.mjs <database file> <backup folder> [days]
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export function backup(dbFile, dir, { days = 14, now = Date.now() } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const out = path.join(dir, `balonca-${stamp}.db`);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(out); } finally { db.close(); }
  chmodSync(out, 0o600);
  // The copy must open and pass SQLite's own check, or the night counts as failed.
  const check = new DatabaseSync(out, { readOnly: true });
  try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('integrity check failed'); } finally { check.close(); }
  const removed = [];
  for (const f of readdirSync(dir)) {
    if (!/^balonca-[\d-]+\.db$/.test(f)) continue;
    const p = path.join(dir, f);
    if (now - statSync(p).mtimeMs > days * 86_400_000) { unlinkSync(p); removed.push(f); }
  }
  return { out, removed };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const [dbFile, dir, days] = process.argv.slice(2);
  if (!dbFile || !dir) { console.error('usage: node scripts/backup-db.mjs <database file> <backup folder> [days]'); process.exit(2); }
  try {
    const r = backup(dbFile, dir, { days: Number(days) || 14 });
    console.log(`${new Date().toISOString()} backup ${path.basename(r.out)} ok${r.removed.length ? `, removed ${r.removed.length} old` : ''}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} backup FAILED: ${e?.message ?? e}`);
    process.exit(1);
  }
}
