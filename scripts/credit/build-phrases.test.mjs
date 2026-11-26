import { describe, expect, it } from 'vitest';
import { readPhrase } from './build-phrases.mjs';

const line = (o) => JSON.stringify(o);
describe('phrases from the Wiktionary extract', () => {
  it('keeps multi-word expressions with real senses, not names, nouns or inflected forms', () => {
    expect(readPhrase(line({ word: 'In de gaten houden', pos: 'verb', senses: [{ glosses: ['to keep an eye on'] }] })))
      .toEqual({ phrase: 'in de gaten houden', pos: 'verb', senses: ['to keep an eye on'] });
    expect(readPhrase(line({ word: 'roept op', pos: 'verb', senses: [{ glosses: ['inflection of oproepen'], form_of: [{ word: 'oproepen' }] }] }))).toBeNull();
    expect(readPhrase(line({ word: 'grauwe specht', pos: 'noun', senses: [{ glosses: ['grey-headed woodpecker'] }] }))).toBeNull();
    expect(readPhrase(line({ word: 'Den Haag', pos: 'name', senses: [{ glosses: ['The Hague'] }] }))).toBeNull();
    expect(readPhrase(line({ word: 'huis', pos: 'noun', senses: [{ glosses: ['house'] }] }))).toBeNull();
    expect(readPhrase(line({ word: 'a b c d e f g', pos: 'phrase', senses: [{ glosses: ['too long'] }] }))).toBeNull();
    expect(readPhrase('not json')).toBeNull();
  });
});
