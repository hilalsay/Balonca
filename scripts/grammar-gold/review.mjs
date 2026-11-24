// Writes the review sheet for a person who knows Dutch/English: tests/grammar-gold/review.csv.
// usage: node scripts/grammar-gold/review.mjs [gold dir] [out.csv]
// Fill in "OK?" (ok/yes/evet or no) and "comment", then: node scripts/grammar-gold/apply-review.mjs <filled.csv> --reviewer=<name>
import { readFileSync, writeFileSync } from 'node:fs';
import { rowOf, toCsv } from './review-lib.mjs';

const dir = process.argv[2] ?? 'tests/grammar-gold';
const out = process.argv[3] ?? `${dir}/review.csv`;
const records = ['nl', 'en'].flatMap((l) => readFileSync(`${dir}/${l}.jsonl`, 'utf8').trim().split('\n').map((x) => JSON.parse(x)));
writeFileSync(out, toCsv(records.map(rowOf)));
console.log(`${out}: ${records.length} rows (${records.filter((r) => r.checked_by === 'draft').length} still draft)`);
