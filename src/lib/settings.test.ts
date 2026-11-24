import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, withTranslationLang, translationLang } from './settings';

describe('subtitle position', () => {
  it('defaults near the bottom for old data without it', () => {
    expect(sanitizeSettings({ subSize: 30 }).subPos).toBe(DEFAULT_SETTINGS.subPos);
  });
  it('keeps a valid value and clamps a bad one to the video', () => {
    expect(sanitizeSettings({ subPos: 20 }).subPos).toBe(20);
    expect(sanitizeSettings({ subPos: 250 }).subPos).toBe(100);
    expect(sanitizeSettings({ subPos: -5 }).subPos).toBe(0);
    expect(sanitizeSettings({ subPos: 'top' }).subPos).toBe(DEFAULT_SETTINGS.subPos);
  });
});

describe('one translation language', () => {
  const apply = (s: typeof DEFAULT_SETTINGS, l: 'tr' | 'en' | 'nl') => ({ ...s, ...withTranslationLang(s, l) });
  it('sets subtitles and meanings together', () => {
    const s = apply({ ...DEFAULT_SETTINGS, autoTranslate: 'en', meaningLang: 'en' }, 'tr');
    expect([s.autoTranslate, s.meaningLang, translationLang(s)]).toEqual(['tr', 'tr', 'tr']);
  });
  it('keeps "ask every video" and a separate meaning language: no combination is lost', () => {
    // the first choice switches translation on; "ask" chosen later on purpose stays
    const first = apply({ ...DEFAULT_SETTINGS, autoTranslate: 'ask' }, 'tr');
    expect([first.autoTranslate, first.meaningLang]).toEqual(['tr', 'tr']);
    const ask = apply({ ...DEFAULT_SETTINGS, autoTranslate: 'ask', transLang: 'en' }, 'tr');
    expect([ask.autoTranslate, ask.meaningLang]).toEqual(['ask', 'tr']);
    const split = apply({ ...DEFAULT_SETTINGS, autoTranslate: 'tr', meaningLang: 'en', separateMeaning: true }, 'nl');
    expect([split.autoTranslate, split.meaningLang]).toEqual(['nl', 'en']);
  });
  it('older settings still say what the language is', () => {
    expect(translationLang({ ...DEFAULT_SETTINGS, autoTranslate: 'en' })).toBe('en');
    expect(translationLang({ ...DEFAULT_SETTINGS, meaningLang: 'tr' })).toBe('tr');
    expect(sanitizeSettings({ fontScale: 'huge', transLang: 'xx' })).toMatchObject({ fontScale: 'normal', transLang: '' });
  });
});
