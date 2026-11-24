// Scores grammar analyses against the gold set (shared by eval.mjs and scripts/grammar-eval.mjs).
// An analysis is the `Analysis` of src/lib/read/grammar.ts; `toks` are the parser's tokens with their offsets (`idx`).

const PUNCT = /^[.,!?;:]+$/;
export function goldSpans(r) {
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

export function systemNotes(a) {
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

export const newTally = () => ({ sentences: 0, words: 0, roleOk: 0, kindOk: 0, tp: 0, fp: 0, fn: 0, mustNot: 0, byKind: {} });

/** Adds one sentence to `tally`; returns its differences (for --diff). */
export function scoreOne(tally, r, toks, a) {
  const bump = (k, f) => { (tally.byKind[k] ??= { tp: 0, fp: 0, fn: 0 })[f]++; };
  tally.sentences++;
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
  return wrong.length || missing.length || extra.length ? { id: r.id, text: r.text, wrong, missing, extra, forbidden } : null;
}

export const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
