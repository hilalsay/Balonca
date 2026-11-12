import { describe, expect, it, vi } from 'vitest';
import { translateCues, TranslateError, type TranslateFn } from './runner';
import type { Cue } from '../types';

const cues = (n: number): Cue[] => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, text: `s${i}` }));
const upper: TranslateFn = async (lines) => lines.map((l) => l.toUpperCase());
const ac = () => new AbortController();

describe('translateCues', () => {
  it('keeps timings, batches, and reports progress', async () => {
    const progress: number[] = [];
    const calls: number[] = [];
    const out = await translateCues({
      cues: cues(60), batchSize: 25, signal: ac().signal,
      translate: async (l, c, s) => { calls.push(l.length); return upper(l, c, s); },
      onProgress: (d) => progress.push(d),
    });
    expect(calls).toEqual([25, 25, 10]);
    expect(progress).toEqual([25, 50, 60]);
    expect(out[59]).toEqual({ start: 59, end: 60, text: 'S59' });
  });
  it('passes the previous lines as context', async () => {
    const seen: string[][] = [];
    await translateCues({ cues: cues(6), batchSize: 3, signal: ac().signal, translate: async (l, c) => { seen.push(c); return l; } });
    expect(seen).toEqual([[], ['s0', 's1', 's2']]);
  });
  it('splits a batch when the model returns the wrong number of lines', async () => {
    let first = true;
    const flaky: TranslateFn = async (lines) => {
      if (first && lines.length > 1) { first = false; return lines.slice(1); }
      return lines.map((l) => l + '!');
    };
    const out = await translateCues({ cues: cues(4), batchSize: 4, signal: ac().signal, translate: flaky });
    expect(out.map((c) => c.text)).toEqual(['s0!', 's1!', 's2!', 's3!']);
  });
  it('fails instead of misaligning when a single line cannot be matched', async () => {
    await expect(translateCues({ cues: cues(2), batchSize: 2, signal: ac().signal, translate: async () => [] }))
      .rejects.toMatchObject({ code: 'bad-response' });
  });
  it('can be cancelled', async () => {
    const c = ac();
    const p = translateCues({ cues: cues(100), batchSize: 10, signal: c.signal,
      translate: async (l, ctx, s) => { c.abort(); return upper(l, ctx, s); } });
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('falls back to the source text when a translation comes back empty', async () => {
    const out = await translateCues({ cues: cues(1), signal: ac().signal, translate: async () => ['  '] });
    expect(out[0].text).toBe('s0');
  });
});
