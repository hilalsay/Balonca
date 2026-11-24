// Removes repeated meanings from dictionary entries already stored ("onu; onu; o" -> "onu; o"), with the same rule as
// new entries (dictionary-entry.mjs). Touches only rows that change; no model calls.
//   node scripts/credit/dedupe-dictionary.mjs [--dry-run]      (BALONCA_DB, default ../balonca-api/data/balonca.db)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { list } from './dictionary-entry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.BALONCA_DB ?? path.join(here, '../../../balonca-api/data/balonca.db'));
db.exec('PRAGMA busy_timeout = 10000');
const dry = process.argv.includes('--dry-run');
const update = db.prepare('UPDATE dictionary SET data = ? WHERE lang = ? AND form = ?');
let changed = 0;
const rows = db.prepare("SELECT lang, form, data FROM dictionary WHERE source != 'skip'").all();
db.exec('BEGIN');
for (const r of rows) {
  let d;
  try { d = JSON.parse(r.data); } catch { continue; }
  const tr = list(d.tr), en = list(d.en);
  if (tr.length === (d.tr ?? []).length && en.length === (d.en ?? []).length) continue;
  changed++;
  if (!dry) update.run(JSON.stringify({ ...d, tr, en }), r.lang, r.form);
}
db.exec(dry ? 'ROLLBACK' : 'COMMIT');
console.log(`${dry ? '[dry run] ' : ''}${changed} of ${rows.length} entries had a repeated meaning${dry ? '' : ' and were fixed'}`);
