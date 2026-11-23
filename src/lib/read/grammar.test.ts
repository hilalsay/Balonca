import { describe, expect, it } from 'vitest';
import fx from './ud.fixtures.json';
import { analyze, toUD, type Note, type UdToken } from './grammar';

// Real parses from the server (spaCy), recorded once: see ud.fixtures.json.
const parses = fx as Record<string, Record<string, UdToken[]>>;
const run = (lang: string, s: string) => analyze(parses[lang][s], lang);
const roles = (lang: string, s: string) => run(lang, s).chunks.filter((c) => c.role !== 'punct').map((c) => `${c.role}:${c.text}`);
const note = (lang: string, s: string, kind: Note['kind']) => run(lang, s).notes.find((n) => n.kind === kind);
const kinds = (lang: string, s: string) => run(lang, s).notes.map((n) => n.kind);

describe('Dutch', () => {
  const s = 'Gisteren heb ik met mijn zus een nieuwe fiets gekocht.';
  it('splits a sentence into its parts', () => {
    expect(roles('nl', s)).toEqual(['adverbial:Gisteren', 'verb:heb', 'subject:ik', 'adverbial:met mijn zus', 'object:een nieuwe fiets', 'verbPart:gekocht']);
  });
  it('names the tense and shows how it is built', () => {
    expect(note('nl', s, 'tense')?.p).toMatchObject({ tense: 'perfect', verbs: 'heb … gekocht', aux: 'hebben', name: 'voltooid tegenwoordige tijd (v.t.t.)' });
  });
  it('explains inversion and the verb bracket', () => {
    expect(note('nl', s, 'inversion')?.p).toEqual({ first: 'Gisteren', verb: 'heb', subject: 'ik' });
    expect(note('nl', s, 'bracket')?.p).toEqual({ verb: 'heb', rest: 'gekocht' });
  });
  it('lists de- and het-words', () => {
    expect(note('nl', s, 'articles')?.p).toEqual({ de: 'zus, fiets' });
    expect(note('nl', 'Het huis werd in 1900 gebouwd.', 'articles')?.p).toEqual({ het: 'huis' });
  });
  it('sees the verb go last in subordinate clauses, and one tense note covers them all', () => {
    const t = 'Ik weet niet of hij morgen komt, omdat hij ziek is.';
    const vf = run('nl', t).notes.filter((n) => n.kind === 'verbFinal');
    expect(vf.map((n) => n.p)).toEqual([{ verb: 'komt', link: 'of' }]); // one note per rule…
    expect(vf[0].tokens).toHaveLength(2); // …lighting up both verbs
    expect(run('nl', t).notes.filter((n) => n.kind === 'tense')).toHaveLength(1);
    expect(note('nl', t, 'negation')?.p).toEqual({ word: 'niet', kind: 'nl.niet' });
    const sub = run('nl', t).chunks.filter((c) => c.clause !== 0 && c.role !== 'punct').map((c) => c.text);
    expect(sub).toEqual(['of', 'hij', 'morgen', 'komt', 'omdat', 'hij', 'ziek', 'is']);
  });
  it('finds separable verbs, passives, questions, commands and more', () => {
    expect(note('nl', 'Hij belt zijn moeder elke avond op.', 'separable')?.p).toEqual({ verb: 'belt', prt: 'op' });
    expect(note('nl', 'Het huis werd in 1900 gebouwd.', 'passive')?.p).toMatchObject({ aux: 'werd', part: 'gebouwd' });
    expect(kinds('nl', 'Kun je de deur even dichtdoen?')).toEqual(expect.arrayContaining(['question', 'modal']));
    expect(note('nl', 'Waar woon je?', 'whQuestion')?.p).toEqual({ wh: 'Waar', verb: 'woon' });
    expect(kinds('nl', 'Kom hier!')).toEqual(['imperative']);
    expect(note('nl', 'Ik heb geen tijd.', 'negation')?.p.kind).toBe('nl.geen');
    expect(note('nl', 'Ze probeert te slapen.', 'teInf')?.p).toEqual({ te: 'te', verb: 'slapen', main: 'probeert' });
    expect(kinds('nl', 'Ze probeert te slapen.')).not.toContain('bracket');
    expect(note('nl', 'Ik zal je helpen.', 'tense')?.p.tense).toBe('future');
    expect(note('nl', 'Hij vergist zich vaak.', 'reflexive')?.p).toEqual({ pron: 'zich', verb: 'vergist' });
    expect(note('nl', 'Dit huis is groter dan dat huis.', 'degree')?.p).toEqual({ word: 'groter', base: 'groot', kind: 'cmp' });
    expect(note('nl', 'Wij zijn naar huis gegaan.', 'tense')?.p.aux).toBe('zijn');
    expect(note('nl', 'Als het regent, blijf ik thuis.', 'inversion')?.p.first).toBe('Als het regent');
    expect(note('nl', 'De man die daar staat, is mijn vader.', 'relative')?.p).toEqual({ pron: 'die', noun: 'man' });
  });
  it('does not say "inversion" for a sentence that starts with its subject', () => {
    expect(kinds('nl', 'Hij belt zijn moeder elke avond op.')).not.toContain('inversion');
    expect(kinds('nl', 'De man die daar staat, is mijn vader.')).not.toContain('inversion');
  });
  it('repairs a subject the parser took for an object', () => {
    expect(roles('nl', 'De kinderen spelen in de tuin en de hond slaapt.')).toContain('subject:de hond');
  });
});

describe('other languages', () => {
  it('German: TIGER labels become the same structure', () => {
    const s = 'Gestern habe ich mit meiner Schwester ein neues Fahrrad gekauft.';
    expect(roles('de', s)).toEqual(['adverbial:Gestern', 'verb:habe', 'subject:ich', 'adverbial:mit meiner Schwester', 'object:ein neues Fahrrad', 'verbPart:gekauft']);
    expect(note('de', s, 'tense')?.p).toMatchObject({ tense: 'perfect', name: 'Perfekt', verbs: 'habe … gekauft' });
    expect(note('de', s, 'articles')?.p).toEqual({ die: 'Schwester', das: 'Fahrrad' });
    expect(note('de', 'Er ruft seine Mutter jeden Abend an.', 'separable')?.p).toEqual({ verb: 'ruft', prt: 'an' });
    expect(run('de', 'Ich weiß nicht, ob er morgen kommt, weil er krank ist.').notes.find((n) => n.kind === 'verbFinal')?.tokens).toHaveLength(2);
    const ud = toUD(parses.de[s], 'de');
    expect(ud[9]).toMatchObject({ dep: 'ROOT', head: 9 });
    expect(ud[1]).toMatchObject({ dep: 'aux', head: 9 });
  });
  it('English: ClearNLP labels', () => {
    expect(roles('en', 'Yesterday I bought a new bike with my sister.')).toEqual(['adverbial:Yesterday', 'subject:I', 'verb:bought', 'object:a new bike', 'adverbial:with my sister']);
    expect(note('en', 'The house was built in 1900.', 'passive')?.p).toMatchObject({ aux: 'was', part: 'built' });
    expect(note('en', 'She is reading a book.', 'tense')?.p.tense).toBe('presentCont');
    expect(note('en', 'I have never seen it.', 'tense')?.p.tense).toBe('perfect');
    expect(note('en', 'I do not know if he will come tomorrow.', 'tense')?.p.verbs).toBe('do … know');
    expect(kinds('en', 'Yesterday I bought a new bike with my sister.')).not.toContain('inversion'); // not a verb-second language
  });
  it('French and Spanish', () => {
    expect(note('fr', "Hier, j'ai acheté un nouveau vélo avec ma sœur.", 'tense')?.p).toMatchObject({ tense: 'perfect', name: 'passé composé' });
    expect(note('fr', "Je ne sais pas s'il viendra demain.", 'negation')?.p.word).toBe('ne … pas');
    expect(note('es', 'La casa fue construida en 1900.', 'passive')?.p).toMatchObject({ aux: 'fue', part: 'construida' });
    expect(note('es', '¿Dónde vives?', 'whQuestion')?.p.wh).toBe('Dónde');
  });
  it('copes with an empty or odd parse', () => {
    expect(analyze([], 'nl')).toMatchObject({ chunks: [], notes: [] });
    expect(analyze([{ t: 'Hallo', ws: false, pos: 'INTJ', dep: 'ROOT', head: 0, lemma: 'hallo', morph: '' }], 'nl').chunks).toHaveLength(1);
  });
});
