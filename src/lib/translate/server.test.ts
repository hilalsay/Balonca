import { describe, expect, it } from 'vitest';
import { readEvents, serverTranslate } from './server';
import { TranslateError } from './runner';
import { pickManual, pickSource, baseLang } from '../ytsubs/pick';
import { sanitizeSettings } from '../settings';

/** A body that delivers `chunks` as separate reads, to exercise lines split across chunks. */
const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { const enc = new TextEncoder(); chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
});
const ndjson = (events: object[], split = 7) => {
  const s = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return Array.from({ length: Math.ceil(s.length / split) }, (_, i) => s.slice(i * split, (i + 1) * split));
};
const fakeFetch = (status: number, chunks: string[]): typeof fetch =>
  (async () => new Response(stream(chunks), { status, headers: { 'content-type': 'application/x-ndjson' } })) as typeof fetch;

describe('readEvents', () => {
  it('parses lines split across chunks and skips broken ones', async () => {
    const out = [];
    for await (const e of readEvents(stream(['{"type":"me', 'ta","total":2}\nnot json\n{"type":"done"}']))) out.push(e);
    expect(out).toEqual([{ type: 'meta', total: 2 }, { type: 'done' }]);
  });
});

describe('serverTranslate', () => {
  const cues = [{ start: 0, end: 1, text: 'Hoi.' }, { start: 1, end: 2, text: 'Dag.' }];
  it('delivers cues as they stream and resolves with all of them', async () => {
    const seen: number[] = [];
    let queued = -1;
    const res = await serverTranslate({
      cues, from: 'nl', to: 'tr', signal: new AbortController().signal,
      onCues: (_c, done) => seen.push(done), onQueued: (n) => (queued = n),
      fetchImpl: fakeFetch(200, ndjson([
        { type: 'meta', total: 2, model: 'm', cached: 0 }, { type: 'queued', ahead: 1 }, { type: 'ping' },
        { type: 'cues', done: 1, cues: [{ start: 0, end: 1, text: 'Merhaba.' }] },
        { type: 'cues', done: 2, cues: [{ start: 1, end: 2, text: 'Güle güle.' }] }, { type: 'done' },
      ])),
    });
    expect(res.map((c) => c.text)).toEqual(['Merhaba.', 'Güle güle.']);
    expect(seen).toEqual([1, 2]);
    expect(queued).toBe(1);
  });
  it('maps server errors to translate error codes', async () => {
    const run = (f: typeof fetch) => serverTranslate({ cues, from: 'nl', to: 'tr', signal: new AbortController().signal, fetchImpl: f });
    await expect(run(fakeFetch(200, ndjson([{ type: 'meta', total: 2 }, { type: 'error', error: 'llm-unreachable' }]))))
      .rejects.toMatchObject({ code: 'unavailable' });
    await expect(run(fakeFetch(429, ['{"error":"rate-limit"}']))).rejects.toMatchObject({ code: 'rate-limit' });
    await expect(run(fakeFetch(200, ndjson([{ type: 'meta', total: 2 }]))) ).rejects.toBeInstanceOf(TranslateError); // ended early
    await expect(run((async () => { throw new Error('offline'); }) as typeof fetch)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('pickSource / pickManual', () => {
  const tr = (code: string, kind: 'manual' | 'auto' | 'auto-translated') => ({ code, name: code, kind });
  it('prefers a hand-made track in the spoken language over the auto-caption', () => {
    expect(pickSource([tr('en', 'manual'), tr('nl', 'manual'), tr('nl-orig', 'auto'), tr('tr', 'auto-translated')])?.code).toBe('nl');
  });
  it('uses the original auto-caption when nothing hand-made matches it', () => {
    expect(pickSource([tr('en', 'manual'), tr('nl-orig', 'auto')])?.code).toBe('nl-orig');
  });
  it('falls back to the first hand-made track, never to machine translations', () => {
    expect(pickSource([tr('de-DE', 'manual'), tr('tr', 'auto-translated')])?.code).toBe('de-DE');
    expect(pickSource([tr('tr', 'auto-translated')])).toBeNull();
  });
  it('finds a hand-made target and normalises codes', () => {
    expect(pickManual([tr('pt-BR', 'manual'), tr('tr', 'auto-translated')], 'pt')?.code).toBe('pt-BR');
    expect(pickManual([tr('tr', 'auto-translated')], 'tr')).toBeNull();
    expect(baseLang('nl-orig')).toBe('nl');
  });
});

describe('automatic subtitle settings', () => {
  it('defaults to fetching the subtitle and asking for the translation language', () => {
    expect(sanitizeSettings({})).toMatchObject({ autoSubs: true, autoTranslate: 'ask' });
    expect(sanitizeSettings({ autoSubs: false, autoTranslate: 'en' })).toMatchObject({ autoSubs: false, autoTranslate: 'en' });
    expect(sanitizeSettings({ autoTranslate: 'xx', autoTargets: ['tr', 'en'] })).toMatchObject({ autoTranslate: 'ask' });
  });
});
