import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createHandler } from './lib.mjs';
import {
  batches, clean, createTranslateHandler, lane, ollamaTranslator, parseRequest, schemaFor, toUnits,
} from './translate.mjs';

const cue = (start, end, text) => ({ start, end, text });

describe('toUnits', () => {
  it('joins lines into sentences and splits sentences that end mid-line', () => {
    const u = toUnits([
      cue(48, 51.6, 'Hoi Charlie. Wat ben je aan het doen? Oh'),
      cue(51.6, 54.2, 'hoi Monica. Ik graaf naar een verborgen'),
      cue(54.2, 56.5, 'schat.'),
    ]);
    expect(u.map((x) => x.text)).toEqual(['Hoi Charlie.', 'Wat ben je aan het doen?', 'Oh hoi Monica.', 'Ik graaf naar een verborgen schat.']);
  });
  it('interpolates timings from word positions and keeps them in order', () => {
    const u = toUnits([cue(10, 14, 'one two. three four')]);
    expect(u).toEqual([{ start: 10, end: 12, text: 'one two.' }, { start: 12, end: 14, text: 'three four' }]);
  });
  it('keeps sound tags as their own unit and splits on silence', () => {
    const u = toUnits([cue(0, 1, 'hello there'), cue(1, 2, '[muziek]'), cue(2, 3, 'and then'), cue(6, 7, 'later on')]);
    expect(u.map((x) => x.text)).toEqual(['hello there', '[muziek]', 'and then', 'later on']);
  });
  it('splits unpunctuated auto-captions into readable lengths', () => {
    const line = 'word '.repeat(12).trim(); // 59 chars per line, no punctuation anywhere
    const u = toUnits(Array.from({ length: 10 }, (_, i) => cue(i * 3, i * 3 + 3, line)));
    expect(u.length).toBeGreaterThan(2);
    expect(Math.max(...u.map((x) => x.text.length))).toBeLessThanOrEqual(260);
    expect(u.map((x) => x.text).join(' ')).toBe(Array(10).fill(line).join(' ')); // nothing lost
  });
  it('ignores empty lines', () => {
    expect(toUnits([cue(0, 1, '  '), cue(1, 2, 'Hi.')])).toEqual([{ start: 1, end: 2, text: 'Hi.' }]);
  });
});

describe('batches, schema, clean', () => {
  it('groups by count and by characters', () => {
    const units = Array.from({ length: 20 }, () => ({ text: 'x'.repeat(10) }));
    expect(batches(units, 8).map((b) => b.length)).toEqual([8, 8, 4]);
    expect(batches([{ text: 'a'.repeat(900) }, { text: 'b'.repeat(900) }], 8, 1200).length).toBe(2);
  });
  it('requires exactly the numbered keys', () => {
    expect(schemaFor(2)).toEqual({ type: 'object', properties: { 1: { type: 'string' }, 2: { type: 'string' } }, required: ['1', '2'], additionalProperties: false });
  });
  it('removes junk some models append, keeps real brackets', () => {
    expect(clean('by pirates.”}​ 3')).toBe('by pirates.');
    expect(clean('[müzik]')).toBe('[müzik]');
    expect(clean('Merhaba [gülüşmeler] Bello')).toBe('Merhaba [gülüşmeler] Bello');
  });
});

describe('ollamaTranslator', () => {
  const reply = (obj) => ({ status: 200, text: JSON.stringify({ message: { content: JSON.stringify(obj) } }) });
  it('sends numbered items with a schema and the host header, maps answers back in order', async () => {
    let sent;
    const post = async (url, body, opts) => { sent = { url, body, opts }; return reply({ 1: 'Merhaba.', 2: 'Nasılsın?' }); };
    const tr = ollamaTranslator({ baseUrl: 'http://h:1/', model: 'm', hostHeader: '127.0.0.1', from: 'nl', to: 'tr', post });
    expect(await tr(['Hoi.', 'Hoe gaat het?'], ['eerder'], undefined)).toEqual(['Merhaba.', 'Nasılsın?']);
    expect(sent.url).toBe('http://h:1/api/chat');
    expect(sent.opts.headers).toEqual({ host: '127.0.0.1' });
    expect(sent.body.format.required).toEqual(['1', '2']);
    expect(sent.body.messages[0].content).toContain('from Dutch into Turkish');
    expect(JSON.parse(sent.body.messages[1].content)).toEqual({ context: ['eerder'], translate: { 1: 'Hoi.', 2: 'Hoe gaat het?' } });
  });
  it('falls back to the source text for an empty answer', async () => {
    const tr = ollamaTranslator({ baseUrl: 'http://h', model: 'm', from: 'nl', to: 'en', post: async () => reply({ 1: 'Hi.', 2: ' ' }) });
    expect(await tr(['Hoi.', 'Dag.'], [], undefined)).toEqual(['Hi.', 'Dag.']);
  });
  it('retries once when the model copied the input', async () => {
    let calls = 0;
    const post = async (_u, body) => {
      calls++;
      return calls === 1 ? reply({ 1: 'Ik graaf.', 2: 'Een schat.' }) : (expect(body.messages[0].content).toContain('IMPORTANT'), reply({ 1: 'Kazıyorum.', 2: 'Bir hazine.' }));
    };
    const tr = ollamaTranslator({ baseUrl: 'http://h', model: 'm', from: 'nl', to: 'tr', post });
    expect(await tr(['Ik graaf.', 'Een schat.'], [], undefined)).toEqual(['Kazıyorum.', 'Bir hazine.']);
    expect(calls).toBe(2);
  });
  it('reports a missing model and a broken reply', async () => {
    const missing = ollamaTranslator({ baseUrl: 'http://h', model: 'm', from: 'nl', to: 'tr', post: async () => ({ status: 404, text: 'model not found' }) });
    await expect(missing(['a'], [], undefined)).rejects.toMatchObject({ code: 'llm-model-missing' });
    const broken = ollamaTranslator({ baseUrl: 'http://h', model: 'm', from: 'nl', to: 'tr', post: async () => ({ status: 200, text: '{' }) });
    await expect(broken(['a'], [], undefined)).rejects.toMatchObject({ code: 'llm-bad-response' });
  });
});

describe('parseRequest', () => {
  const ok = { from: 'nl', to: 'tr', cues: [{ start: 0, end: 1, text: 'Hoi' }] };
  it('accepts a valid body', () => expect(parseRequest(JSON.stringify(ok))).toEqual(ok));
  it.each([
    ['broken json', '{'],
    ['same language', JSON.stringify({ ...ok, to: 'nl' })],
    ['bad language code', JSON.stringify({ ...ok, to: 'tr.*' })],
    ['no cues', JSON.stringify({ ...ok, cues: [] })],
    ['too many cues', JSON.stringify({ ...ok, cues: Array(5001).fill(ok.cues[0]) })],
  ])('rejects %s', (_n, body) => expect(() => parseRequest(body)).toThrow(expect.objectContaining({ code: 'bad-request' })));
});

describe('lane', () => {
  it('runs one job at a time and tells later jobs how many are ahead', async () => {
    const q = lane(5);
    const order = [];
    let ahead;
    let release;
    const first = q.run(() => new Promise((r) => (release = r)).then(() => order.push('a')));
    const second = q.run(async () => order.push('b'), (n) => (ahead = n));
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    expect(ahead).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('POST /api/translate (streamed)', () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  const serve = async (opts) => {
    const translate = createTranslateHandler(opts);
    const server = http.createServer(createHandler({ run: async () => ({ stdout: '' }), translate }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (body) => {
      const res = await fetch(`${base}/api/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, type: res.headers.get('content-type'), events: text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
    };
    return { post, close: () => new Promise((r) => server.close(r)) };
  };
  const body = { from: 'nl', to: 'tr', cues: Array.from({ length: 10 }, (_, i) => cue(i * 2, i * 2 + 2, `Zin ${i}.`)) };

  it('streams sentence batches in order, then serves the same job from the disk cache', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'balonca-tr-'));
    let calls = 0;
    const makeTranslator = () => async (texts) => { calls++; return texts.map((t) => t.replace('Zin', 'Cümle')); };
    const api = await serve({ cacheDir: dir, makeTranslator });

    const first = await api.post(body);
    expect(first.status).toBe(200);
    expect(first.type).toContain('ndjson');
    expect(first.events[0]).toMatchObject({ type: 'meta', total: 10, cached: 0 });
    const parts = first.events.filter((e) => e.type === 'cues');
    expect(parts.map((p) => p.done)).toEqual([8, 10]);
    expect(parts.flatMap((p) => p.cues)[3]).toEqual({ start: 6, end: 8, text: 'Cümle 3.' });
    expect(first.events.at(-1)).toEqual({ type: 'done' });
    expect(calls).toBe(2);

    const again = await api.post(body);
    expect(again.events[0]).toMatchObject({ type: 'meta', cached: 10 });
    expect(again.events.filter((e) => e.type === 'cues')[0].cues).toHaveLength(10);
    expect(calls).toBe(2); // no model call
    await api.close();
  });

  it('reports model failures as an error event', async () => {
    const api = await serve({ makeTranslator: () => async () => { throw Object.assign(new Error('x'), {}); } });
    const r = await api.post({ ...body, to: 'en' });
    expect(r.events.at(-1)).toEqual({ type: 'error', error: 'llm-failed' });
    await api.close();
  });

  it('rejects bad input before streaming, and limits jobs per hour', async () => {
    const api = await serve({ jobsPerHour: 1, makeTranslator: () => async (t) => t });
    expect((await api.post({ ...body, to: 'nl' })).status).toBe(400);
    expect((await api.post({ ...body, to: 'de' })).status).toBe(200);
    const limited = await api.post({ ...body, to: 'fr' });
    expect(limited.status).toBe(429);
    expect(limited.events[0]).toEqual({ error: 'rate-limit' });
    await api.close();
  });
});
