import { describe, expect, it } from 'vitest';
import { cleanEntry, looksSeparable } from './dictionary-entry.mjs';

const e = (x) => ({ lemma: 'x', pos: 'verb', tr: ['a'], en: ['b'], example: '', example_tr: '', article: '', separable: false, skip: false, ...x });

describe('dictionary entries', () => {
  it('keeps "separable" only for a verb that starts with a particle', () => {
    for (const v of ['opbellen', 'terugbellen', 'dichtdoen', 'meegaan', 'aankomen']) expect(cleanEntry(e({ lemma: v, separable: true }), 'nl')?.separable, v).toBe(true);
    for (const v of ['komen', 'doen', 'maken', 'vinden', 'gaan', 'moeten', 'wissen']) expect(cleanEntry(e({ lemma: v, separable: true }), 'nl')?.separable, v).toBeUndefined();
    expect(cleanEntry(e({ lemma: 'binnen', pos: 'adverb', separable: true }), 'nl')?.separable).toBeUndefined();
    expect(cleanEntry(e({ lemma: 'zurückkommen', separable: true }), 'de')?.separable).toBe(true);
    expect(cleanEntry(e({ lemma: 'opbellen', separable: true }), 'en')?.separable).toBeUndefined();
    expect(looksSeparable('op', 'nl')).toBe(false);
  });
  it('keeps articles and refuses skipped or empty entries', () => {
    expect(cleanEntry(e({ lemma: 'zus', pos: 'noun', article: 'De' }), 'nl')).toMatchObject({ lemma: 'zus', article: 'de' });
    expect(cleanEntry(e({ lemma: 'wild', pos: 'adjective', article: 'de' }), 'nl')?.article).toBeUndefined(); // only nouns
    expect(cleanEntry(e({ skip: true }), 'nl')).toBeNull();
    expect(cleanEntry(e({ tr: [] }), 'nl')).toBeNull();
  });
});
