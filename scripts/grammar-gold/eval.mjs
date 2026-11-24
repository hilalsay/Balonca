// Compares the current rules (grammar.ts on a spaCy parse) with the gold set.
// usage: node eval.mjs <grammar bundle.mjs> <gold dir> <parsed.json> [--diff]
import { readFileSync } from 'node:fs';
const [bundle, goldDir, parsedFile] = process.argv.slice(2);
const showDiff = process.argv.includes('--diff');
const { analyze } = await import(bundle);
const parsed = JSON.parse(readFileSync(parsedFile, 'utf8'));

const PUNCT = /^[.,!?;:]+$/;
function goldSpans(r) {
  let pos = 0;
  return r.parts.map(([text, role, clause]) => {
    // parts are written without punctuation; find each in order
    const words = text.split(' ');
    const start = r.text.indexOf(words[0], pos);
    const end = r.text.indexOf(words[words.length - 1], start) + words[words.length - 1].length;
    pos = end;
    return { start, end, role, kind: r.clauses[clause] };
  });
}

function systemNotes(a) {
  const out = [];
  for (const n of a.notes) {
    const p = n.p;
    if (n.kind === 'tense') out.push(`tense:${p.tense}` + (p.aux ? `:${p.aux}` : ''));
    else if (n.kind === 'separable') out.push(`separable:${p.prt.toLowerCase()}*`);
    else if (n.kind === 'negation') out.push(`negation:${p.word.toLowerCase()}`);
    else if (n.kind === 'degree') out.push(`degree:${p.kind}`);
    else if (n.kind === 'articles') out.push(`articles:${['de', 'het'].filter((k) => p[k]).map((k) => `${k}=${p[k].replace(/\s+/g, '')}`).join('|')}`);
    else out.push(n.kind);
  }
  return out;
}
const normArticles = (s) => { // articles:de=a,b|het=c -> sorted
  const [, body = ''] = s.split(':');
  return 'articles:' + body.split('|').filter(Boolean).map((g) => { const [k, v] = g.split('='); return `${k}=${v.split(',').map((x) => x.trim()).sort().join(',')}`; }).sort().join('|');
};
const norm = (n) => (n.startsWith('articles:') ? normArticles(n) : n);
// separable verbs are compared by their particle: the system says "op*", the gold set "opbellen"
const same = (s, g) => s === g || (s.endsWith('*') && g.startsWith(s.slice(0, -1)) && s.split(':')[0] === g.split(':')[0]);
const matches = (note, list) => list.some((m) => note === m || note.startsWith(m + ':') || note.split(':')[0] === m);

const level = process.argv.find((a) => a.startsWith('--level='))?.slice(8);
const tally = { words: 0, roleOk: 0, kindOk: 0, tp: 0, fp: 0, fn: 0, mustNot: 0, byKind: {} };
const bump = (k, f) => { (tally.byKind[k] ??= { tp: 0, fp: 0, fn: 0 })[f]++; };
const diffs = [];
for (const lang of ['nl', 'en']) {
  for (const line of readFileSync(`${goldDir}/${lang}.jsonl`, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    if (level && r.level !== level) continue;
    const toks = parsed[r.id];
    const a = analyze(toks.map(({ idx, ...t }) => t), lang);
    const spans = goldSpans(r);
    const roleOf = new Map(); a.chunks.forEach((c) => { for (let i = c.from; i <= c.to; i++) roleOf.set(i, c); });
    const wrong = [];
    toks.forEach((t, i) => {
      if (PUNCT.test(t.t)) return;
      const g = spans.find((s) => t.idx >= s.start && t.idx < s.end);
      if (!g) return;
      const c = roleOf.get(i);
      // "te" before an infinitive counts as part of the verb in the gold set
      const sysRole = c?.role === 'link' && /^(te|to)$/i.test(t.t) && g.role === 'verbPart' ? 'verbPart' : c?.role;
      const sysKind = a.clauses[c?.clause]?.kind;
      tally.words++;
      if (sysRole === g.role) tally.roleOk++; else wrong.push(`${t.t}: ${sysRole}≠${g.role}`);
      if (sysKind === g.kind) tally.kindOk++; else wrong.push(`${t.t}: clause ${sysKind}≠${g.kind}`);
    });
    const sys = systemNotes(a).map(norm), exp = r.notes.map(norm), opt = r.optional;
    const missing = [], extra = [], forbidden = [];
    for (const e of exp) { if (sys.some((s) => same(s, e))) { tally.tp++; bump(e.split(':')[0], 'tp'); } else { tally.fn++; bump(e.split(':')[0], 'fn'); missing.push(e); } }
    for (const s of sys) {
      if (exp.some((e) => same(s, e)) || matches(s, opt)) continue;
      tally.fp++; bump(s.split(':')[0], 'fp'); extra.push(s);
      if (matches(s, r.mustNot)) { tally.mustNot++; forbidden.push(s); }
    }
    if (wrong.length || missing.length || extra.length) diffs.push({ id: r.id, text: r.text, wrong, missing, extra, forbidden });
  }
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
console.log(`words ${tally.words} | role accuracy ${pct(tally.roleOk, tally.words)} | clause-kind accuracy ${pct(tally.kindOk, tally.words)}`);
console.log(`notes: precision ${pct(tally.tp, tally.tp + tally.fp)} | recall ${pct(tally.tp, tally.tp + tally.fn)} | mustNot violations ${tally.mustNot}`);
console.log('per note kind (precision / recall):');
for (const [k, v] of Object.entries(tally.byKind).sort()) console.log(`  ${k.padEnd(11)} ${pct(v.tp, v.tp + v.fp).padStart(6)} / ${pct(v.tp, v.tp + v.fn).padStart(6)}  (tp ${v.tp}, fp ${v.fp}, fn ${v.fn})`);
if (showDiff) for (const d of diffs) console.log(`\n${d.id} ${d.text}\n  roles: ${d.wrong.join('; ') || 'ok'}\n  missing: ${d.missing.join(' ') || '-'}\n  extra: ${d.extra.join(' ') || '-'}${d.forbidden.length ? `\n  FORBIDDEN: ${d.forbidden.join(' ')}` : ''}`);
