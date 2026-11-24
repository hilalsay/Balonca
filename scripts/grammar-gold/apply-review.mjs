// Reads a filled-in review sheet back into the gold set.
// usage: node scripts/grammar-gold/apply-review.mjs <filled.csv> --reviewer=<name> [--gold=tests/grammar-gold] [--dry-run]
// Rows marked OK with no comment and no edited cell get checked_by = <name>. Every row with a comment, an edited cell
// or a "no" is only listed (and written to <filled>.to-resolve.md): those decisions stay with a person.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyReview, parseCsv, pyJson } from './review-lib.mjs';

const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const reviewer = opt('reviewer'), dir = opt('gold') ?? 'tests/grammar-gold', dry = process.argv.includes('--dry-run');
if (!file || !reviewer) { console.error('usage: apply-review.mjs <filled.csv> --reviewer=<name> [--gold=dir] [--dry-run]'); process.exit(2); }

const rows = parseCsv(readFileSync(file, 'utf8'));
const byLang = Object.fromEntries(['nl', 'en'].map((l) => [l, readFileSync(`${dir}/${l}.jsonl`, 'utf8').trim().split('\n').map((x) => JSON.parse(x))]));
const res = applyReview([...byLang.nl, ...byLang.en], rows, reviewer);
const lines = res.toResolve.map((t) => [`### ${t.id}: ${t.text}`, `- verdict: ${t.verdict}`, ...(t.comment ? [`- comment: ${t.comment}`] : []),
  ...t.edited.map((e) => `- ${e.column} edited:\n  - was: ${e.was}\n  - now: ${e.now}`)].join('\n'));
if (!dry) {
  for (const l of ['nl', 'en']) {
    const recs = res.records.filter((r) => r.lang === l);
    writeFileSync(`${dir}/${l}.jsonl`, recs.map(pyJson).join('\n') + '\n');
  }
  if (lines.length) writeFileSync(`${file}.to-resolve.md`, `# Review rows to resolve (${lines.length})\n\n${lines.join('\n\n')}\n`);
}
console.log(`${dry ? '[dry run] ' : ''}checked_by=${reviewer}: ${res.checked.length} records${res.checked.length ? ` (${res.checked.join(' ')})` : ''}`);
if (res.unknown.length) console.log(`unknown ids, ignored: ${res.unknown.join(' ')}`);
console.log(`to resolve by hand: ${res.toResolve.length}${lines.length && !dry ? ` (also in ${file}.to-resolve.md)` : ''}`);
if (lines.length) console.log('\n' + lines.join('\n\n'));
