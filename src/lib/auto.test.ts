import { describe, expect, it } from 'vitest';
import { brokenTracks, pivotOrder } from './auto.svelte';
import { isBrokenLine } from './translate/server.svelte';

const all = ['tr', 'en', 'nl'];
describe('pivotOrder', () => {
  it('makes English first when Turkish is wanted from another language', () => {
    expect(pivotOrder('nl', ['tr'], ['tr', 'en'])).toEqual(['en', 'tr']);
  });
  it('puts English before Turkish when both are wanted', () => {
    expect(pivotOrder('nl', ['tr', 'en'], ['tr', 'en'])).toEqual(['en', 'tr']);
  });
  it('leaves an English video alone', () => {
    expect(pivotOrder('en', ['tr'], ['tr', 'nl'])).toEqual(['tr']);
  });
  it('does not redo English when the video already has it', () => {
    expect(pivotOrder('nl', ['tr'], ['tr'])).toEqual(['tr']);
  });
  it('does nothing for other languages', () => {
    expect(pivotOrder('tr', ['nl'], all)).toEqual(['nl']);
    expect(pivotOrder('de', ['en'], all)).toEqual(['en']);
  });
});

describe('brokenTracks', () => {
  const tr = (name: string, lang: string, ...texts: string[]) => ({ name, lang, cues: texts.map((text) => ({ text })) });
  const nl = tr('Charlie', 'nl', 'Het is maar een kuil.');
  const enBad = tr('Charlie → en (AI)', 'en', "It's just a ditch.”, “2”:”What does that matter?");
  const enOk = tr('Charlie → en (AI)', 'en', "It's just a ditch.");
  const trViaEn = tr('Charlie → en → tr (AI)', 'tr', 'Sadece bir çukur.');

  it('finds saved machine translations with JSON pieces in them, and the Turkish made from them', () => {
    expect(brokenTracks([nl, enBad, trViaEn])).toEqual([enBad, trViaEn]);
    expect(brokenTracks([nl, enOk, trViaEn])).toEqual([]);
  });
  it('leaves the user\'s own subtitles alone', () => {
    expect(brokenTracks([tr('mine.srt', 'en', 'a", "b')])).toEqual([]);
  });
  it('isBrokenLine matches the server check', () => {
    expect(isBrokenLine('Sadece bir bataklık.", "2":"Ne fark eder?')).toBe(true);
    expect(isBrokenLine('Ne fark eder?')).toBe(false);
  });
});
