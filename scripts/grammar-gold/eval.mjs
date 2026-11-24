// Compares the current rules (grammar.ts on a spaCy parse) with the gold set.
// usage: node eval.mjs <grammar bundle.mjs> <gold dir> <parsed.json> [--diff]
import { readFileSync } from 'node:fs';
import { newTally, pct, scoreOne } from './score.mjs';
const [bundle, goldDir, parsedFile] = process.argv.slice(2);
const showDiff = process.argv.includes('--diff');
const { analyze } = await import(bundle);
const parsed = JSON.parse(readFileSync(parsedFile, 'utf8'));

const level = process.argv.find((a) => a.startsWith('--level='))?.slice(8);
const tally = newTally();
const diffs = [];
for (const lang of ['nl', 'en']) {
  for (const line of readFileSync(`${goldDir}/${lang}.jsonl`, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    if (level && r.level !== level) continue;
    const toks = parsed[r.id];
    const a = analyze(toks.map(({ idx, ...t }) => t), lang);
    const d = scoreOne(tally, r, toks, a);
    if (d) diffs.push(d);
  }
}
console.log(`words ${tally.words} | role accuracy ${pct(tally.roleOk, tally.words)} | clause-kind accuracy ${pct(tally.kindOk, tally.words)}`);
console.log(`notes: precision ${pct(tally.tp, tally.tp + tally.fp)} | recall ${pct(tally.tp, tally.tp + tally.fn)} | mustNot violations ${tally.mustNot}`);
console.log('per note kind (precision / recall):');
for (const [k, v] of Object.entries(tally.byKind).sort()) console.log(`  ${k.padEnd(11)} ${pct(v.tp, v.tp + v.fp).padStart(6)} / ${pct(v.tp, v.tp + v.fn).padStart(6)}  (tp ${v.tp}, fp ${v.fp}, fn ${v.fn})`);
if (showDiff) for (const d of diffs) console.log(`\n${d.id} ${d.text}\n  roles: ${d.wrong.join('; ') || 'ok'}\n  missing: ${d.missing.join(' ') || '-'}\n  extra: ${d.extra.join(' ') || '-'}${d.forbidden.length ? `\n  FORBIDDEN: ${d.forbidden.join(' ')}` : ''}`);
