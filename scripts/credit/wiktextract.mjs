// English senses of word forms from a Wiktionary extract (kaikki.org, wiktextract JSONL, CC BY-SA), read from disk:
// no requests to Wiktionary. Two passes: the forms themselves, then the lemmas they are forms of ("gaat" -> "gaan").
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** One JSONL line -> { word, pos, senses: [{gloss}], lemmas: [..] }, or null. Exported for tests. */
export function readEntry(line) {
  let d;
  try { d = JSON.parse(line); } catch { return null; }
  if (!d || typeof d.word !== 'string' || !Array.isArray(d.senses)) return null;
  const senses = [], lemmas = [];
  for (const s of d.senses) {
    const gloss = Array.isArray(s.glosses) ? String(s.glosses[s.glosses.length - 1] ?? '') : '';
    if (Array.isArray(s.form_of) && s.form_of.length) { for (const f of s.form_of) if (f?.word && !lemmas.includes(f.word)) lemmas.push(f.word); continue; }
    if (gloss && !/^(inflection|plural|diminutive|alternative|obsolete)\b/i.test(gloss)) senses.push({ gloss: gloss.slice(0, 160) });
  }
  return { word: d.word, pos: String(d.pos ?? ''), senses, lemmas };
}

async function scan(file, want, take) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    // Cheap test before parsing: the word field comes early in every line.
    const m = /"word": "([^"]*)"/.exec(line);
    if (!m || !want(m[1])) continue;
    const e = readEntry(line);
    if (e) take(e);
  }
}

/**
 * Map form -> { senses: ["pos: gloss", ...] (own first, then the lemma's), lemma } for the given forms.
 * Forms are matched lower case and as written with a capital (German nouns).
 */
export async function sensesFor(file, forms) {
  const wanted = new Set(forms);
  const key = (w) => (wanted.has(w) ? w : wanted.has(w.toLowerCase()) ? w.toLowerCase() : null);
  const own = new Map();
  await scan(file, (w) => key(w) !== null, (e) => {
    const k = key(e.word);
    const cur = own.get(k) ?? { senses: [], lemmas: [] };
    cur.senses.push(...e.senses.map((s) => `${e.pos}: ${s.gloss}`));
    for (const l of e.lemmas) if (!cur.lemmas.includes(l)) cur.lemmas.push(l);
    own.set(k, cur);
  });
  const lemmaSet = new Set([...own.values()].flatMap((x) => x.lemmas));
  const lem = new Map();
  if (lemmaSet.size) {
    await scan(file, (w) => lemmaSet.has(w), (e) => {
      const cur = lem.get(e.word) ?? [];
      cur.push(...e.senses.map((s) => `${e.pos}: ${s.gloss}`));
      lem.set(e.word, cur);
    });
  }
  const out = new Map();
  for (const f of forms) {
    const o = own.get(f);
    if (!o) continue;
    const fromLemma = o.lemmas.flatMap((l) => (lem.get(l) ?? []).map((s) => `(${l}) ${s}`));
    out.set(f, { senses: [...o.senses, ...fromLemma].slice(0, 8), lemma: o.lemmas[0] ?? f });
  }
  return out;
}
