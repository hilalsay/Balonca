// The review sheet for the grammar gold set: records <-> CSV rows, and a filled-in sheet read back.
// review.mjs writes tests/grammar-gold/review.csv; apply-review.mjs reads it back. No dependencies.

export const COLUMNS = ['id', 'level', 'sentence', 'parts', 'notes', 'mustNot', 'Turkish translation', 'OK?', 'comment'];

/** "Ik [subject] | woon [verb] | …" */
export const partsCell = (r) => r.parts.map(([text, role]) => `${text} [${role}]`).join(' | ');

/** The cells a reviewer reads, as written to the sheet. */
export function rowOf(r) {
  return { id: r.id, level: r.level, sentence: r.text, parts: partsCell(r), notes: r.notes.join(' '), mustNot: r.mustNot.join(' '),
    'Turkish translation': r.translation_tr, 'OK?': '', comment: '' };
}

const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** CSV with a byte-order mark, so spreadsheet programs open the Turkish and Dutch letters correctly. */
export const toCsv = (rows) => '﻿' + [COLUMNS, ...rows.map((r) => COLUMNS.map((k) => r[k] ?? ''))].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';

/** RFC 4180 CSV (comma or semicolon, as spreadsheets in some locales save it) -> objects by header. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], v = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { v += '"'; i++; } else if (ch === '"') q = false; else v += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(v); v = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(v); rows.push(row); row = []; v = ''; }
    else v += ch;
  }
  if (v || row.length) { row.push(v); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const YES = new Set(['ok', 'yes', 'y', 'evet', 'e', 'ja', 'j', 'x', '✓', '✔', '1', 'true', 'doğru', 'tamam']);
const NO = new Set(['no', 'n', 'hayır', 'nee', '✗', '0', 'false', 'yanlış']);
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Applies a filled-in sheet to the records. A row marked OK with no comment and no edited cell gets
 * `checked_by: reviewer`; every other reviewed row is listed for a person to resolve and the record is left as it is
 * (comments and edits are never applied automatically). Returns { records, checked, toResolve, unknown }.
 */
export function applyReview(records, rows, reviewer) {
  if (!tidy(reviewer)) throw new Error('reviewer name missing');
  const byId = new Map(records.map((r) => [r.id, r]));
  const checked = [], toResolve = [], unknown = [];
  const out = records.map((r) => ({ ...r }));
  const outById = new Map(out.map((r) => [r.id, r]));
  for (const row of rows) {
    const id = tidy(row.id);
    const r = byId.get(id);
    if (!r) { unknown.push(id || '(empty id)'); continue; }
    const ok = tidy(row['OK?']).toLocaleLowerCase('tr'), comment = tidy(row.comment);
    const want = rowOf(r);
    const edited = ['sentence', 'parts', 'notes', 'mustNot', 'Turkish translation']
      .filter((k) => k in row && tidy(row[k]) !== tidy(want[k])).map((k) => ({ column: k, was: want[k], now: tidy(row[k]) }));
    if (!ok && !comment && !edited.length) continue; // not reviewed yet
    const verdict = YES.has(ok) ? 'ok' : NO.has(ok) ? 'not ok' : ok ? `unclear "${row['OK?'].trim()}"` : 'no verdict';
    if (verdict === 'ok' && !comment && !edited.length) { outById.get(id).checked_by = tidy(reviewer); checked.push(id); }
    else toResolve.push({ id, text: r.text, verdict, comment, edited });
  }
  return { records: out, checked, toResolve, unknown };
}

/** One record as one JSONL line, in the format build.py writes (Python's json.dumps, ensure_ascii=False). */
export function pyJson(v) {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`;
  return JSON.stringify(v);
}
