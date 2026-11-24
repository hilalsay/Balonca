import { describe, expect, it } from 'vitest';
import fx from './ud.fixtures.json';
import { analyze, markFromDictionary, toUD, type DictEntry, type Note, type UdToken } from './grammar';

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

describe('fixes found with the gold set (tests/grammar-gold)', () => {
  it('finds English "to" + infinitive, which the parser labels aux', () => {
    expect(note('en', 'They need to leave early.', 'teInf')?.p).toEqual({ te: 'to', verb: 'leave', main: 'need' });
    expect(note('en', 'She went to the shop to buy bread.', 'teInf')?.p).toMatchObject({ te: 'to', verb: 'buy' }); // purpose
    expect(note('nl', 'Het is leuk om samen te koken.', 'teInf')?.p).toMatchObject({ te: 'te', verb: 'koken' }); // om … te as a clause
    expect(roles('en', 'They need to leave early.')).toContain('link:to');
  });
  it('gives no command note when the subject is a whole clause', () => {
    for (const s of ['Wat hij zegt, is niet waar.', 'Wie dit leest, moet even lachen.', 'Toen ik wakker werd, bleek dat het had gesneeuwd.']) {
      expect(kinds('nl', s), s).not.toContain('imperative');
      expect(kinds('nl', s), s).toContain('tense');
    }
    expect(kinds('en', 'What she said was true.')).not.toContain('imperative');
    // a command after a subordinate clause stays a command
    expect(kinds('nl', 'Als je tijd hebt, bel me even.')).toContain('imperative');
    expect(kinds('en', 'If you are tired, go to bed.')).toContain('imperative');
  });
  // A small stand-in for the server's dictionary (form -> entry).
  const DICT: Record<string, DictEntry> = {
    terugkomen: { lemma: 'terugkomen', pos: 'verb', separable: true }, meegaan: { lemma: 'meegaan', pos: 'verb', separable: true },
    dichtdoen: { lemma: 'dichtdoen', pos: 'verb', separable: true }, doe: { lemma: 'doen', pos: 'verb' },
    herinner: { lemma: 'herinneren', pos: 'verb' }, kom: { lemma: 'kom', pos: 'noun' },
  };
  const withDict = (s: string, d: Record<string, DictEntry> = DICT) => analyze(markFromDictionary(parses.nl[s], 'nl', (f) => d[f]), 'nl');
  it('accepts particles such as terug and mee when the dictionary knows the separable verb', () => {
    expect(withDict('Ik kom morgen terug.').notes.find((n) => n.kind === 'separable')?.p).toEqual({ verb: 'kom', prt: 'terug' });
    expect(withDict('Hij gaat vanavond mee.').chunks.map((c) => `${c.role}:${c.text}`)).toContain('verbPart:mee');
    // without the dictionary's word, an adverb is not taken for a particle
    expect(withDict('Ik kom morgen terug.', {}).notes.map((n) => n.kind)).not.toContain('separable');
    expect(markFromDictionary(parses.nl['Ik kom morgen terug.'], 'en', (f) => DICT[f])).toBe(parses.nl['Ik kom morgen terug.']);
  });
  it("uses the dictionary's lemma when the parser keeps the written form (Doe -> doen, Herinner -> herinneren)", () => {
    const s = 'Doe het raam dicht.';
    const { doe: _doe, ...noDoe } = DICT;
    expect(withDict(s, noDoe).notes.map((n) => n.kind)).not.toContain('separable');
    expect(withDict(s).notes.find((n) => n.kind === 'separable')?.p).toEqual({ verb: 'Doe', prt: 'dicht' });
    expect(kinds('nl', 'Herinner je je die dag nog?')).not.toContain('reflexive');
    expect(withDict('Herinner je je die dag nog?').notes.find((n) => n.kind === 'reflexive')?.p).toEqual({ pron: 'je', verb: 'Herinner' });
    // the parser's lemma stays a candidate, and a non-verb entry adds nothing
    const t = markFromDictionary(parses.nl['Ik kom morgen terug.'], 'nl', (f) => DICT[f]);
    expect(t.find((x) => x.t === 'kom')?.dlemma).toBeUndefined();
  });
  it('marks me/je/ons as reflexive only with a reflexive verb and a matching subject', () => {
    expect(note('nl', 'We moeten ons haasten.', 'reflexive')?.p).toEqual({ pron: 'ons', verb: 'haasten' });
    expect(note('nl', 'Ik kan me haar gezicht niet herinneren.', 'reflexive')?.p).toEqual({ pron: 'me', verb: 'herinneren' });
    expect(roles('nl', 'Ik kan me haar gezicht niet herinneren.')).toContain('object:me');
    expect(kinds('nl', 'Ik herinner je aan de afspraak.')).not.toContain('reflexive'); // "remind you": another person
    expect(kinds('nl', 'Ik zie je morgen.')).not.toContain('reflexive'); // not a reflexive verb
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
