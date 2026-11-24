import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGrammarEngine, nuanceFits } from './grammar.mjs';
import { ApiError } from './lib.mjs';

// A valid answer for the sentence below.
const text = 'Ik bel je morgen terug.';
const good = {
  clauses: [{ id: 0, kind: 'main' }],
  parts: [{ text: 'Ik', role: 'subject', clause: 0 }, { text: 'bel', role: 'verb', clause: 0 }, { text: 'je', role: 'object', clause: 0 },
    { text: 'morgen', role: 'adverbial', clause: 0 }, { text: 'terug', role: 'verbPart', clause: 0 }, { text: '.', role: 'punct', clause: 0 }],
  notes: [{ kind: 'tense', tense: 'present', words: ['bel'] }, { kind: 'separable', lemma: 'terugbellen', words: ['bel', 'terug'] }],
  nuance: 'Şimdiki zaman, gelecek anlamında.',
};

/** A stand-in for llm/index.mjs. `answers`: what each call returns (an object, or an Error to throw). */
function fakeLlm({ answers = [], provider = 'tinker', spent = 0 } = {}) {
  const calls = [];
  return {
    calls,
    status: () => ({ provider }),
    model: () => 'org/Big',
    spentToday: async (purpose) => (purpose === 'grammar' ? spent : 0),
    chat: async (url, body, opts, purpose) => {
      calls.push({ body, opts, purpose });
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return { status: 200, content: JSON.stringify(a ?? good) };
    },
  };
}

let dirs = [];
const tmp = async () => { const d = await mkdtemp(path.join(tmpdir(), 'grammar-')); dirs.push(d); return d; };
afterEach(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); dirs = []; });

const lib = { libraryId: 'doc1' }, me = { id: 1 }, other = { id: 2 };

describe('grammar engine', () => {
  it('answers with the model when everything is in order, through the forced tool and its own purpose', async () => {
    const llm = fakeLlm();
    const g = createGrammarEngine({ llm, engine: 'model', cacheDir: await tmp() });
    const r = await g.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' });
    expect(r).toMatchObject({ source: 'model', answer: { nuance: good.nuance } });
    expect(llm.calls[0]).toMatchObject({ purpose: 'grammar', opts: { noFallback: true } });
    expect(llm.calls[0].body.format.required).toContain('parts');
    expect(llm.calls[0].body.messages[1].content).toBe(JSON.stringify({ sentence: text }));
  });

  it('falls back to the parser: setting off, other languages, Ollama, budget, Tinker errors, invalid answers', async () => {
    const dir = await tmp();
    const ask = async (opts, llm) => (await createGrammarEngine({ llm, cacheDir: dir, ...opts }).explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr', ...opts.q })).source;
    const off = fakeLlm();
    expect(await ask({ engine: 'parser' }, off)).toBe('parser');
    expect(await ask({ engine: 'model', q: { lang: 'de' } }, off)).toBe('parser');
    expect(off.calls).toHaveLength(0);

    const ollama = fakeLlm({ provider: 'ollama' });
    expect(await ask({ engine: 'model' }, ollama)).toBe('parser'); // gemma3 is too weak for this
    expect(ollama.calls).toHaveLength(0);

    const broke = fakeLlm({ spent: 2.5 });
    expect(await ask({ engine: 'model', budgetUsd: 2 }, broke)).toBe('parser'); // GRAMMAR_DAILY_BUDGET_USD used up
    expect(broke.calls).toHaveLength(0);

    const failing = fakeLlm({ answers: [new ApiError(502, 'llm-failed')] });
    const g = createGrammarEngine({ llm: failing, engine: 'model', cacheDir: dir });
    expect((await g.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' })).source).toBe('parser');
    expect((await g.status()).parser).toMatchObject({ error: 1 });

    const bad = fakeLlm({ answers: [{ ...good, parts: good.parts.slice(1) }] });
    const g2 = createGrammarEngine({ llm: bad, engine: 'model', cacheDir: await tmp() });
    expect((await g2.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' })).source).toBe('parser');
    expect((await g2.status()).rejects).toEqual({ rebuild: 1 }); // by reason, no text
    // a rejected sentence is not asked again
    expect((await g2.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' })).source).toBe('parser');
    expect(bad.calls).toHaveLength(1);

    // rule 4: the dictionary knows the verb and says it is not separable
    const sep = fakeLlm();
    const g3 = createGrammarEngine({ llm: sep, engine: 'model', cacheDir: await tmp(), dictionary: (l, f) => (f === 'terugbellen' ? { separable: false } : null) });
    expect((await g3.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' })).source).toBe('parser');
    expect((await g3.status()).rejects).toEqual({ separable: 1 });
  });

  it('caches private texts per user and public content for everyone', async () => {
    const dir = await tmp();
    const llm = fakeLlm({ answers: [good, good, good] });
    const g = createGrammarEngine({ llm, engine: 'model', cacheDir: dir });
    // a sentence of the user's own text: cached for that user only
    await g.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' });
    await g.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' });
    expect(llm.calls).toHaveLength(1);
    await g.explain({ lang: 'nl', text, ref: lib, user: other, ui: 'tr' });
    expect(llm.calls).toHaveLength(2);
    // video subtitles and the sample texts: one answer for everyone
    const sample = 'Op zaterdag sta ik altijd vroeg op.';
    const sampleAnswer = { clauses: [{ id: 0, kind: 'main' }], parts: [{ text: 'Op zaterdag', role: 'adverbial', clause: 0 }, { text: 'sta', role: 'verb', clause: 0 },
      { text: 'ik', role: 'subject', clause: 0 }, { text: 'altijd', role: 'adverbial', clause: 0 }, { text: 'vroeg', role: 'adverbial', clause: 0 },
      { text: 'op', role: 'verbPart', clause: 0 }, { text: '.', role: 'punct', clause: 0 }], notes: [], nuance: '' };
    llm.calls.length = 0;
    const g2 = createGrammarEngine({ llm: fakeLlm({ answers: [sampleAnswer] }), engine: 'model', cacheDir: dir });
    expect((await g2.explain({ lang: 'nl', text: sample, ref: lib, user: me, ui: 'tr' })).source).toBe('model');
    const again = fakeLlm({ answers: [new Error('should not be asked')] });
    const g3 = createGrammarEngine({ llm: again, engine: 'model', cacheDir: dir });
    expect((await g3.explain({ lang: 'nl', text: sample, ref: { libraryId: 'theirs' }, user: other, ui: 'tr' })).source).toBe('model');
    expect(again.calls).toHaveLength(0);
    expect(g.isShared({ v: 'dQw4w9WgXcQ' }, 'Anything at all.')).toBe(true);
    expect(g.isShared(lib, text)).toBe(false);
    const files = await readdir(dir);
    expect(files.filter((f) => f.startsWith('u1-'))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith('u2-'))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith('s-'))).toHaveLength(1);
  });

  it('drops a nuance that is not in the reader\'s language, and keeps the labels', async () => {
    expect(nuanceFits('Şimdiki zaman, gelecek anlamında.', 'tr')).toBe(true);
    expect(nuanceFits('present tense met future meaning', 'tr')).toBe(false);
    expect(nuanceFits('Present tense with a future meaning.', 'en')).toBe(true);
    const g = createGrammarEngine({ llm: fakeLlm({ answers: [{ ...good, nuance: 'present tense met future meaning' }] }), engine: 'model', cacheDir: await tmp() });
    const r = await g.explain({ lang: 'nl', text, ref: lib, user: me, ui: 'tr' });
    expect(r).toMatchObject({ source: 'model', answer: { nuance: '', parts: good.parts } });
    expect((await g.status()).nuanceDropped).toBe(1);
  });
});
