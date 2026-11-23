// Word meanings for the word bags: real dictionary senses from Wiktionary, translated and matched to the sentence
// by the local model. Falls back to the model alone for words Wiktionary does not have. Zero dependencies.
import { createHash } from 'node:crypto';
import { llmContext, fellBack } from './llm/index.mjs';
import { ApiError, LANG_RE } from './lib.mjs';
import { logError } from './redact.mjs';
import { chatStream, diskCache, languageName, modelFor, readBody } from './translate.mjs';

const UA = 'Balonca/0.1 (subtitle language-learning app)';
const MAX_SENSES = 8;

// ---------------------------------------------------------------------------------------------------------------
// Wiktionary (en.wiktionary.org REST: English glosses for words of almost every language)

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const stripHtml = (html) => String(html ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => ENTITIES[e.toLowerCase()]
    ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m))
  .replace(/\s+/g, ' ').trim();

/** "plural of graaf", "inflection of schatten", "diminutive of leugen": a pointer to another headword. */
const FORM_OF = /^(?:\(.*?\)\s*)?(?:inflection|plural|diminutive|feminine|masculine|past|present|simple|first|second|third|singular|comparative|superlative|alternative|obsolete|nominative|genitive|dative|accusative|infinitive|gerund|imperative|participle|form|(?:first|second|third)(?:\/(?:first|second|third))*-person)\b/i;

/**
 * Wiktionary's definition JSON for one language -> { senses, lemmas }.
 * senses: [{ head, pos, gloss, example? }] (real meanings), lemmas: headwords this word is a form of.
 * Grammar lines ("first-person singular present indicative", "imperative") are not meanings and are dropped;
 * Wiktionary marks them with class="form-of-definition".
 */
export function parseWiktionary(data, lang, head) {
  const senses = [], lemmas = [], seen = new Set();
  for (const entry of data?.[lang] ?? []) {
    const pos = String(entry.partOfSpeech ?? '').toLowerCase();
    for (const d of entry.definitions ?? []) {
      const html = String(d.definition ?? '');
      const gloss = stripHtml(html).split(/:\s/)[0].replace(/[:,]?\s*notably$/i, '').replace(/:$/, '').trim();
      if (!gloss) continue;
      if (/form-of-definition/.test(html) || FORM_OF.test(gloss)) {
        const link = [...html.matchAll(/href="\/wiki\/([^"#?]+)#/g)].map((m) => decodeURIComponent(m[1])).find((l) => !l.startsWith('Appendix:'));
        const lemma = link?.replace(/_/g, ' ');
        if (lemma && lemma !== head && !lemmas.includes(lemma)) lemmas.push(lemma);
        continue;
      }
      if (seen.has(gloss)) continue;
      seen.add(gloss);
      const example = stripHtml(d.examples?.[0] ?? '') || undefined;
      senses.push({ head, pos, gloss: gloss.slice(0, 160), ...(example ? { example: example.slice(0, 160) } : {}) });
    }
  }
  return { senses, lemmas };
}

/** One Wiktionary page: { word, data } when found, { missing: true } for a real 404, null when it could not be asked. */
async function wiktionary(word, fetchImpl, signal) {
  let missing = false;
  for (const w of [word, word[0].toUpperCase() + word.slice(1)]) { // nouns like German "Haus" are capitalised
    let res = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) { // retries for a hiccup (timeout, 429, 5xx)
      if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const r = await fetchImpl(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        });
        if (r.ok || r.status === 404) res = r;
        else logError(`wiktionary lookup -> HTTP ${r.status}`); // never the word itself
      } catch (e) {
        if (signal?.aborted) return null;
        logError(`wiktionary lookup -> ${e?.name ?? 'error'}`);
      }
    }
    if (!res) return null;
    if (res.ok) return { word: w, data: await res.json().catch(() => null) };
    missing = true;
    if (w === word[0].toUpperCase() + word.slice(1)) break;
  }
  return missing ? { missing: true } : null;
}

/**
 * All dictionary senses for `word`, following "form of" pointers one step (graaf -> graven).
 * `missing` is true only when Wiktionary answered that it has no such word (not when it could not be reached).
 */
export async function lookup(word, lang, { fetchImpl = fetch, signal } = {}) {
  const first = await wiktionary(word, fetchImpl, signal);
  if (!first?.data) return { senses: [], lemma: word, missing: !!first?.missing };
  const own = parseWiktionary(first.data, lang, first.word);
  let senses = own.senses;
  for (const l of own.lemmas.slice(0, 2)) {
    const page = await wiktionary(l, fetchImpl, signal);
    if (page?.data) senses = senses.concat(parseWiktionary(page.data, lang, l).senses);
  }
  // No real meanings of its own (only "form of"): the lemma is the word to learn.
  const lemma = own.senses.length || !own.lemmas.length ? first.word : own.lemmas[0];
  // A page without an entry in this language is as good as missing.
  return { senses: senses.slice(0, MAX_SENSES), lemma, missing: !senses.length };
}

// ---------------------------------------------------------------------------------------------------------------
// The model: pick the sense used in the sentence and translate the glosses (or, with no dictionary data, answer alone)

/** Step 1, in English (the easiest task for a small model): which sense does the sentence use? */
export const pickPrompt = (from) =>
  `You help a language learner. You get a ${from} word, the sentence it was found in, and numbered dictionary senses of it in English. ` +
  `Reply with JSON {"best": n} where n is the number of the sense the word has in this sentence.`;

/** Step 2: translate the senses, and say what the word means in the sentence. */
export const glossPrompt = (from, to) =>
  `You translate English dictionary senses of a ${from} word into ${to} for a language learner.\n` +
  `Reply with JSON {"t": {...}}: every numbered sense translated into a short, natural ${to} meaning (1 to 8 words), under the same number. ` +
  `Translate only the English sense itself; do not explain or add anything. Write only ${to}.`;

/** No dictionary entry: the model alone, in English first (translated afterwards like dictionary senses). */
export const alonePrompt = (from) =>
  `You are a careful ${from}-English dictionary for language learners. You get a ${from} word and the sentence it was found in.\n` +
  `Reply with JSON:\n` +
  `- "lemma": the dictionary form of the word in ${from} (infinitive for verbs, singular for nouns).\n` +
  `- "senses": 1 to 3 common meanings of the lemma, the one used in the sentence first. Each: "pos" (noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, numeral or article) and "meaning" (a short English translation, 1 to 6 words).\n` +
  `Only list meanings you are sure of; one correct meaning is better than three guesses.`;

const str = { type: 'string' };
const pickSchema = (n) => ({ type: 'object', required: ['best'], properties: { best: { type: 'integer', minimum: 1, maximum: n } } });
const keys = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const glossSchema = (n) => ({
  type: 'object', required: ['t'],
  properties: { t: { type: 'object', required: keys(n), properties: Object.fromEntries(keys(n).map((k) => [k, str])) } },
});
const aloneSchema = {
  type: 'object', required: ['lemma', 'senses'],
  properties: { lemma: str,
    senses: { type: 'array', items: { type: 'object', required: ['pos', 'meaning'], properties: { pos: str, meaning: str } } } },
};

/** Some models wrap a string answer one level deeper ({"1": {"1": "…"}}): take the string inside. */
const flat = (v) => (v && typeof v === 'object' ? Object.values(v).find((x) => typeof x === 'string') ?? '' : v);
const tidy = (s, max = 120) => (typeof s === 'string' ? s.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Meaning of `word` (as found in `ctx`) explained in `to`:
 *   { word, lemma, inContext, senses: [{ head, pos, meaning, example?, best? }], source: 'dictionary' | 'ai' }
 */
export async function define({ word, lang, to, ctx }, { llm, chat = chatStream, fetchImpl = fetch, signal }) {
  const fromName = languageName(lang), toName = languageName(to);
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/api/chat`;
  const headers = llm.hostHeader ? { host: llm.hostHeader } : {};
  // Picking the sense happens in English (the base model); writing in the learner's language may use a stronger one.
  const ask = async (system, user, format, maxTokens, model = llm.model) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await chat(url, {
        model, keep_alive: '15m', format, options: { temperature: 0.1, num_ctx: 2048, num_predict: maxTokens },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }],
      }, { headers, signal });
      if (res.status === 404) throw new ApiError(502, 'llm-model-missing');
      if (res.status < 200 || res.status >= 300) throw new ApiError(502, 'llm-failed', String(res.status));
      try { return JSON.parse(res.content); } catch { /* broken or looping answer: once more */ }
    }
    throw new ApiError(502, 'llm-bad-response');
  };

  // 1. English senses: from Wiktionary, or (no entry) from the model alone.
  const dict = await lookup(word, lang, { fetchImpl, signal });
  let source = 'dictionary', senses = dict.senses, lemma = dict.lemma, best = 0;
  if (senses.length > 1) {
    const numbered = Object.fromEntries(senses.map((s, i) => [String(i + 1), `${s.head} (${s.pos}): ${s.gloss}`]));
    const p = await ask(pickPrompt(fromName), { word, sentence: ctx, senses: numbered }, pickSchema(senses.length), 24);
    if (Number.isInteger(p.best) && p.best >= 1 && p.best <= senses.length) best = p.best - 1;
  }
  // Wiktionary could not be asked (not: has no such word): answer with the model, but do not keep that answer.
  const temporary = !senses.length && !dict.missing;
  if (!senses.length) {
    source = 'ai';
    const o = await ask(alonePrompt(fromName), { word, sentence: ctx }, aloneSchema, 300);
    lemma = tidy(o.lemma, 60) || word;
    senses = (Array.isArray(o.senses) ? o.senses : []).slice(0, 3)
      .map((s) => ({ head: lemma, pos: tidy(s?.pos, 20).toLowerCase(), gloss: tidy(s?.meaning) }))
      .filter((s) => s.gloss);
    if (!senses.length) throw new ApiError(502, 'llm-bad-response');
  }

  // 2. Into the learner's language (English needs nothing more).
  let t = {};
  if (to !== 'en') {
    const g = await ask(glossPrompt(fromName, toName),
      // No sentence here: given one, a small model translates the sentence instead of the sense.
      { word, senses: Object.fromEntries(senses.map((s, i) => [String(i + 1), `(${s.pos}) ${s.gloss}`])) },
      glossSchema(senses.length), 80 + senses.length * 40, modelFor(llm, to));
    t = g.t ?? {};
  }
  const out = senses.map((s, i) => ({
    head: s.head, pos: s.pos, meaning: (to !== 'en' ? tidy(flat(t[String(i + 1)])) : '') || s.gloss,
    ...(to !== 'en' ? { en: s.gloss } : {}), ...(s.example ? { example: s.example } : {}), ...(i === best ? { best: true } : {}),
  }));
  out.unshift(...out.splice(best, 1)); // the meaning in this sentence first
  return { word, lemma: out[0].head || lemma, inContext: out[0].meaning, senses: out, source, ...(temporary ? { temporary: true } : {}) };
}

/** Validates the POST body: {word, lang, to, ctx}. */
export function parseDefineRequest(raw) {
  let b;
  try { b = JSON.parse(raw); } catch { throw new ApiError(400, 'bad-request'); }
  const word = String(b?.word ?? '').trim(), lang = String(b?.lang ?? '').toLowerCase(), to = String(b?.to ?? '').toLowerCase();
  if (!word || word.length > 60 || /[\n<>]/.test(word)) throw new ApiError(400, 'bad-request');
  if (!LANG_RE.test(lang) || !LANG_RE.test(to) || lang === to) throw new ApiError(400, 'bad-request');
  return { word, lang, to, ctx: String(b?.ctx ?? '').slice(0, 500) };
}

/** POST /api/define handler. Results are cached on disk per word, language, sentence and model. */
export function createDefineHandler({ llm, cacheDir = '', chat, fetchImpl } = {}) {
  const cache = diskCache(cacheDir);
  return (req, res) => llmContext.run({}, () => defineRoute(req, res));
  async function defineRoute(req, res) {
    const q = parseDefineRequest(await readBody(req, 20_000));
    const key = createHash('sha256').update(JSON.stringify(['v3', llm.model, ...(llm.models?.[q.to] ? [llm.models[q.to]] : []), q.word, q.lang, q.to, q.ctx])).digest('hex').slice(0, 32);
    let out = await cache.get(key);
    if (!out) {
      const ctl = new AbortController();
      res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
      out = await define(q, { llm, signal: ctl.signal, ...(chat ? { chat } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
      if (!out.temporary && !fellBack()) await cache.set(key, out); // a guess made while the dictionary was unreachable is not kept
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(out));
  };
}
