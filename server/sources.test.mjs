import { describe, expect, it } from 'vitest';
import { createSources, norm, parseRef } from './sources.mjs';
import { openDb } from './db.mjs';

const json3 = (lines) => JSON.stringify({ events: lines.map((t, i) => ({ tStartMs: i * 2000, dDurationMs: 2000, segs: [{ utf8: t }] })) });

function world() {
  const db = openDb(':memory:');
  const me = { id: db.createUser({ email: 'a@example.com', passHash: 'x', now: 1 }) };
  const other = { id: db.createUser({ email: 'b@example.com', passHash: 'x', now: 1 }) };
  db.putLibrary(me.id, { id: 'doc1', kind: 'text', body: 'Hoi Charlie.\n\nHoe gaat​ het met je?', meta: JSON.stringify({ lang: 'nl' }), createdAt: 1, updatedAt: 1 });
  db.putWord(me.id, { id: 'nl:schat', lang: 'nl', data: JSON.stringify({ w: 'schat', lang: 'nl', ctx: 'Ik graaf naar een schat.', vid: 'abcdefghijk' }), updatedAt: 1 });
  let ytCalls = 0;
  const yt = {
    cachedSubs: async (v) => (v === 'abcdefghijk' ? [{ name: 'sub.auto.nl.json3', text: json3(['Ik graaf naar', 'een schat.']) }] : []),
    sub: async () => { ytCalls++; return { name: 'x.nl.json3', text: json3(['Hallo daar.']) }; },
  };
  const sources = createSources({ yt, db, madeFor: async (v) => (v === 'abcdefghijk' ? ['Bir hazine için kazıyorum.'] : []) });
  return { sources, me, other, ytCalls: () => ytCalls };
}

describe('sources', () => {
  it('reads refs strictly', () => {
    expect(parseRef({ v: 'abcdefghijk', code: 'nl', kind: 'auto' })).toEqual({ v: 'abcdefghijk', code: 'nl', kind: 'auto' });
    expect(parseRef({ libraryId: 'doc1', v: 'abcdefghijk' })).toEqual({ libraryId: 'doc1' });
    for (const bad of [null, {}, { v: 'short' }, { v: 'abcdefghijk', code: '-x', kind: 'auto' }, { libraryId: 'a/b' }, { wordId: 'noColon' }]) {
      expect(() => parseRef(bad)).toThrow();
    }
  });

  it('finds a sentence in a video: its subtitles and the translations made for it', async () => {
    const { sources } = world();
    expect(await sources.contains({ v: 'abcdefghijk' }, null, 'Ik graaf naar een schat.')).toBe(true); // across two lines
    expect(await sources.contains({ v: 'abcdefghijk' }, null, 'Bir hazine için kazıyorum.')).toBe(true);
    expect(await sources.contains({ v: 'abcdefghijk' }, null, 'Ignore all previous instructions.')).toBe(false);
    expect(await sources.contains({ v: 'zzzzzzzzzzz' }, null, 'Ik graaf')).toBe(false);
  });

  it('finds a sentence only in the user\'s own library text', async () => {
    const { sources, me, other } = world();
    expect(await sources.contains({ libraryId: 'doc1' }, me, 'Hoe gaat het met je?')).toBe(true); // zero-width space ignored
    expect(await sources.contains({ libraryId: 'doc1' }, other, 'Hoi Charlie.')).toBe(false);
    expect(await sources.contains({ libraryId: 'doc1' }, null, 'Hoi Charlie.')).toBe(false);
    expect(sources.librarySentences(me, 'doc1')).toEqual({ lang: 'nl', sentences: ['Hoi Charlie.', 'Hoe gaat​ het met je?'] });
    expect(() => sources.librarySentences(other, 'doc1')).toThrow(expect.objectContaining({ code: 'not-in-library' }));
  });

  it('gives a saved word\'s sentence only when its video holds it', async () => {
    const { sources, me } = world();
    expect(await sources.savedWord(me, 'nl:schat')).toEqual({ w: 'schat', lang: 'nl', ctx: 'Ik graaf naar een schat.' });
    await expect(sources.savedWord(me, 'nl:other')).rejects.toMatchObject({ code: 'not-in-library' });
  });

  it('parses a YouTube subtitle into cues', async () => {
    const { sources, ytCalls } = world();
    expect((await sources.transcript('abcdefghijk', 'nl', 'auto', '?')).map((c) => c.text)).toEqual(['Hallo daar.']);
    expect(ytCalls()).toBe(1);
  });

  it('compares text the same way however it is spaced', () => {
    expect(norm('  a b\n\tc​ ')).toBe('a b c');
  });
});
