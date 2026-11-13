import { describe, expect, it } from 'vitest';
import { lineAt, shownLang } from './sentence';
import type { StoredTrack } from '../types';

const track = (lang: string, label: string, cues: [number, number, string][], offset = 0): StoredTrack =>
  ({ id: label, vid: 'v', name: label, lang, label, color: '#000', visible: true, offset, cues: cues.map(([start, end, text]) => ({ start, end, text })) });

describe('lineAt', () => {
  const tr = [track('tr', 'Türkçe (AI…)', [[0, 5, 'yarım']]), track('tr', 'Türkçe (AI)', [[0, 2, 'Merhaba'], [2, 5, 'Ne yapıyorsun?']]), track('en', 'English', [[0, 5, 'Hi']])];
  it('finds the line on screen in that language, preferring a finished track', () => {
    expect(lineAt(tr, 'tr', 3)).toBe('Ne yapıyorsun?');
    expect(lineAt(tr, 'en', 1)).toBe('Hi');
  });
  it('honours the sync offset and returns null when nothing matches', () => {
    expect(lineAt([track('en', 'E', [[10, 12, 'Late']], 8)], 'en', 19)).toBe('Late'); // shown 8s later: 18–20
    expect(lineAt(tr, 'nl', 1)).toBeNull();
    expect(lineAt(tr, 'en', 9)).toBeNull();
  });
});

describe('shownLang', () => {
  it('is the chosen language unless it is the word’s own', () => {
    const w = { lang: 'nl' } as Parameters<typeof shownLang>[0];
    expect(shownLang(w, 'en')).toBe('en');
    expect(shownLang(w, 'nl')).toBeNull();
    expect(shownLang(w, '')).toBeNull();
  });
});
