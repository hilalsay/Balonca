import { expect, it } from 'vitest';
import { toCues, slotOf, viaEnglish } from './translate.svelte';
// @ts-expect-error -- plain JavaScript server module (no types)
import { toUnits } from '../../../server/translate.mjs';

it('keeps every sentence of a text its own unit on the server', () => {
  const sents = ['Ik heet Sam', 'Ik woon in Gent.', 'Een zin zonder punt', 'Nog een zin?'];
  const units = toUnits(toCues(sents));
  expect(units.map((u: { text: string }) => u.text)).toEqual(sents);
  expect(units.map((u: { start: number; end: number; text: string }) => slotOf(u))).toEqual([0, 1, 2, 3]);
});

it('translates into Turkish via English', () => {
  expect(viaEnglish('nl', 'tr')).toBe(true);
  expect(viaEnglish('en', 'tr')).toBe(false);
  expect(viaEnglish('nl', 'en')).toBe(false);
});
