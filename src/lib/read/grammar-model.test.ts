import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fx from './grammar-model.fixtures.json';
import { EXAMPLES, promptId, systemPrompt, toAnalysis, validateAnswer, type ModelAnswer } from './grammar-model';
import type { UdToken } from './grammar';

// Parses of the prompt's examples (nl_core_news_md, en_core_web_sm), recorded once.
const parses = fx as Record<string, Record<string, UdToken[]>>;
const gold = ['nl', 'en'].flatMap((l) => readFileSync(new URL(`../../../tests/grammar-gold/${l}.jsonl`, import.meta.url), 'utf8').trim().split('\n')
  .map((x) => JSON.parse(x) as { id: string; text: string }));
const words = (s: string) => new Set(s.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
const clone = (a: ModelAnswer): ModelAnswer => JSON.parse(JSON.stringify(a));

describe('grammar by the model: prompt examples', () => {
  it('are not in the gold set, not even nearly (the evaluation would be meaningless)', () => {
    expect(EXAMPLES).toHaveLength(8);
    expect(EXAMPLES.filter((e) => e.lang === 'nl')).toHaveLength(6);
    for (const e of EXAMPLES) {
      const ew = words(e.text);
      for (const g of gold) {
        expect(g.text.trim().toLocaleLowerCase(), g.id).not.toBe(e.text.trim().toLocaleLowerCase());
        const gw = words(g.text), shared = [...ew].filter((w) => gw.has(w)).length;
        expect(shared / new Set([...ew, ...gw]).size, `${e.text} ~ ${g.id} ${g.text}`).toBeLessThan(0.5);
      }
    }
  });
  it('cover the cases the spec names, and each passes validation', () => {
    const kinds = new Set(EXAMPLES.flatMap((e) => e.answer.notes.map((n) => n.kind)));
    for (const k of ['inversion', 'separable', 'verbFinal', 'relative', 'modal', 'passive', 'question'] as const) expect(kinds, k).toContain(k);
    expect(EXAMPLES.some((e) => e.answer.notes.some((n) => n.kind === 'tense' && n.tense === 'perfect' && n.words.includes('zijn')))).toBe(true);
    for (const e of EXAMPLES) expect(validateAnswer(e.answer, e.text), e.text).toMatchObject({ ok: true });
  });
  it('the prompt is the same for every sentence of a language, and its id changes with it', () => {
    expect(systemPrompt('nl', 'tr')).toBe(systemPrompt('nl', 'tr'));
    expect(systemPrompt('nl', 'tr')).not.toMatch(/\{(language|ui language)\}|\$\{/);
    expect(promptId('nl', 'tr')).not.toBe(promptId('nl', 'en'));
  });
});

describe('grammar by the model: validation', () => {
  const e = EXAMPLES[1]; // Ze ruimt elke zaterdag haar kamer op.
  const reason = (a: unknown, d?: Parameters<typeof validateAnswer>[2]) => { const v = validateAnswer(a, e.text, d); return v.ok ? 'ok' : v.reason; };
  it('rejects each kind of bad answer', () => {
    expect(reason(null)).toBe('shape');
    const a1 = clone(e.answer); a1.parts.pop(); a1.parts.pop(); expect(reason(a1)).toBe('rebuild'); // 1
    const a2 = clone(e.answer); (a2.parts[0] as { role: string }).role = 'actor'; expect(reason(a2)).toBe('list'); // 2
    const a3 = clone(e.answer); (a3.notes[0] as { tense: string }).tense = 'aorist'; expect(reason(a3)).toBe('list');
    const a4 = clone(e.answer); a4.parts[0].clause = 3; expect(reason(a4)).toBe('clause');
    const a5 = clone(e.answer); a5.notes[1].words = ['belt', 'op']; expect(reason(a5)).toBe('word'); // 3
    const a6 = clone(e.answer); a6.notes[2].de = ['zaterdag', 'week']; expect(reason(a6)).toBe('word');
    expect(reason(e.answer, (f) => (f === 'opruimen' ? { separable: false } : null))).toBe('separable'); // 4
    expect(reason(e.answer, (f) => (f === 'opruimen' ? { separable: true } : null))).toBe('ok');
    expect(reason(e.answer, () => null)).toBe('ok'); // the dictionary does not know the verb
    for (const nu of ['x'.repeat(121), 'Zie https://example.com', '<b>let op</b>', '**let op**', 'zie [hier](x)']) { // 5
      expect(reason({ ...clone(e.answer), nuance: nu }), nu).toBe('nuance');
    }
    expect(reason({ ...clone(e.answer), nuance: 'Elke zaterdag: bir alışkanlık.' })).toBe('ok');
  });
});

describe('grammar by the model: conversion to the panel', () => {
  it('puts the labels on the parser tokens and fills the note templates', () => {
    for (const e of EXAMPLES) {
      const a = toAnalysis(e.answer, parses[e.lang][e.text], e.lang);
      expect(a.chunks.filter((c) => c.role !== 'punct').map((c) => c.text), e.text).toEqual(e.answer.parts.filter((p) => p.role !== 'punct').map((p) => p.text));
    }
    const sep = toAnalysis(EXAMPLES[1].answer, parses.nl[EXAMPLES[1].text], 'nl');
    expect(sep.notes.find((n) => n.kind === 'separable')?.p).toEqual({ verb: 'ruimt', prt: 'op' });
    expect(sep.notes.find((n) => n.kind === 'separable')?.tokens).toEqual([1, 6]);
    const perf = toAnalysis(EXAMPLES[5].answer, parses.nl[EXAMPLES[5].text], 'nl');
    expect(perf.notes.find((n) => n.kind === 'tense')?.p).toMatchObject({ tense: 'perfect', aux: 'zijn', verbs: 'zijn … gereden' });
    const rel = toAnalysis(EXAMPLES[3].answer, parses.nl[EXAMPLES[3].text], 'nl');
    expect(rel.clauses.map((c) => c.kind)).toEqual(['main', 'relative']);
    expect(rel.notes.find((n) => n.kind === 'articles')?.p).toEqual({ de: 'lamp, vader', het: 'plafond' });
    expect(rel.notes.filter((n) => n.kind === 'tense').map((n) => n.p.tense)).toEqual(['present', 'past']); // main clause first
  });
});
