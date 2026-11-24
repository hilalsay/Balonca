// Grammar by the model (grammar-llm.md), with spaCy and the rules as the fallback.
// The model only labels the sentence (src/lib/read/grammar-model.ts); the browser turns its answer into the panel with
// the same hand-written templates as for the parser. The parser answers whenever:
//   GRAMMAR_ENGINE is not "model", the language is not nl/en, the provider is not Tinker (Ollama is too weak for
//   this), the grammar budget of the day is used up, the call fails, or the answer fails validation.
// Answers are cached by sentence, language, prompt (version + hash) and model: shared for what anyone can see
// (video subtitles, the sample texts), per user for their own texts. Rejections are counted by reason, never with text.
import { createHash } from 'node:crypto';
import { diskCache } from './translate.mjs';
import { logError } from './redact.mjs';
import { GRAMMAR_SCHEMA, MODEL_LANGS, promptId, systemPrompt, userMessage, validateAnswer, SAMPLES } from './gen/shared.mjs';
import { norm } from './sources.mjs';

const UI_LANGS = new Set(['tr', 'en']);
/**
 * Whether a nuance is written in the reader's language. The model sometimes answers in English or Dutch despite the
 * prompt; such a nuance is dropped (the labels stay). Turkish text nearly always has one of these letters.
 */
export const nuanceFits = (nuance, ui) => (ui === 'tr' ? /[çğıöşüÇĞİÖŞÜ]/.test(nuance) : !/[çğışÇĞİŞ]/.test(nuance));
/** Sentences of the sample texts (the same for everyone), for the shared cache. */
const sampleText = Object.values(SAMPLES).map((s) => norm(s.body)).join('\n');

/**
 * llm: the model layer (llm/index.mjs: chat, status, model, spentToday). engine: 'model' | 'parser'.
 * budgetUsd: GRAMMAR_DAILY_BUDGET_USD. dictionary(lang, form): phase 3b entries, for validation rule 4.
 */
export function createGrammarEngine({ llm, engine = 'parser', budgetUsd = 2, cacheDir = '', dictionary = () => null }) {
  const cache = diskCache(cacheDir);
  const counts = { model: 0, parser: {}, rejects: {} };
  const parser = (why) => { counts.parser[why] = (counts.parser[why] ?? 0) + 1; return { source: 'parser' }; };

  /** True when everyone may see this sentence in this source, so its answer can be shared. */
  const isShared = (ref, text) => !!ref?.v || (!!ref?.libraryId && sampleText.includes(norm(text)));

  /**
   * The model's labels for one sentence the user opened, or { source: 'parser' }.
   * `ref` names the source the sentence was checked against; `ui` is the reader's interface language (for nuance).
   */
  async function explain({ lang, text, ref, user, ui }) {
    if (engine !== 'model') return { source: 'parser' };
    if (!MODEL_LANGS.includes(lang)) return parser('lang');
    if (llm.status().provider !== 'tinker') return parser('provider');
    const uiLang = UI_LANGS.has(ui) ? ui : 'tr';
    const model = llm.model('');
    const id = createHash('sha256').update(`${promptId(lang, uiLang)}\n${model}\n${lang}\n${uiLang}\n${norm(text)}`).digest('hex').slice(0, 40);
    const shared = isShared(ref, text);
    if (!shared && !user) return parser('private');
    const key = shared ? `s-${id}` : `u${user.id}-${id}`;
    const hit = await cache.get(key);
    if (hit?.answer) { counts.model++; return { source: 'model', answer: hit.answer }; }
    if (hit?.rejected) return parser('rejected');
    if ((await llm.spentToday('grammar')) >= budgetUsd) return parser('budget');
    let raw;
    try {
      const r = await llm.chat('', { model, format: GRAMMAR_SCHEMA, options: { temperature: 0, num_predict: 1400 },
        messages: [{ role: 'system', content: systemPrompt(lang, uiLang) }, { role: 'user', content: userMessage(text) }] }, { noFallback: true }, 'grammar');
      raw = JSON.parse(r.content);
    } catch (e) {
      if (e?.code !== 'budget') logError(`grammar model failed (${e?.code ?? e?.message ?? 'error'}): the parser answers`);
      return parser(e?.code === 'budget' ? 'budget' : 'error');
    }
    const v = validateAnswer(raw, text, (form) => dictionary(lang, form));
    if (!v.ok) {
      counts.rejects[v.reason] = (counts.rejects[v.reason] ?? 0) + 1;
      await cache.set(key, { rejected: v.reason }); // not asked again: the parser answers this sentence
      return parser('rejected');
    }
    const answer = v.answer.nuance && !nuanceFits(v.answer.nuance, uiLang) ? { ...v.answer, nuance: '' } : v.answer;
    if (answer !== v.answer) counts.nuanceDropped = (counts.nuanceDropped ?? 0) + 1;
    await cache.set(key, { answer });
    counts.model++;
    return { source: 'model', answer };
  }

  /** For the admin page: which engine answered how often since the start, and why the parser did. */
  const status = async () => ({ engine, budgetUsd, spentToday: Math.round((await llm.spentToday('grammar')) * 1000) / 1000,
    model: counts.model, parser: { ...counts.parser }, rejects: { ...counts.rejects }, nuanceDropped: counts.nuanceDropped ?? 0 });

  return { explain, status, isShared };
}
