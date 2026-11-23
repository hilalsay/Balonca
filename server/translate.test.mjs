import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createHandler } from './lib.mjs';
import {
  batches, checkReply, clean, createTranslateHandler, healed, isLeak, isLooping, jsonPart, lane, ollamaTranslator, parseRequest, salvage,
  schemaFor, toUnits,
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
  const ok = (content) => ({ status: 200, content });
  const reply = (obj) => ok(JSON.stringify(obj));
  const make = (chat, to = 'tr') => ollamaTranslator({ baseUrl: 'http://h:1/', model: 'm', hostHeader: '127.0.0.1', from: 'nl', to, chat });

  it('sends numbered items with a schema, an output cap and the host header, maps answers back in order', async () => {
    let sent;
    const tr = make(async (url, body, opts) => { sent = { url, body, opts }; return reply({ 1: 'Merhaba.', 2: 'Nasılsın?' }); });
    expect(await tr(['Hoi.', 'Hoe gaat het?'], ['eerder'], undefined)).toEqual(['Merhaba.', 'Nasılsın?']);
    expect(sent.url).toBe('http://h:1/api/chat');
    expect(sent.opts.headers).toEqual({ host: '127.0.0.1' });
    expect(sent.body.format.required).toEqual(['1', '2']);
    expect(sent.body.options.num_predict).toBeGreaterThan(50);
    expect(sent.body.options.num_predict).toBeLessThanOrEqual(2048);
    expect(sent.body.messages[0].content).toContain('from Dutch into Turkish');
    expect(JSON.parse(sent.body.messages[1].content)).toEqual({ context: ['eerder'], translate: { 1: 'Hoi.', 2: 'Hoe gaat het?' } });
  });

  it('recovers from the real failure: a curly quote ends the last item and the model loops', async () => {
    // What gemma3 actually produced for the Charlie video (see translate.mjs isLooping / salvage). The curly quote is
    // read as the closing quote and the looping tail after "}" is dropped, so no second call is needed.
    const broken = '{"1":"Hi Charlie.","2":"What are you doing?","3":"I don’t, but treasures are usually buried.”}​ 3: 3: 3: 3: 3: 3: 3: 3: 3: 3: 3:';
    const calls = [];
    const tr = make(async (_u, body) => { calls.push(body.format ? `json:${body.format.required.length}` : 'plain'); return ok(broken); }, 'en');
    expect(await tr(['Hoi Charlie.', 'Wat ben je aan het doen?', 'Weet ik niet, maar schatten zijn meestal begraven.'], [], undefined))
      .toEqual(['Hi Charlie.', 'What are you doing?', 'I don’t, but treasures are usually buried.']);
    expect(calls).toEqual(['json:3']);
  });

  it('asks again only for the item that was cut off', async () => {
    const calls = [];
    const tr = make(async (_u, body) => {
      calls.push(body.format ? `json:${body.format.required.length}` : 'plain');
      return calls.length === 1 ? ok('{"1":"Hi Charlie.","2":"What are you doing?","3":"I don’t, but trea') : reply({ 1: 'I don’t know.' });
    }, 'en');
    expect(await tr(['Hoi Charlie.', 'Wat ben je aan het doen?', 'Weet ik niet.'], [], undefined)).toEqual(['Hi Charlie.', 'What are you doing?', 'I don’t know.']);
    expect(calls).toEqual(['json:3', 'json:1']);
  });

  it('splits a batch that came back unusable, then falls back to plain text, then to the source', async () => {
    const calls = [];
    const tr = make(async (_u, body) => {
      const n = body.format?.required.length;
      calls.push(n ? `json:${n}` : 'plain');
      if (n) return ok('{');                       // JSON mode never works here
      const line = body.messages[1].content;
      return ok(line.includes('Dag') ? '' : '"Merhaba."\nNote: informal');
    });
    expect(await tr(['Hoi.', 'Dag.'], [], undefined)).toEqual(['Merhaba.', 'Dag.']);
    expect(calls).toEqual(['json:2', 'json:1', 'plain', 'json:1', 'plain']);
  });

  it('retries once when the model copied the input', async () => {
    let calls = 0;
    const tr = make(async (_u, body) => {
      calls++;
      if (calls === 1) return reply({ 1: 'Ik graaf.', 2: 'Een schat.' });
      expect(body.messages[0].content).toContain('IMPORTANT');
      return reply({ 1: 'Kazıyorum.', 2: 'Bir hazine.' });
    });
    expect(await tr(['Ik graaf.', 'Een schat.'], [], undefined)).toEqual(['Kazıyorum.', 'Bir hazine.']);
    expect(calls).toBe(2);
  });

  it('asks again for a multi-word sentence that came back unchanged, but accepts a lone name', async () => {
    const calls = [];
    const tr = make(async (_u, body) => {
      calls.push(body.format ? `json:${body.format.required.length}` : 'plain');
      return calls.length === 1 ? reply({ 1: 'Bello.', 2: 'Oh hoi Bello.', 3: 'Ne yapıyorsun?', 4: 'Evet.' }) : reply({ 1: 'Oh merhaba Bello.' });
    });
    expect(await tr(['Bello.', 'Oh hoi Bello.', 'Wat doe je?', 'Ja.'], [], undefined)).toEqual(['Bello.', 'Oh merhaba Bello.', 'Ne yapıyorsun?', 'Evet.']);
    expect(calls).toEqual(['json:4', 'json:1']);
  });

  it('still reports a missing model or a failing server', async () => {
    await expect(make(async () => ({ status: 404, content: '', raw: 'model not found' }))(['a'], [], undefined)).rejects.toMatchObject({ code: 'llm-model-missing' });
    await expect(make(async () => ({ status: 500, content: '', raw: 'boom' }))(['a'], [], undefined)).rejects.toMatchObject({ code: 'llm-failed' });
  });
});

describe('isLooping / salvage', () => {
  it('spots a stuck model but not normal text', () => {
    expect(isLooping('"8":"buried.”} 3: 3: 3: 3: 3: 3: 3: 3: 3: 3: 3:')).toBe(true);
    expect(isLooping('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isLooping('Ha ha, ik heet Charlie. Wat ben je aan het doen?')).toBe(false);
  });
  it('keeps every complete pair from broken JSON', () => {
    expect(salvage('{"1":"Hi \\"you\\".","2":"Yes.","3":"cut off')).toEqual({ 1: 'Hi "you".', 2: 'Yes.' });
    expect(salvage('{"1":"a"}')).toEqual({ 1: 'a' });
    expect(salvage('nothing')).toEqual({});
  });
});

describe('broken replies (Charlie, 1:20: one item swallowed the batch)', () => {
  const NL = ['Het is maar een kuil.', 'Wat maakt dat nou uit?', 'Au!', 'Wie heeft al die kuilen gegraven?'];
  const EN = ["It's just a ditch.", 'What does that matter?', 'Ouch!', 'Who dug all these ditches?'];
  // What the model really sent back: valid JSON, but item 1 holds the rest of the batch in curly quotes,
  // and the other items are shifted by one.
  const leaked = JSON.stringify({
    1: "It's just a ditch.”, “2”:”What does that matter?”, “3”:”Ouch!”, “4”:”Who dug all these ditches?",
    2: "It's just a ditch.", 3: 'What does that matter?', 4: 'Ouch!',
  });

  it('spots JSON pieces in a translation, but not normal text', () => {
    expect(isLeak("It's just a ditch.”, “2”:”What does that matter?")).toBe(true);
    expect(isLeak('Sadece bir bataklık.", "2":"Ne fark eder?')).toBe(true);
    expect(isLeak('"3": "Ouch!')).toBe(true);
    for (const ok of ["It's just a ditch.", 'Hij zei: “ja”.', 'Om 3: 15 uur.', '[müzik]', 'Wait, what?']) expect(isLeak(ok)).toBe(false);
  });

  it('rejects the whole reply when one item leaked, so nothing is shifted', () => {
    expect(checkReply(salvage(leaked), NL)).toEqual([null, null, null, null]);
  });

  it('rejects a reply with unknown keys or one translation used for two sentences', () => {
    expect(checkReply({ 1: 'a b', 2: 'c d', 5: 'e' }, ['x y', 'z w'])).toEqual([null, null]);
    expect(checkReply({ 1: "It's just a ditch.", 2: "It's just a ditch." }, NL.slice(0, 2))).toEqual([null, null]);
  });

  it('maps answers by key, not position, and leaves a missing item empty', () => {
    expect(checkReply({ 2: 'What does that matter?', 1: "It's just a ditch." }, NL.slice(0, 2))).toEqual(EN.slice(0, 2));
    expect(checkReply({ 1: "It's just a ditch.", 3: 'Ouch!' }, NL.slice(0, 3))).toEqual(["It's just a ditch.", null, 'Ouch!']);
  });

  it('reads replies with curly quotes as delimiters, code fences or chatter around them', () => {
    expect(salvage('{“1”: “Ouch!”, “2”: “Who dug all these ditches?”}')).toEqual({ 1: 'Ouch!', 2: 'Who dug all these ditches?' });
    expect(salvage('Here you go:\n```json\n{"1":"Ouch!"}\n```\nHope this helps')).toEqual({ 1: 'Ouch!' });
    expect(jsonPart('```json\n{"1":"a"}\n```')).toBe('{"1":"a"}');
  });

  it('gives every line exactly its own translation after a leaked reply', async () => {
    const calls = [];
    const dict = Object.fromEntries(NL.map((t, i) => [t, EN[i]]));
    const tr = ollamaTranslator({
      baseUrl: 'http://h:1', model: 'm', from: 'nl', to: 'en',
      chat: async (_u, body) => {
        const items = JSON.parse(body.messages[1].content).translate;
        calls.push(Object.keys(items).length);
        if (calls.length === 1) return { status: 200, content: leaked };
        return { status: 200, content: JSON.stringify(Object.fromEntries(Object.entries(items).map(([k, t]) => [k, dict[t]]))) };
      },
    });
    const out = await tr(NL, [], undefined);
    expect(out).toEqual(EN);
    expect(out.some(isLeak)).toBe(false);
    expect(calls).toEqual([4, 2, 2]); // the bad batch was split and asked again
  });

  it('a reply with a merged item and a missing one: only clean items are kept, the rest asked again', async () => {
    let n = 0;
    const tr = ollamaTranslator({
      baseUrl: 'http://h:1', model: 'm', from: 'nl', to: 'en',
      chat: async () => (++n === 1
        ? { status: 200, content: '{"1":"It\'s just a ditch.","3":"Ouch!"}' }
        : { status: 200, content: '{"1":"What does that matter?"}' }),
    });
    expect(await tr(NL.slice(0, 3), [], undefined)).toEqual(EN.slice(0, 3));
  });

  it('cuts a cached translation back to before its first broken batch', () => {
    const units = Array.from({ length: 20 }, (_, i) => ({ text: `u${i}` }));
    const out = units.map((u) => `t-${u.text}`);
    expect(healed(out, units)).toBe(out);
    out[10] = 'a.”, “2”:”b';
    expect(healed(out, units)).toEqual(out.slice(0, 8)); // batch 8..15 is redone
    expect(healed(null, units)).toEqual([]);
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
      const res = await fetch(`${base}/api/translate`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: base }, body: JSON.stringify(body) });
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

describe('parseModels / modelFor', () => {
  it('reads "lang=model" pairs and falls back to the default model', async () => {
    const { parseModels, modelFor } = await import('./translate.mjs');
    const models = parseModels(' tr = aya-expanse:8b , bad, x=, EN=big ');
    expect(models).toEqual({ tr: 'aya-expanse:8b', en: 'big' });
    expect(modelFor({ model: 'gemma3', models }, 'tr')).toBe('aya-expanse:8b');
    expect(modelFor({ model: 'gemma3', models }, 'nl')).toBe('gemma3');
  });
});

describe('parallel batches', () => {
  it('runs batches at once but delivers them in order', async () => {
    const { createTranslateHandler } = await import('./translate.mjs');
    const delays = [60, 5, 30]; let call = 0;
    const h = createTranslateHandler({
      parallel: 3, jobs: 2,
      makeTranslator: () => async (texts) => { const d = delays[call++ % 3]; await new Promise((r) => setTimeout(r, d)); return texts.map((t) => `T:${t}`); },
    });
    const cues = Array.from({ length: 24 }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: `Zin nummer ${i}.` }));
    const { PassThrough } = await import('node:stream');
    const req = new PassThrough(); req.end(JSON.stringify({ from: 'nl', to: 'en', cues }));
    let out = ''; const res = new PassThrough(); res.writeHead = () => {}; res.on('data', (d) => (out += d));
    await h(req, res, '203.0.113.1');
    const events = out.trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'cues');
    expect(events.map((e) => e.done)).toEqual([8, 16, 24]);
    expect(events.flatMap((e) => e.cues.map((c) => c.text))).toEqual(cues.map((c) => `T:${c.text}`));
  });
});
