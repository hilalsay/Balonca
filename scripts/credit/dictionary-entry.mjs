// A dictionary entry from the model, checked field by field (build-dictionary.mjs). No side effects, so it can be tested.

const s = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Up to three meanings, each once (the model sometimes repeats one: "onu; onu; o"). */
export const list = (v) => {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  return v.map((x) => s(x, 60)).filter((x) => x && !seen.has(x.toLocaleLowerCase('tr')) && seen.add(x.toLocaleLowerCase('tr'))).slice(0, 3);
};
const POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'numeral', 'article', 'particle', 'name']);

/** Particles of separable verbs. A "separable" verb must start with one: the model also flags komen, doen, maken. */
export const PARTICLES = {
  nl: 'aan af bij binnen buiten dicht door heen in klaar langs los mee na neer om omhoog omver op open over rond samen schoon tegen terecht terug thuis toe uit vast voor voorbij vrij weg'.split(' '),
  de: 'ab an auf aus bei dabei ein empor entgegen fest fort her herein heraus hin hinein los mit nach nieder vor voran vorbei weg weiter zu zurück zusammen'.split(' '),
};
/** True when `lemma` is a particle plus a verb of at least two letters (opbellen, zurückkommen). */
export const looksSeparable = (lemma, lang) =>
  /(en|n|ern|eln)$/.test(lemma) && (PARTICLES[lang] ?? []).some((p) => lemma.startsWith(p) && lemma.length >= p.length + 3);

/** The model's entry, checked field by field. null: not usable. */
export function cleanEntry(e, lang) {
  if (!e || typeof e !== 'object' || e.skip === true) return null;
  const tr = list(e.tr), en = list(e.en);
  if (!tr.length || !en.length) return null;
  const art = s(e.article, 4).toLowerCase();
  const lemma = s(e.lemma, 60), pos = POS.has(s(e.pos, 20).toLowerCase()) ? s(e.pos, 20).toLowerCase() : '';
  return {
    lemma, pos, tr, en,
    example: s(e.example, 160), example_tr: s(e.example_tr, 200),
    ...(pos === 'noun' && (lang === 'nl' && (art === 'de' || art === 'het')) || (lang === 'de' && ['der', 'die', 'das'].includes(art)) ? { article: art } : {}),
    ...(e.separable === true && pos === 'verb' && looksSeparable(lemma.toLocaleLowerCase(lang), lang) ? { separable: true } : {}),
  };
}
