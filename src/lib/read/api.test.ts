import { describe, expect, it } from 'vitest';
import { grammarFor } from './api';

describe('grammarFor', () => {
  it('asks the model only for the opened sentence, also when it was parsed before as the next one', async () => {
    const sent: { sents: string[]; explain?: boolean; ui?: string }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      sent.push(b);
      return new Response(JSON.stringify({ docs: b.sents.map((s: string) => [{ t: s }]), ...(b.explain ? { grammar: { source: 'parser' } } : {}) }));
    }) as typeof fetch;
    const ref = { libraryId: 'x1' };
    const a = await grammarFor('nl', ['Een.', 'Twee.'], { fetchImpl, ref, explain: true, ui: 'tr' });
    expect(a.grammar).toEqual({ source: 'parser' });
    expect(sent[0]).toMatchObject({ sents: ['Een.', 'Twee.'], explain: true, ui: 'tr' });
    // "Twee." was parsed as the next sentence; opened now, it is sent again to be explained
    await grammarFor('nl', ['Twee.', 'Drie.'], { fetchImpl, ref, explain: true, ui: 'tr' });
    expect(sent[1]).toMatchObject({ sents: ['Twee.', 'Drie.'], explain: true });
    // everything known: no request
    await grammarFor('nl', ['Twee.'], { fetchImpl, ref, explain: true, ui: 'tr' });
    expect(sent).toHaveLength(2);
  });
});
