import { describe, expect, it } from 'vitest';
import { defineWord, posKey, DefineError } from './define';
import { parseBackup } from '../storage/backup';

const reply = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const ask = (f: typeof fetch) => defineWord({ word: 'graaf', lang: 'nl', to: 'tr', ctx: 'Ik graaf.', fetchImpl: f });

describe('defineWord', () => {
  it('returns the meaning with a timestamp', async () => {
    const m = await ask(reply(200, { lemma: 'graven', inContext: 'kazmak', senses: [{ head: 'graven', pos: 'verb', meaning: 'kazmak', best: true }], source: 'dictionary' }));
    expect(m).toMatchObject({ lemma: 'graven', inContext: 'kazmak', source: 'dictionary' });
    expect(m.at).toBeGreaterThan(0);
  });
  it('maps failures to friendly codes', async () => {
    await expect(ask(reply(429, { error: 'rate-limit' }))).rejects.toMatchObject({ code: 'rate-limit' });
    await expect(ask(reply(502, { error: 'llm-unreachable' }))).rejects.toMatchObject({ code: 'unavailable' });
    await expect(ask(reply(502, { error: 'llm-bad-response' }))).rejects.toMatchObject({ code: 'failed' });
    await expect(ask(reply(200, { nonsense: true }))).rejects.toBeInstanceOf(DefineError);
    await expect(ask((async () => { throw new Error('offline'); }) as typeof fetch)).rejects.toMatchObject({ code: 'network' });
  });
  it('knows the part-of-speech labels it can translate', () => {
    expect(posKey('Verb')).toBe('pos.verb');
    expect(posKey('proper noun')).toBe('pos.proper-noun');
    expect(posKey('letter')).toBeNull();
  });
});

describe('meanings in backups', () => {
  const backup = (meanings: unknown) => JSON.stringify({ app: 'balonca', version: 1, tracks: [], words: [{ w: 'graaf', lang: 'nl', ctx: 'Ik graaf.', meanings }] });
  it('keeps a valid meaning', () => {
    const m = { lemma: 'graven', inContext: 'kazmak', source: 'dictionary', at: 5, senses: [{ head: 'graven', pos: 'verb', meaning: 'kazmak', en: 'to dig', best: true }] };
    expect(parseBackup(backup({ tr: m })).words[0].meanings).toEqual({ tr: m });
  });
  it('drops broken or hostile entries field by field', () => {
    const w = parseBackup(backup({ 'tr<script>': { inContext: 'x', senses: [] }, en: { inContext: 'dig', senses: [{ meaning: 'dig', pos: 5, extra: 'evil' }, 'junk'], source: 'other' } })).words[0];
    expect(w.meanings).toEqual({ en: { lemma: '', inContext: 'dig', source: 'dictionary', at: 0, senses: [{ head: '', pos: '', meaning: 'dig' }] } });
    expect(parseBackup(backup('nope')).words[0].meanings).toBeUndefined();
  });
});
