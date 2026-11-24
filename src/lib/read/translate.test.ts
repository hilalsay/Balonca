import { expect, it } from 'vitest';
import { same, viaEnglish } from './translate.svelte';

it('compares sentences however they are spaced', () => {
  expect(same('Ik  heet\u200b Sam.', ' Ik heet Sam. ')).toBe(true);
  expect(same('Ik heet Sam.', 'Ik heet Bo.')).toBe(false);
});

it('translates into Turkish via English', () => {
  expect(viaEnglish('nl', 'tr')).toBe(true);
  expect(viaEnglish('en', 'tr')).toBe(false);
  expect(viaEnglish('nl', 'en')).toBe(false);
});
