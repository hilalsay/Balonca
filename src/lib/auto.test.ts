import { describe, expect, it } from 'vitest';
import { pivotOrder } from './auto.svelte';

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
