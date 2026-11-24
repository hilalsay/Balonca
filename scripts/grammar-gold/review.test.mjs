import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReview, parseCsv, pyJson, rowOf, toCsv } from './review-lib.mjs';

const gold = (l) => readFileSync(new URL(`../../tests/grammar-gold/${l}.jsonl`, import.meta.url), 'utf8');
const records = ['nl', 'en'].flatMap((l) => gold(l).trim().split('\n').map((x) => JSON.parse(x)));

describe('grammar gold review sheet', () => {
  it('writes records in the same JSONL format as build.py', () => {
    for (const l of ['nl', 'en']) expect(records.filter((r) => r.lang === l).map(pyJson).join('\n') + '\n').toBe(gold(l));
  });
  it('round-trips the sheet, quotes and all, and reads semicolon CSV', () => {
    const rows = records.map(rowOf);
    expect(rows[0].parts).toBe('Ik [subject] | woon [verb] | sinds twee jaar [adverbial] | in Utrecht [adverbial]');
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('id;OK?;comment\r\nnl-001;ok;"a; ""b"""\r\n')).toEqual([{ id: 'nl-001', 'OK?': 'ok', comment: 'a; "b"' }]);
  });
  it('marks OK rows as checked and only lists comments, edits and "no"', () => {
    const rows = records.slice(0, 5).map(rowOf);
    rows[0]['OK?'] = 'evet';
    rows[1]['OK?'] = 'ok'; rows[1].comment = 'çeviri daha doğal olabilir';
    rows[2]['OK?'] = 'no';
    rows[3]['OK?'] = 'ok'; rows[3]['Turkish translation'] = 'Başka bir çeviri.';
    const res = applyReview(records, [...parseCsv(toCsv(rows)), { id: 'xx-999', 'OK?': 'ok' }], 'Ayşe');
    expect(res.checked).toEqual([records[0].id]);
    expect(res.records[0].checked_by).toBe('Ayşe');
    expect(res.records.slice(1).every((r) => r.checked_by === 'draft')).toBe(true);
    expect(res.toResolve.map((t) => [t.id, t.verdict])).toEqual([[records[1].id, 'ok'], [records[2].id, 'not ok'], [records[3].id, 'ok']]);
    expect(res.toResolve[2].edited).toEqual([{ column: 'Turkish translation', was: records[3].translation_tr, now: 'Başka bir çeviri.' }]);
    expect(res.records[3].translation_tr).toBe(records[3].translation_tr); // never applied automatically
    expect(res.unknown).toEqual(['xx-999']);
    expect(() => applyReview(records, rows, ' ')).toThrow();
  });
});
