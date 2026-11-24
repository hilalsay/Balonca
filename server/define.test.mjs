import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createHandler } from './lib.mjs';
import { createDefineHandler, define, lookup, parseDefineRequest, parseWiktionary, stripHtml } from './define.mjs';

// Shapes copied from real en.wiktionary.org REST answers (trimmed).
const link = (w, lang = 'Dutch') => `<a rel="mw:WikiLink" href="/wiki/${w}#${lang}" title="${w}">${w}</a>`;
const glossary = (w) => `<a rel="mw:WikiLink" href="/wiki/Appendix:Glossary#${w}" title="Appendix:Glossary">${w}</a>`;
const PAGES = {
  graaf: { nl: [
    { partOfSpeech: 'Noun', definitions: [{ definition: `${link('earl', 'English')}, ${link('count', 'English')}` }, { definition: link('graph', 'English') }] },
    { partOfSpeech: 'Verb', definitions: [
      { definition: `<span class="form-of-definition use-with-mention">inflection of <span class="form-of-definition-link">${link('graven')}</span>:</span>` },
      { definition: `<span class="form-of-definition use-with-mention">${glossary('first-person')} ${glossary('singular')} present indicative</span>` },
      { definition: `<span class="form-of-definition use-with-mention">${glossary('imperative')}</span>` },
    ] },
  ] },
  graven: { nl: [
    { partOfSpeech: 'Verb', definitions: [{ definition: 'to dig physically', examples: ['Ik <b>graaf</b> een gat.'] }, { definition: 'to search for information' }] },
    { partOfSpeech: 'Noun', definitions: [{ definition: `plural of ${link('graf')}` }] },
  ], en: [{ partOfSpeech: 'Verb', definitions: [{ definition: 'carved' }] }] },
};
const fakeFetch = async (url) => {
  const w = decodeURIComponent(url.split('/').pop());
  return PAGES[w] ? new Response(JSON.stringify(PAGES[w]), { status: 200 }) : new Response('{}', { status: 404 });
};

describe('stripHtml / parseWiktionary', () => {
  it('turns HTML into plain text', () => {
    expect(stripHtml('<a href="x">earl</a>, &amp; <i>count</i>&#39;s')).toBe("earl, & count's");
  });
  it('keeps real meanings, drops grammar lines, and remembers the lemma', () => {
    const r = parseWiktionary(PAGES.graaf, 'nl', 'graaf');
    expect(r.senses).toEqual([{ head: 'graaf', pos: 'noun', gloss: 'earl, count' }, { head: 'graaf', pos: 'noun', gloss: 'graph' }]);
    expect(r.lemmas).toEqual(['graven']);
  });
  it('reads only the requested language and keeps examples', () => {
    const r = parseWiktionary(PAGES.graven, 'nl', 'graven');
    expect(r.senses[0]).toEqual({ head: 'graven', pos: 'verb', gloss: 'to dig physically', example: 'Ik graaf een gat.' });
    expect(r.senses.find((s) => s.gloss === 'carved')).toBeUndefined();
    expect(r.lemmas).toEqual(['graf']);
  });
});

describe('lookup', () => {
  it('follows "inflection of" to the dictionary form', async () => {
    const r = await lookup('graaf', 'nl', { fetchImpl: fakeFetch });
    expect(r.senses.map((s) => `${s.head}:${s.gloss}`)).toEqual(['graaf:earl, count', 'graaf:graph', 'graven:to dig physically', 'graven:to search for information']);
  });
  it('tells a word Wiktionary does not have from one it could not look up', async () => {
    expect(await lookup('hodita', 'nl', { fetchImpl: fakeFetch })).toMatchObject({ senses: [], missing: true });
    expect(await lookup('graaf', 'nl', { fetchImpl: async () => { throw new Error('offline'); } })).toMatchObject({ senses: [], missing: false });
  });
  it('retries once after a hiccup', async () => {
    let n = 0;
    const flaky = async (url) => (++n === 1 ? new Response('busy', { status: 429 }) : fakeFetch(url));
    const urls = [];
    const r = await lookup('graven', 'nl', { fetchImpl: async (u) => (urls.push(u.split('/').pop()), flaky(u)) });
    expect(r.senses).toHaveLength(2);
    expect(urls.slice(0, 2)).toEqual(['graven', 'graven']); // failed once, asked again
  });
});

describe('define', () => {
  const llm = { baseUrl: 'http://h', model: 'm', hostHeader: '127.0.0.1' };
  const answers = (...list) => {
    const calls = [];
    const chat = async (_u, body) => { calls.push(body); return { status: 200, content: JSON.stringify(list[calls.length - 1]) }; };
    return { calls, chat };
  };

  it('picks the sense used in the sentence, translates all senses, puts that one first', async () => {
    const { calls, chat } = answers({ best: 3 }, { t: { 1: 'kont', 2: 'grafik', 3: 'kazmak', 4: 'araştırmak' } });
    const r = await define({ word: 'graaf', lang: 'nl', to: 'tr', ctx: 'Ik graaf naar een schat.' }, { llm, chat, fetchImpl: fakeFetch });
    expect(r).toMatchObject({ word: 'graaf', lemma: 'graven', inContext: 'kazmak', source: 'dictionary' });
    expect(r.senses[0]).toEqual({ head: 'graven', pos: 'verb', meaning: 'kazmak', en: 'to dig physically', example: 'Ik graaf een gat.', best: true });
    expect(r.senses.map((s) => s.meaning)).toEqual(['kazmak', 'kont', 'grafik', 'araştırmak']);
    expect(calls[0].messages[0].content).toContain('Dutch word');
    expect(calls[0].format.properties.best.maximum).toBe(4);
    expect(calls[1].messages[0].content).toContain('into Turkish');
  });

  it('needs only the pick for English, and nothing at all for a single sense', async () => {
    const en = answers({ best: 3 });
    const r = await define({ word: 'graaf', lang: 'nl', to: 'en', ctx: 'Ik graaf.' }, { llm, chat: en.chat, fetchImpl: fakeFetch });
    expect(r.inContext).toBe('to dig physically');
    expect(en.calls).toHaveLength(1);
    PAGES.leugen = { nl: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'a lie' }] }] };
    const one = answers();
    expect((await define({ word: 'leugen', lang: 'nl', to: 'en', ctx: '' }, { llm, chat: one.chat, fetchImpl: fakeFetch })).senses).toHaveLength(1);
    expect(one.calls).toHaveLength(0);
  });

  it('falls back to the model alone (marked "ai") when the dictionary has no entry', async () => {
    const { chat } = answers({ lemma: 'hodita', senses: [{ pos: 'noun', meaning: 'a name' }] }, { t: { 1: 'bir isim' } });
    const r = await define({ word: 'hodita', lang: 'nl', to: 'tr', ctx: 'Hodita kom.' }, { llm, chat, fetchImpl: fakeFetch });
    expect(r).toMatchObject({ source: 'ai', lemma: 'hodita', inContext: 'bir isim' });
    expect(r.temporary).toBeUndefined();
  });
  it('marks a guess made while the dictionary was unreachable as temporary', async () => {
    const { chat } = answers({ lemma: 'schat', senses: [{ pos: 'noun', meaning: 'treasure' }] });
    const r = await define({ word: 'schat', lang: 'nl', to: 'en', ctx: '' }, { llm, chat, fetchImpl: async () => { throw new Error('offline'); } });
    expect(r).toMatchObject({ source: 'ai', temporary: true });
  });

  it('retries a broken answer once, then reports it', async () => {
    let n = 0;
    const chat = async () => ({ status: 200, content: ++n === 1 ? '{"best": 3' : '{"best": 3}' });
    const ok = await define({ word: 'graaf', lang: 'nl', to: 'en', ctx: '' }, { llm, chat, fetchImpl: fakeFetch });
    expect(ok.inContext).toBe('to dig physically');
    const never = async () => ({ status: 200, content: '{' });
    await expect(define({ word: 'graaf', lang: 'nl', to: 'en', ctx: '' }, { llm, chat: never, fetchImpl: fakeFetch })).rejects.toMatchObject({ code: 'llm-bad-response' });
  });
});

describe('parseDefineRequest', () => {
  it('accepts a word with context', () => {
    expect(parseDefineRequest(JSON.stringify({ word: ' Schat ', lang: 'NL', to: 'tr', ctx: 'x'.repeat(900) })))
      .toEqual({ word: 'Schat', lang: 'nl', to: 'tr', ctx: 'x'.repeat(500) });
  });
  it.each([
    ['broken json', '{'], ['no word', '{"lang":"nl","to":"tr"}'], ['same language', '{"word":"a","lang":"nl","to":"nl"}'],
    ['long word', JSON.stringify({ word: 'a'.repeat(61), lang: 'nl', to: 'tr' })], ['markup', '{"word":"<b>","lang":"nl","to":"tr"}'],
  ])('rejects %s', (_n, body) => expect(() => parseDefineRequest(body)).toThrow(expect.objectContaining({ code: 'bad-request' })));
});

describe('POST /api/define', () => {
  it('answers JSON and serves a repeat from the cache', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const dir = await mkdtemp((await import('node:os')).tmpdir() + '/balonca-def-');
    let calls = 0;
    const chat = async () => { calls++; return { status: 200, content: '{"best": 1}' }; };
    const server = http.createServer(createHandler({
      run: async () => ({ stdout: '' }), define: createDefineHandler({ llm: { baseUrl: 'http://h', model: 'm' }, cacheDir: dir, chat, fetchImpl: fakeFetch }),
    }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    // As the site's own page sends it (the API refuses other origins).
    const post = (body) => fetch(`${base}/api/define`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', origin: base }, body: JSON.stringify(body) });
    const a = await post({ word: 'graaf', lang: 'nl', to: 'en', ctx: 'Ik graaf.' });
    expect(a.status).toBe(200);
    expect((await a.json()).senses[0].meaning).toBe('earl, count');
    await post({ word: 'graaf', lang: 'nl', to: 'en', ctx: 'Ik graaf.' });
    expect(calls).toBe(1);
    expect((await post({ word: '', lang: 'nl', to: 'en' })).status).toBe(400);
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
});

describe('Wiktionary retries', () => {
  it('waits and tries up to three times before giving up', async () => {
    let n = 0;
    const flaky = async (url) => (++n < 3 ? Promise.reject(new TypeError('fetch failed')) : fakeFetch(url));
    const t0 = Date.now();
    const r = await lookup('leugen', 'nl', { fetchImpl: flaky });
    expect(r.senses).toHaveLength(1);
    expect(n).toBe(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000); // 400 ms + 800 ms pauses
  });
});

it('reads a meaning the model wrapped one level too deep', async () => {
  const { define } = await import('./define.mjs');
  const chat = async (url, body) => ({ status: 200, content: body.format?.properties?.t ? '{"t":{"1":{"1":"peron"}}}' : '{"best":1}' });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ nl: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'platform' }] }] }) });
  const out = await define({ word: 'perron', lang: 'nl', to: 'tr', ctx: 'op het perron' }, { llm: { model: 'm', baseUrl: 'http://x' }, chat, fetchImpl });
  expect(out.inContext).toBe('peron');
});

describe('dictionary first', () => {
  const entry = { lemma: 'zus', pos: 'noun', tr: ['kız kardeş'], en: ['sister'], example: 'Mijn zus woont hier.', article: 'de' };
  it('turns an entry into the define answer', async () => {
    const { fromDictionary } = await import('./define.mjs');
    expect(fromDictionary(entry, 'zus', 'tr')).toMatchObject({ lemma: 'zus', inContext: 'kız kardeş', source: 'dictionary', article: 'de',
      senses: [{ meaning: 'kız kardeş', en: 'sister', best: true, example: 'Mijn zus woont hier.' }] });
    expect(fromDictionary({ skip: true }, 'x', 'tr')).toBeNull();
    expect(fromDictionary(entry, 'zus', 'nl')).toBeNull();
  });
  it('answers single-meaning words without any model call', async () => {
    const { createDefineHandler } = await import('./define.mjs');
    let calls = 0;
    const h = createDefineHandler({ llm: { model: 'm', baseUrl: 'http://x' }, chat: async () => { calls++; return { status: 500 }; }, dictionary: () => entry });
    const { PassThrough } = await import('node:stream');
    const req = new PassThrough(); req.end(JSON.stringify({ word: 'Zus', lang: 'nl', to: 'tr', ctx: 'Mijn zus.' }));
    let body = ''; const res = new PassThrough(); res.writeHead = () => {}; res.on('data', (d) => (body += d));
    await h(req, res);
    expect(JSON.parse(body).inContext).toBe('kız kardeş');
    expect(calls).toBe(0);
  });
});
