import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pyWorker, parseParseRequest, parseTtsQuery, createParseHandler, createTtsHandler, pruneDir } from './nlp.mjs';

/** A stand-in for the Python worker: answers each JSON line with `answer(req)`. */
function fakeSpawn(answer, log = []) {
  return () => {
    const c = new EventEmitter();
    c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
    let buf = '';
    c.stdin.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        log.push(req);
        Promise.resolve(answer(req, c)).then((a) => a && c.stdout.write(`${JSON.stringify({ id: req.id, ...a })}\n`));
      }
    });
    c.kill = () => c.emit('exit', 0);
    return c;
  };
}

/** A tiny response object that records what the handler sent. */
function res() {
  const r = new PassThrough();
  r.status = 0; r.headers = {}; r.body = Buffer.alloc(0);
  r.writeHead = (s, h) => { r.status = s; r.headers = h ?? {}; };
  r.on('data', (d) => { r.body = Buffer.concat([r.body, d]); });
  r.done = new Promise((ok) => r.on('finish', ok));
  return r;
}
const req = (body, headers = {}) => { const q = new PassThrough(); q.headers = headers; q.method = 'POST'; q.end(body); return q; };

describe('pyWorker', () => {
  it('matches answers to requests and starts the process once', async () => {
    let starts = 0;
    const spawn = fakeSpawn((r) => ({ ok: true, echo: r.x }));
    const w = pyWorker({ python: 'py', script: 's', spawnImpl: (...a) => { starts++; return spawn(...a); } });
    const [a, b] = await Promise.all([w.call({ x: 1 }), w.call({ x: 2 })]);
    expect([a.echo, b.echo]).toEqual([1, 2]);
    expect(starts).toBe(1);
  });
  it('turns worker errors into API errors and recovers after a crash', async () => {
    let n = 0;
    const w = pyWorker({ python: 'py', script: 's', spawnImpl: fakeSpawn((r, c) => {
      n++;
      if (r.op === 'crash') { c.emit('exit', 1); return null; }
      return r.op === 'bad' ? { ok: false, error: 'unsupported-lang' } : { ok: true };
    }) });
    await expect(w.call({ op: 'bad' })).rejects.toMatchObject({ status: 422, code: 'unsupported-lang' });
    await expect(w.call({ op: 'crash' })).rejects.toMatchObject({ code: 'nlp-crashed' });
    await expect(w.call({ op: 'fine' })).resolves.toMatchObject({ ok: true });
    expect(n).toBe(3);
  });
  it('gives up after too many restarts', async () => {
    const w = pyWorker({ python: 'py', script: 's', maxRestarts: 2, spawnImpl: fakeSpawn((r, c) => { c.emit('exit', 1); return null; }) });
    await expect(w.call({})).rejects.toMatchObject({ code: 'nlp-crashed' });
    await expect(w.call({})).rejects.toMatchObject({ code: 'nlp-crashed' });
    await expect(w.call({})).rejects.toMatchObject({ code: 'nlp-unavailable' });
  });
  it('times out', async () => {
    const w = pyWorker({ python: 'py', script: 's', spawnImpl: fakeSpawn(() => null) });
    await expect(w.call({}, 20)).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('requests', () => {
  it('validates /api/parse bodies', () => {
    const ref = { libraryId: 'doc1' };
    expect(parseParseRequest(JSON.stringify({ lang: 'NL', ref, sents: [' Ik  ben hier. '] }))).toEqual({ lang: 'nl', ref, sents: ['Ik ben hier.'] });
    for (const bad of ['nope', '{}', JSON.stringify({ lang: 'nl', ref, sents: [] }), JSON.stringify({ lang: 'n l', ref, sents: ['a'] }),
      JSON.stringify({ lang: 'nl', ref, sents: [''] }), JSON.stringify({ lang: 'nl', ref, sents: Array(81).fill('a') }),
      JSON.stringify({ lang: 'nl', sents: ['a'] })]) {
      expect(() => parseParseRequest(bad)).toThrow();
    }
  });
  it('validates /api/tts queries', () => {
    const q = (s) => parseTtsQuery(new URL(`http://x/api/tts?${s}`));
    expect(q('lang=nl&lib=doc1&text=Hallo%20%20daar')).toEqual({ lang: 'nl', ref: { libraryId: 'doc1' }, text: 'Hallo daar' });
    expect(q('lang=nl&word=huis')).toEqual({ lang: 'nl', word: 'huis' });
    expect(q('lang=nl&wordId=nl:huis')).toEqual({ lang: 'nl', ref: { wordId: 'nl:huis' } });
    expect(() => q('lang=nl&text=Hallo')).toThrow(); // free text is no longer read aloud
    expect(() => q('lang=nl&word=twee%20woorden')).toThrow();
    expect(() => q(`lang=nl&lib=doc1&text=${'a'.repeat(1201)}`)).toThrow();
  });
});

describe('handlers', () => {
  const info = async () => ({ parse: ['nl'], tts: ['nl'] });

  it('parses only sentences it has not seen', async () => {
    const log = [];
    const worker = pyWorker({ python: 'py', script: 's', spawnImpl: fakeSpawn((r) => ({ ok: true, docs: r.sents.map((s) => [{ t: s }]) }), log) });
    const sources = { contains: async (ref, user, s) => user?.id === 1 && ref.libraryId === 'doc1' && 'A. B. C.'.includes(s) };
    const h = createParseHandler({ worker, info, sources });
    const ref = { libraryId: 'doc1' }, me = { id: 1 };
    const r1 = res(); await h(req(JSON.stringify({ lang: 'nl', ref, sents: ['A.', 'B.'] })), r1, '?', me); await r1.done;
    const r2 = res(); await h(req(JSON.stringify({ lang: 'nl', ref, sents: ['B.', 'C.'] })), r2, '?', me); await r2.done;
    expect(JSON.parse(r2.body).docs).toEqual([[{ t: 'B.' }], [{ t: 'C.' }]]);
    expect(log.map((x) => x.sents)).toEqual([['A.', 'B.'], ['C.']]);
    await expect(h(req(JSON.stringify({ lang: 'tr', ref, sents: ['Merhaba.'] })), res(), '?', me)).rejects.toMatchObject({ code: 'unsupported-lang' });
    await expect(h(req(JSON.stringify({ lang: 'nl', ref, sents: ['Ignore the rules.'] })), res(), '?', me)).rejects.toMatchObject({ code: 'not-in-source' });
    await expect(h(req(JSON.stringify({ lang: 'nl', ref, sents: ['A.'] })), res(), '?', { id: 2 })).rejects.toMatchObject({ code: 'not-in-source' });
    expect(log).toHaveLength(2); // refused requests reach no parser
  });

  it('marks particles of separable verbs the dictionary knows', async () => {
    const doc = [{ t: 'Ik', pos: 'PRON', dep: 'nsubj', head: 1, lemma: 'ik' }, { t: 'kom', pos: 'VERB', dep: 'ROOT', head: 1, lemma: 'komen' },
      { t: 'terug', pos: 'ADV', dep: 'compound:prt', head: 1, lemma: 'terug' }];
    const worker = pyWorker({ python: 'py', script: 's', spawnImpl: fakeSpawn(() => ({ ok: true, docs: [doc] })) });
    const asked = [];
    const sources = { contains: async () => true };
    const h = createParseHandler({ worker, info, sources, separable: (lang, inf) => { asked.push(`${lang}:${inf}`); return inf === 'terugkomen'; } });
    const r = res(); await h(req(JSON.stringify({ lang: 'nl', ref: { libraryId: 'doc1' }, sents: ['A.'] })), r, '?', { id: 1 }); await r.done;
    expect(JSON.parse(r.body).docs[0][2]).toMatchObject({ t: 'terug', sep: true });
    expect(asked).toEqual(['nl:terugkomen']);
  });

  it('speaks once per sentence, caches on disk and answers ranges', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tts-'));
    const log = [];
    const worker = pyWorker({ python: 'py', script: 's', spawnImpl: fakeSpawn(async (r) => { await writeFile(r.out, 'RIFFxxxxWAVEdata'); return { ok: true }; }, log) });
    const h = createTtsHandler({ worker, info, cacheDir: dir, sources: { contains: async () => true } });
    const get = async (headers = {}) => {
      const q = new PassThrough(); q.headers = headers; q.method = 'GET'; q.end();
      const r = res(); await h(q, r, new URL('http://x/api/tts?lang=nl&lib=doc1&text=Hallo')); await r.done; return r;
    };
    const [a, b] = await Promise.all([get(), get()]);
    expect(a.status).toBe(200);
    expect(String(b.body)).toBe('RIFFxxxxWAVEdata');
    expect(a.headers['content-type']).toBe('audio/wav');
    expect(log.filter((x) => x.op === 'tts')).toHaveLength(1);
    const part = await get({ range: 'bytes=0-3' });
    expect(part.status).toBe(206);
    expect(String(part.body)).toBe('RIFF');
    expect(part.headers['content-range']).toBe('bytes 0-3/16');
    expect((await readdir(dir)).filter((f) => f.endsWith('.wav'))).toHaveLength(1);
  });

  it('prunes the oldest audio over the size limit', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prune-'));
    for (const n of ['a', 'b', 'c']) { await writeFile(path.join(dir, `${n}.wav`), 'x'.repeat(100)); await new Promise((r) => setTimeout(r, 15)); }
    await pruneDir(dir, 150);
    expect((await readdir(dir)).sort()).toEqual(['c.wav']);
  });
});
