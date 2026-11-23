/** Texts for the reading mode: paragraphs and sentences, a language guess, a title. Pure, no DOM. */

export interface Sentence { i: number; text: string }
export interface Paragraph { sentences: Sentence[] }

/** Longest piece read aloud or parsed at once; longer sentences are cut at a comma or space. */
export const MAX_SENTENCE = 400;

const segmenters = new Map<string, Intl.Segmenter | null>();
function sentenceSegmenter(lang: string): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return null;
  if (!segmenters.has(lang)) {
    let s: Intl.Segmenter | null = null;
    try { s = new Intl.Segmenter(lang, { granularity: 'sentence' }); } catch { try { s = new Intl.Segmenter(undefined, { granularity: 'sentence' }); } catch {} }
    segmenters.set(lang, s);
  }
  return segmenters.get(lang) ?? null;
}

const FALLBACK = /[^.!?…。！？]+(?:[.!?…。！？]+["'”’»)\]]*|$)\s*/gu;

/** Cuts an over-long sentence at commas (or spaces) into pieces of at most `max` characters. */
export function cutLong(s: string, max = MAX_SENTENCE): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    if (at < max / 3) at = window.lastIndexOf(' ');
    if (at < max / 3) at = max - 1;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** One paragraph's sentences. */
export function sentencesOf(par: string, lang: string): string[] {
  const seg = sentenceSegmenter(lang);
  const raw = seg ? [...seg.segment(par)].map((x) => x.segment) : par.match(FALLBACK) ?? [par];
  const out: string[] = [];
  for (const r of raw) {
    const s = r.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    // A lone closing quote or bracket belongs to the sentence before it.
    if (out.length && /^[\p{P}\s]+$/u.test(s) && !/^[(\[“„«¿¡]/u.test(s)) { out[out.length - 1] += s; continue; }
    out.push(...cutLong(s));
  }
  return out;
}

/**
 * Paragraphs and sentences of a text, numbered through the whole text. Blank lines separate paragraphs; inside a
 * paragraph, short lines (a poem, a dialogue) stay their own paragraph, while long lines that end without
 * punctuation are joined back together (text copied from a PDF breaks lines anywhere).
 */
export function splitText(body: string, lang: string): Paragraph[] {
  const blocks = body.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').split(/\n\s*\n/);
  const pars: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const wrapped = lines.length > 1 && lines.slice(0, -1).filter((l) => l.length > 50 && !/[.!?…:;"”»)]$/.test(l)).length >= (lines.length - 1) / 2;
    if (wrapped) pars.push(lines.join(' '));
    else pars.push(...lines);
  }
  let i = 0;
  return pars.map((p) => ({ sentences: sentencesOf(p, lang).map((text) => ({ i: i++, text })) })).filter((p) => p.sentences.length);
}

export const allSentences = (pars: Paragraph[]): Sentence[] => pars.flatMap((p) => p.sentences);

/** A title from the first line, when the learner gave none. */
export function titleFrom(body: string, max = 60): string {
  const first = body.trim().split('\n')[0]?.trim() ?? '';
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trim()}…`;
}

// ---------------------------------------------------------------------------------------------------------------
// Language guess: the most common little words of each language, plus letters only some languages have.

const STOP: Record<string, string> = {
  nl: 'de het een en van ik je is dat niet op te zijn wat er met voor hij ze maar ook als nog wel naar dit bij om geen heb was',
  en: 'the a an and of to is in it you that he was for on are with as i his they be at this have from or by not but what',
  de: 'der die das und ist nicht ich sie es ein eine zu den mit sich auf dem des für von auch ist sind wir war aber wie noch',
  fr: 'le la les et est un une des du je il elle pas que qui dans pour sur au avec ce se ne vous nous sont mais ou',
  es: 'el la los las y es un una de que en no por con para se su lo como más pero yo está muy del al',
  it: 'il lo la gli le e è un una di che non per con su mi si ma come sono anche del della io questo',
  pt: 'o a os as e é um uma de que não para com se em do da por mais como mas eu está são isso',
  tr: 've bir bu da de ne için ben sen o ama çok gibi daha var yok mi mı ile kadar sonra şey değil her',
  sv: 'och det att är en som på jag har med inte till av för den du han men om så',
  da: 'og det at er en som på jeg har med ikke til af for den du han men om så',
  pl: 'i w nie na się z że to jest do co jak ale tak od po',
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([l, s]) => [l, new Set(s.split(' '))]));
const MARKS: [string, RegExp][] = [['tr', /[ğışİ]/], ['de', /ß/], ['es', /[ñ¿¡]/], ['pl', /[łśźżąę]/], ['pt', /[ãõ]/], ['fr', /[êœ]|ç(?!ı)/]];

/** The language a text is most likely in, from the languages above, or '' when unsure. */
export function guessLang(text: string): string {
  const sample = text.slice(0, 4000).toLocaleLowerCase();
  const words = sample.match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return '';
  const score: Record<string, number> = {};
  for (const w of words) for (const [l, set] of Object.entries(STOPSETS)) if (set.has(w)) score[l] = (score[l] ?? 0) + 1;
  for (const [l, re] of MARKS) if (re.test(sample)) score[l] = (score[l] ?? 0) + Math.max(2, words.length / 25);
  if (/\bij\w/.test(sample) || /\w+ij\b/.test(sample)) score.nl = (score.nl ?? 0) + 1;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return '';
  if (ranked[1] && ranked[0][1] < ranked[1][1] * 1.25) return '';
  return ranked[0][0];
}
