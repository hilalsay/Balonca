import { describe, expect, it } from 'vitest';
import { cleanEntry, cleanPhrase, looksSeparable } from './dictionary-entry.mjs';

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
  it('keeps each meaning once', () => {
    expect(cleanEntry(e({ tr: ['onu', 'onu', 'o'], en: ['give', 'Give', 'hand'] }), 'nl')).toMatchObject({ tr: ['onu', 'o'], en: ['give', 'hand'] });
  });
  it('keeps articles and refuses skipped or empty entries', () => {
    expect(cleanEntry(e({ lemma: 'zus', pos: 'noun', article: 'De' }), 'nl')).toMatchObject({ lemma: 'zus', article: 'de' });
    expect(cleanEntry(e({ lemma: 'wild', pos: 'adjective', article: 'de' }), 'nl')?.article).toBeUndefined(); // only nouns
    expect(cleanEntry(e({ skip: true }), 'nl')).toBeNull();
    expect(cleanEntry(e({ tr: [] }), 'nl')).toBeNull();
  });
  it('checks phrase entries', () => {
    expect(cleanPhrase({ tr: ['göz kulak olmak', 'göz kulak olmak'], en: ['keep an eye on'], example: 'Houd hem in de gaten.', example_tr: 'Ona göz kulak ol.', idiom: true }, 'in de gaten houden', 'verb'))
      .toEqual({ kind: 'phrase', lemma: 'in de gaten houden', pos: 'verb', tr: ['göz kulak olmak'], en: ['keep an eye on'], example: 'Houd hem in de gaten.', example_tr: 'Ona göz kulak ol.', idiom: true });
    expect(cleanPhrase({ tr: ['x'], en: ['y'], idiom: 'yes' }, 'a b', 'noun')).toMatchObject({ pos: '', idiom: false });
    expect(cleanPhrase({ tr: ['Tekrar tekrar', 'Öte yandan'], en: ['again'] }, 'again and again', 'adv')?.tr).toEqual(['tekrar tekrar', 'öte yandan']);
    expect(cleanPhrase({ skip: true, tr: ['x'], en: ['y'] }, 'a b', 'verb')).toBeNull();
    expect(cleanPhrase({ tr: [], en: ['y'] }, 'a b', 'verb')).toBeNull();
  });
});
