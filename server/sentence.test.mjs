import { expect, test } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseSentenceRequest, createSentenceHandler } from './sentence.mjs';

const req = (body) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: {} });
const res = () => { const r = { on() {}, writeHead(s) { r.status = s; }, end(b) { r.body = JSON.parse(b); } }; return r; };
const llm = { baseUrl: 'http://x', model: 'm' };

test('parseSentenceRequest checks text and languages', () => {
  expect(parseSentenceRequest('{"text":" Hoi ","from":"NL","to":"en"}')).toEqual({ text: 'Hoi', from: 'nl', to: 'en' });
  expect(() => parseSentenceRequest('{"text":"","from":"nl","to":"en"}')).toThrow();
  expect(() => parseSentenceRequest('{"text":"a","from":"nl","to":"nl"}')).toThrow();
  expect(() => parseSentenceRequest(JSON.stringify({ text: 'x'.repeat(501), from: 'nl', to: 'en' }))).toThrow();
});

test('translates one sentence and caches it', async () => {
  let calls = 0;
  const chat = async () => { calls++; return { status: 200, content: '{"1": "Hi Charlie."}' }; };
  const h = createSentenceHandler({ llm, cacheDir: await mkdtemp(path.join(tmpdir(), 'sent-')), chat });
  const a = res(); await h(req({ text: 'Hoi Charlie.', from: 'nl', to: 'en' }), a);
  const b = res(); await h(req({ text: 'Hoi Charlie.', from: 'nl', to: 'en' }), b);
  expect(a.body).toEqual({ text: 'Hi Charlie.' });
  expect(b.body).toEqual({ text: 'Hi Charlie.' });
  expect(calls).toBe(1);
});
