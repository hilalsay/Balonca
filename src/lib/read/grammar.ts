/**
 * Sentence grammar for learners, worked out from a dependency parse (Universal Dependencies, made by spaCy on the
 * server). The parse says which word depends on which; the rules below turn that into what a learner can use:
 * the sentence in coloured parts (subject, verb, object…) and short notes on what to notice (tense, word order,
 * separable verbs…). The notes are written by hand in the UI's languages (i18n keys `gr.*`); the model never
 * writes grammar explanations, so they are always correct Turkish/English. Pure functions, no DOM.
 */

/** One word as the server's parser describes it. */
export interface UdToken {
  t: string; // the word as written
  ws: boolean; // followed by a space
  pos: string; // UPOS: NOUN, VERB, AUX, PRON…
  dep: string; // relation to its head: nsubj, obj, aux…
  head: number; // index of the head word in the sentence (itself for the root)
  lemma: string;
  morph: string; // "Tense=Past|VerbForm=Fin"
  sep?: boolean; // set by the server: a particle the dictionary confirms as part of a separable verb (markFromDictionary)
  dlemma?: string; // set by the server: the dictionary's lemma of a verb form when it differs from the parser's (doe -> doen)
}

export type Role = 'subject' | 'verb' | 'verbPart' | 'object' | 'indirect' | 'complement' | 'adverbial' | 'link' | 'negation' | 'punct' | 'other';
export type ClauseKind = 'main' | 'sub' | 'relative' | 'coord';
export interface Clause { id: number; kind: ClauseKind; head: number; parent: number }
/** Consecutive words with one role in one clause; `from`/`to` are word indexes (inclusive). */
export interface Chunk { role: Role; clause: number; from: number; to: number; text: string }
export type Tense = 'present' | 'past' | 'perfect' | 'pluperfect' | 'future' | 'conditional' | 'imperfect' | 'presentCont' | 'pastCont';
export type NoteKind = 'tense' | 'imperative' | 'question' | 'whQuestion' | 'inversion' | 'bracket' | 'verbFinal' | 'separable' | 'modal'
  | 'passive' | 'negation' | 'relative' | 'teInf' | 'reflexive' | 'degree' | 'articles';
/** Something to notice. `p` fills the note's text; `tokens` are the words it is about (highlighted). */
export interface Note { kind: NoteKind; clause: number; tokens: number[]; p: Record<string, string> }
export interface Analysis { lang: string; tokens: UdToken[]; clauses: Clause[]; chunks: Chunk[]; notes: Note[] }

// ---------------------------------------------------------------------------------------------------------------
// Word lists per language (lower case). Lemmas from the parser are not always right, so forms are listed too.

const L = (s: string) => s.split(' ');
const PERF_AUX: Record<string, string[]> = { nl: L('hebben zijn'), de: L('haben sein'), en: L('have'), fr: L('avoir être'), es: L('haber'), it: L('avere essere'), pt: L('ter haver') };
const FUT_AUX: Record<string, string[]> = { nl: L('zullen zal zult zullen'), de: L('werden werde wirst wird werdet'), en: L('will shall \'ll') };
const COND: Record<string, string[]> = { nl: L('zou zouden'), de: L('würde würdest würden würdet'), en: L('would \'d') };
const MODALS: Record<string, string[]> = {
  nl: L('kunnen kan kun kunt kon konden moeten moet moest moesten willen wil wilt wou wilde wilden mogen mag mocht mochten hoeven hoef hoeft hoefde'),
  de: L('können kann kannst könnt konnte konnten müssen muss musst musste mussten wollen will willst wollte wollten dürfen darf darfst durfte sollen soll sollst sollte sollten mögen mag möchte möchten'),
  en: L('can could must should may might'),
  fr: L('pouvoir devoir vouloir'),
  es: L('poder deber querer'),
};
const NEG: Record<string, string[]> = {
  nl: L('niet geen nooit niets niemand nergens'),
  de: L('nicht kein keine keinen keinem keiner keines nie niemals nichts niemand'),
  en: L('not n\'t never no nothing nobody'),
  fr: L('ne n\' pas jamais rien personne'),
  es: L('no nunca nada nadie jamás'),
};
const WH: Record<string, string[]> = {
  nl: L('wat wie waar wanneer waarom hoe welk welke hoeveel waarheen waarvandaan'),
  de: L('was wer wen wem wessen wo wann warum wie welche welcher welches welchen woher wohin wieso weshalb'),
  en: L('what who whom whose where when why how which'),
  fr: L('que qu\' qui où quand pourquoi comment quel quelle quels quelles combien'),
  es: L('qué quién quiénes dónde cuándo cómo cuál cuáles cuánto cuánta cuántos cuántas adónde'),
};
const TE: Record<string, string[]> = { nl: ['te'], de: ['zu'], en: ['to'] };
/** Verbs used with a reflexive pronoun (zich haasten, zich herinneren…). Only these make me/je/ons reflexive:
 *  the pronoun alone says nothing ("Ik zie je"). Infinitives, separable ones with their particle (afvragen). */
const REFLEXIVE_VERBS: Record<string, string[]> = {
  nl: L('haasten herinneren vergissen schamen gedragen afvragen bemoeien realiseren verbazen ergeren vervelen verheugen verslapen bevinden verontschuldigen concentreren voelen voorstellen'),
};
/** Reflexive pronoun forms and their person (me/je/ons are also ordinary object pronouns). */
const REFLEXIVE_PRON: Record<string, Record<string, string>> = { nl: { me: '1', je: '2', ons: '1', zich: '3' } };
/** Verb-second languages: the finite verb is the 2nd part of a main clause, and goes last in a subordinate one. */
const V2 = new Set(['nl', 'de']);

/** The names learners meet in their textbooks, per language. */
export const TENSE_NAMES: Record<string, Partial<Record<Tense, string>>> = {
  nl: { present: 'onvoltooid tegenwoordige tijd (o.t.t.)', past: 'onvoltooid verleden tijd (o.v.t.)', perfect: 'voltooid tegenwoordige tijd (v.t.t.)',
    pluperfect: 'voltooid verleden tijd (v.v.t.)', future: 'onvoltooid tegenwoordige toekomende tijd', conditional: 'onvoltooid verleden toekomende tijd' },
  de: { present: 'Präsens', past: 'Präteritum', perfect: 'Perfekt', pluperfect: 'Plusquamperfekt', future: 'Futur I', conditional: 'Konjunktiv II (würde)' },
  en: { present: 'present simple', past: 'past simple', perfect: 'present perfect', pluperfect: 'past perfect', future: 'future simple (will)',
    conditional: 'conditional (would)', presentCont: 'present continuous', pastCont: 'past continuous' },
  fr: { present: 'présent', past: 'passé simple', imperfect: 'imparfait', perfect: 'passé composé', pluperfect: 'plus-que-parfait', future: 'futur simple', conditional: 'conditionnel' },
  es: { present: 'presente', past: 'pretérito indefinido', imperfect: 'pretérito imperfecto', perfect: 'pretérito perfecto', pluperfect: 'pretérito pluscuamperfecto',
    future: 'futuro simple', conditional: 'condicional' },
};

// ---------------------------------------------------------------------------------------------------------------

export const feats = (tok: UdToken): Record<string, string> =>
  Object.fromEntries(tok.morph.split('|').filter((x) => x.includes('=')).map((x) => x.split('=') as [string, string]));
const low = (s: string) => s.toLocaleLowerCase();
const base = (dep: string) => dep.split(':')[0];
const verbal = (tok: UdToken) => tok.pos === 'VERB' || tok.pos === 'AUX';
const finite = (tok: UdToken) => feats(tok).VerbForm === 'Fin' || (!feats(tok).VerbForm && verbal(tok) && !!feats(tok).Tense);
const inList = (list: string[] | undefined, tok: UdToken) => !!list && (list.includes(low(tok.lemma)) || list.includes(low(tok.t)));

/** Words joined as written (spaces where the original had them). */
export const join = (tokens: UdToken[], from: number, to: number) =>
  tokens.slice(from, to + 1).map((x, i, a) => x.t + (i < a.length - 1 && x.ws ? ' ' : '')).join('');

const CLAUSE_DEPS = new Set(['advcl', 'ccomp', 'csubj', 'acl', 'parataxis', 'conj']);

// ---------------------------------------------------------------------------------------------------------------
// Label schemes. The Dutch, French and Spanish parsers speak Universal Dependencies; the English one uses ClearNLP
// labels and the German one TIGER labels (where the finite verb heads the clause). Both are brought to UD here.

const EN: Record<string, string> = {
  nsubjpass: 'nsubj:pass', csubjpass: 'csubj:pass', dobj: 'obj', dative: 'iobj', auxpass: 'aux:pass', agent: 'obl:agent',
  neg: 'advmod', prt: 'compound:prt', relcl: 'acl:relcl', npadvmod: 'advmod', poss: 'nmod:poss', intj: 'discourse',
  quantmod: 'advmod', predet: 'det', preconj: 'cc', meta: 'dep', attr: 'pred', acomp: 'pred', oprd: 'pred',
};
const DE: Record<string, string> = {
  sb: 'nsubj', sbp: 'obl:agent', oa: 'obj', oa2: 'obj', og: 'obj', da: 'iobj', ng: 'advmod', svp: 'compound:prt', cp: 'mark',
  rc: 'acl:relcl', cj: 'conj', cd: 'cc', ju: 'cc', ep: 'expl', par: 'parataxis', app: 'appos', pg: 'nmod', ag: 'nmod',
  mnr: 'nmod', avc: 'advmod', dm: 'discourse', ph: 'expl', cvc: 'obl', uc: 'flat', adc: 'amod', cm: 'mark', cc: 'obl',
  vo: 'vocative', nmc: 'nummod', op: 'obl', pnc: 'flat', ac: 'case', pd: 'pred', re: 'dep', rs: 'dep', dh: 'dep', sp: 'nsubj', ams: 'obl',
};
const DE_COPULA = L('sein werden bleiben');

/** A copy of the parse in UD labels (and, for German, UD structure: the main verb heads, auxiliaries hang from it). */
export function toUD(input: UdToken[], lang: string): UdToken[] {
  const tokens = input.map((x) => ({ ...x }));
  if (lang === 'en') {
    tokens.forEach((x) => {
      if (x.dep === 'prep') x.dep = verbal(tokens[x.head] ?? x) ? 'obl' : 'nmod';
      else if (x.dep === 'aux' && x.pos === 'PART' && low(x.t) === 'to') x.dep = 'mark'; // infinitive "to", as Dutch "te"
      else x.dep = EN[x.dep] ?? x.dep;
    });
  }
  if (lang === 'de') {
    const isFin = (x: UdToken) => feats(x).VerbForm === 'Fin';
    tokens.forEach((x, i) => {
      const hasCp = tokens.some((k, j) => j !== i && k.head === i && k.dep === 'cp');
      if (x.dep === 'mo') x.dep = verbal(x) && (isFin(x) || hasCp) ? 'advcl' : ['ADP', 'NOUN', 'PROPN', 'PRON'].includes(x.pos) ? 'obl' : 'advmod';
      else if (x.dep === 'oc') x.dep = verbal(x) && !isFin(x) && !hasCp && verbal(tokens[x.head] ?? x) ? 'vc' : 'ccomp';
      else if (x.dep === 'nk') x.dep = x.pos === 'DET' ? 'det' : x.pos === 'ADJ' ? 'amod' : 'nmod';
      else x.dep = DE[x.dep] ?? x.dep;
    });
    // `child` takes over the place of `h` in the tree; `h` hangs from it as `as`.
    const promote = (child: number, h: number, as: string) => {
      const c = tokens[child], H = tokens[h], root = H.head === h || H.dep === 'ROOT';
      c.dep = H.dep; c.head = root ? child : H.head;
      H.dep = as; H.head = child;
      tokens.forEach((x, i) => { if (i !== child && i !== h && x.head === h) x.head = child; });
    };
    for (let guard = 0; guard < tokens.length; guard++) {
      const v = tokens.findIndex((x) => x.dep === 'vc');
      if (v < 0) break;
      const h = tokens[v].head;
      promote(v, h, low(tokens[h].lemma) === 'werden' && feats(tokens[v]).VerbForm === 'Part' ? 'aux:pass' : 'aux');
    }
    for (let guard = 0; guard < tokens.length; guard++) {
      const p = tokens.findIndex((x, i) => x.dep === 'pred' && !verbal(x) && tokens[x.head] && x.head !== i && verbal(tokens[x.head]) && DE_COPULA.includes(low(tokens[x.head].lemma)));
      if (p < 0) break;
      promote(p, tokens[p].head, 'cop');
    }
  }
  return tokens;
}

/** The grammar of one parsed sentence. */
export function analyze(parsed: UdToken[], lang: string): Analysis {
  const tokens = toUD(parsed, lang);
  const n = tokens.length;
  const kids: number[][] = tokens.map(() => []);
  tokens.forEach((x, i) => { if (x.head !== i && x.head >= 0 && x.head < n) kids[x.head].push(i); });
  const isRoot = (i: number) => tokens[i].head === i || tokens[i].dep === 'ROOT' || tokens[i].head < 0 || tokens[i].head >= n;
  const kidDeps = (i: number) => kids[i].map((k) => tokens[k].dep);

  // 1. Clauses: the root, and dependents that are clauses of their own (with a verb, or a subject/copula).
  const clauseOfHead = new Map<number, number>();
  const clauses: Clause[] = [];
  const isClauseHead = (i: number): ClauseKind | null => {
    if (isRoot(i)) return 'main';
    const x = tokens[i], d = base(x.dep);
    if (!CLAUSE_DEPS.has(d)) return null;
    const ownSubject = kidDeps(i).some((k) => base(k) === 'nsubj');
    const withVerb = verbal(x) || kidDeps(i).some((k) => k === 'cop' || base(k) === 'aux');
    if (!withVerb && !ownSubject) return null; // "dan dat huis": a phrase, not a clause
    if (d === 'conj') return verbal(x) && (ownSubject || finite(x)) ? 'coord' : null;
    return d === 'acl' ? 'relative' : d === 'parataxis' ? 'coord' : 'sub';
  };
  const kinds = tokens.map((_, i) => isClauseHead(i));
  /** Nearest clause head or xcomp head (an infinitive belonging to its parent's clause) at or above `i`. */
  const headOf = (i: number): number => {
    let j = i;
    for (let guard = 0; guard < n; guard++) {
      if (kinds[j] || tokens[j].dep === 'xcomp') return j;
      if (isRoot(j)) return j;
      j = tokens[j].head;
    }
    return i;
  };
  const clauseOf = (h: number): number => {
    // xcomp heads live in the clause of the verb they complete
    let j = h;
    for (let guard = 0; guard < n && !kinds[j] && !isRoot(j); guard++) j = headOf(tokens[j].head);
    if (!clauseOfHead.has(j)) {
      const parentHead = isRoot(j) ? -1 : headOf(tokens[j].head);
      const parent = parentHead < 0 ? -1 : clauseOf(parentHead);
      clauseOfHead.set(j, clauses.length);
      clauses.push({ id: clauses.length, kind: kinds[j] ?? 'main', head: j, parent });
    }
    return clauseOfHead.get(j)!;
  };

  // 2. Every word gets a clause and a role, decided by how it hangs from its clause's verb.
  const negList = NEG[lang];
  const clauseIdx: number[] = [], role: Role[] = [], part: number[] = [];
  for (let i = 0; i < n; i++) {
    const H = headOf(i);
    clauseIdx[i] = clauseOf(H);
    let c = i; // the word right under H on the way up from i: the part of the clause this word belongs to
    let below = i; // the word just under c on that way
    while (c !== H && tokens[c].head !== H && !isRoot(c)) { below = c; c = tokens[c].head; }
    // Some parsers hang a word from the auxiliary ("Gisteren" under "heb"): treat it as hanging from the verb.
    if (c !== i && (base(tokens[c].dep) === 'aux' || tokens[c].dep === 'cop')) c = below;
    part[i] = c;
    const x = tokens[i];
    if (x.pos === 'PUNCT') { role[i] = 'punct'; continue; }
    if (inList(negList, x) && (x.pos === 'ADV' || x.pos === 'PART' || x.pos === 'DET' || x.pos === 'PRON' && low(x.t) !== 'no')) { role[i] = 'negation'; continue; }
    if (i === H) {
      const xcomp = tokens[H].dep === 'xcomp';
      if (verbal(x)) role[i] = finite(x) && !xcomp ? 'verb' : 'verbPart';
      else if (!kidDeps(H).includes('cop') && kids[H].some((k) => verbal(tokens[k]) && finite(tokens[k])) && x.pos === 'ADJ') role[i] = 'verbPart'; // misparsed infinitive
      else role[i] = 'complement';
      continue;
    }
    const d = tokens[c].dep, b = base(d);
    if (c !== i && (b === 'aux' || d === 'cop')) { role[i] = 'other'; continue; }
    if (b === 'nsubj' || b === 'csubj' || (b === 'expl' && d !== 'expl:pv')) role[i] = 'subject';
    else if (d === 'pred') role[i] = 'complement';
    else if (b === 'obj') role[i] = 'object';
    else if (b === 'iobj') role[i] = kids[H].some((k) => base(tokens[k].dep) === 'obj') && !reflexiveOf(tokens, kids, i, lang) ? 'indirect' : 'object';
    else if (d === 'expl:pv') role[i] = 'object';
    else if (b === 'aux' || d === 'cop') role[i] = finite(x) ? 'verb' : 'verbPart';
    else if (d === 'compound:prt') role[i] = isParticle(x) ? 'verbPart' : 'adverbial';
    else if ((b === 'mark' || b === 'cc') && verbal(x) && c === i) role[i] = finite(x) ? 'verb' : 'verbPart'; // "Kun je…": a verb taken for a conjunction
    else if (b === 'mark' || b === 'cc') role[i] = 'link';
    else if (b === 'obl' || b === 'advmod' || b === 'nmod' && verbal(tokens[H]) || b === 'npadvmod' || b === 'advcl' || d === 'obl:agent') role[i] = 'adverbial';
    else if (!verbal(tokens[H]) && tokens[H].dep !== 'xcomp') role[i] = 'complement'; // "mijn" in "is mijn vader"
    else role[i] = inList(WH[lang], x) && c === i ? 'adverbial' : 'other';
  }
  // A finite clause without a subject but with an "object" before its verb: the parser mixed them up ("en de hond slaapt").
  for (const [h, cl] of clauseOfHead) {
    void cl;
    const ws = tokens.map((_, i) => i).filter((i) => clauseIdx[i] === clauseOfHead.get(h));
    const fin = ws.find((i) => role[i] === 'verb');
    if (fin === undefined || ws.some((i) => role[i] === 'subject') || kinds[h] === 'main' && fin === ws.find((i) => role[i] !== 'punct')) continue;
    const objs = ws.filter((i) => role[i] === 'object' && i < fin && part[i] === part[ws.find((j) => role[j] === 'object' && j < fin)!]);
    if (objs.length && tokens[part[objs[0]]].pos !== 'PRON') for (const i of objs) role[i] = 'subject';
  }

  // 3. Chunks: runs of words in the same clause, role and part (verbs and links run together).
  const chunks: Chunk[] = [];
  for (let i = 0; i < n; i++) {
    const key = (j: number) => `${clauseIdx[j]}|${role[j]}|${['verb', 'verbPart', 'link', 'punct', 'negation', 'complement'].includes(role[j]) ? '' : part[j]}`;
    const last = chunks[chunks.length - 1];
    if (last && last.to === i - 1 && key(last.from) === key(i) && role[i] !== 'punct') { last.to = i; last.text = join(tokens, last.from, i); }
    else chunks.push({ role: role[i], clause: clauseIdx[i], from: i, to: i, text: tokens[i].t });
  }

  const a: Analysis = { lang, tokens, clauses, chunks, notes: [] };
  a.notes = notesFor(a, { clauseIdx, role, kids });
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// Notes

interface Ctx { clauseIdx: number[]; role: Role[]; kids: number[][] }

function notesFor(a: Analysis, cx: Ctx): Note[] {
  const { tokens, lang } = a;
  const notes: Note[] = [];
  const add = (kind: NoteKind, clause: number, toks: number[], p: Record<string, string> = {}) => notes.push({ kind, clause, tokens: toks, p });
  const words = (c: number) => tokens.map((_, i) => i).filter((i) => cx.clauseIdx[i] === c);
  const text = (idx: number[]) => idx.map((i) => tokens[i].t).join(' … ');
  const lastWord = [...tokens].reverse().find((x) => x.pos !== 'PUNCT');
  const endsWith = (ch: string) => tokens.some((x) => x.pos === 'PUNCT' && x.t.includes(ch)) && (tokens[tokens.length - 1]?.t.includes(ch) ?? false);
  const question = endsWith('?') || tokens[0]?.t === '¿';
  void lastWord;

  const main = a.clauses.find((c) => c.kind === 'main')?.id ?? 0;
  const mainWords = words(main);
  const firstWord = mainWords.find((i) => cx.role[i] !== 'punct' && !(i === 0 && tokens[i].t === '¿'));
  const hasSubject = (c: number) => words(c).some((i) => cx.role[i] === 'subject');
  // The subject is a whole clause, so the verb that comes first is no command: "Toen …, bleek dat iemand …"
  // (a clause hanging from the verb as subject), "Wie niet werkt, zal …", "Wat ik niet begrijp, is …" (a clause in
  // front that starts with a question or relative word and no conjunction; the parser may hang it anywhere).
  const clauseSubject = () => {
    const head = a.clauses[main]?.head;
    if (head !== undefined && cx.kids[head].some((k) => base(tokens[k].dep) === 'csubj')) return true;
    const s = tokens.findIndex((_, i) => cx.role[i] !== 'punct');
    return firstWord !== undefined && s >= 0 && s < firstWord && cx.clauseIdx[s] !== main && cx.role[s] !== 'link'
      && (inList(WH[lang], tokens[s]) || ['Int', 'Rel'].includes(feats(tokens[s]).PronType));
  };

  // Questions and commands (main clause)
  let mood: 'question' | 'wh' | 'imperative' | null = null;
  if (firstWord !== undefined) {
    const f = tokens[firstWord];
    const wh = inList(WH[lang], f) || feats(f).PronType === 'Int';
    if (question && wh) { mood = 'wh'; const v = mainWords.find((i) => cx.role[i] === 'verb'); add('whQuestion', main, [firstWord, ...(v !== undefined ? [v] : [])], { wh: f.t, verb: v !== undefined ? tokens[v].t : '' }); }
    else if (question && verbal(f) && finite(f)) { mood = 'question'; add('question', main, [firstWord], { verb: f.t }); }
    else if (!question && verbal(f) && !clauseSubject() && (feats(f).Mood === 'Imp' || (!hasSubject(main) && (finite(f) || (lang === 'en' && feats(f).VerbForm === 'Inf'))))) {
      mood = 'imperative'; add('imperative', main, [firstWord], { verb: f.t });
    }
  }

  for (const cl of a.clauses) {
    const ws = words(cl.id);
    // A clause head the parser took for an adjective but that works as the verb ("dichtdoen") counts as an infinitive.
    const odd = (i: number) => i === cl.head && cx.role[i] === 'verbPart' && !verbal(tokens[i]);
    const verbs = ws.filter((i) => (cx.role[i] === 'verb' || cx.role[i] === 'verbPart') && (verbal(tokens[i]) || odd(i)));
    const fin = verbs.find((i) => finite(tokens[i]));
    const auxes = ws.filter((i) => base(tokens[i].dep) === 'aux');
    const parts = verbs.filter((i) => feats(tokens[i]).VerbForm === 'Part' && feats(tokens[i]).Tense !== 'Pres' && feats(tokens[i]).Aspect !== 'Prog');
    const part = parts.find((i) => base(tokens[i].dep) !== 'aux') ?? parts[0];
    const ger = verbs.find((i) => feats(tokens[i]).VerbForm === 'Ger' || feats(tokens[i]).Aspect === 'Prog');
    const inf = verbs.find((i) => (feats(tokens[i]).VerbForm === 'Inf' || odd(i)) && i !== fin);
    const passAux = ws.find((i) => tokens[i].dep === 'aux:pass' || (lang === 'es' && base(tokens[i].dep) === 'aux' && low(tokens[i].lemma) === 'ser' && part !== undefined));

    // Tense (not for a command)
    if (fin !== undefined && !(cl.id === main && mood === 'imperative')) {
      const F = tokens[fin], ff = feats(F);
      let tense: Tense = ff.Tense === 'Past' ? 'past' : ff.Tense === 'Imp' ? 'imperfect' : ff.Tense === 'Fut' ? 'future' : 'present';
      const used = [fin];
      const perfAux = auxes.find((i) => i !== passAux && inList(PERF_AUX[lang], tokens[i]));
      if (ff.Mood === 'Cnd' || inList(COND[lang], F) && inf !== undefined) { tense = 'conditional'; if (inf !== undefined) used.push(inf); }
      else if (inList(FUT_AUX[lang], F) && inf !== undefined && passAux === undefined) { tense = 'future'; used.push(inf); }
      else if (perfAux !== undefined && part !== undefined) { tense = feats(tokens[perfAux]).Tense === 'Past' || feats(tokens[perfAux]).Tense === 'Imp' ? 'pluperfect' : 'perfect'; used.push(part); }
      else if (lang === 'en' && ger !== undefined && inList(['be'], F)) { tense = ff.Tense === 'Past' ? 'pastCont' : 'presentCont'; used.push(ger); }
      else if (lang === 'en' && inList(['do'], F) && inf !== undefined) used.push(inf); // do-support: "do … know"
      const perf = tense === 'perfect' || tense === 'pluperfect';
      add('tense', cl.id, [...new Set(used)].sort((x, y) => x - y), {
        tense, name: TENSE_NAMES[lang]?.[tense] ?? '', verbs: text([...new Set(used)].sort((x, y) => x - y)),
        aux: perf && perfAux !== undefined ? low(tokens[perfAux].lemma) : '',
      });
      // A modal verb with an infinitive
      if (inList(MODALS[lang], F) && inf !== undefined) add('modal', cl.id, [fin, inf], { modal: F.t, verb: tokens[inf].t });
    }
    if (passAux !== undefined && part !== undefined) {
      const agent = ws.find((i) => tokens[i].dep === 'obl:agent');
      add('passive', cl.id, [passAux, part], { aux: tokens[passAux].t, part: tokens[part].t, agent: agent !== undefined ? tokens[agent].t : '' });
    }

    // Word order of verb-second languages
    if (V2.has(lang) && fin !== undefined) {
      // The clause as a sequence of parts; a whole subordinate clause in front counts as one part.
      const seq: { role: Role | 'clause'; from: number; to: number; text: string }[] = [];
      for (const ch of a.chunks) {
        if (ch.role === 'punct') continue;
        const mine = ch.clause === cl.id;
        const inner = !mine && isInside(a.clauses, ch.clause, cl.id);
        if (!mine && !inner) continue;
        const last = seq[seq.length - 1];
        if (inner) { if (last?.role === 'clause' && last.to < ch.from) { last.to = ch.to; last.text = join(tokens, last.from, ch.to); } else seq.push({ role: 'clause', from: ch.from, to: ch.to, text: join(tokens, ch.from, ch.to) }); }
        else seq.push({ role: ch.role, from: ch.from, to: ch.to, text: ch.text });
      }
      const body = seq.filter((s, i) => !(i === 0 && s.role === 'link'));
      if (cl.kind === 'main' || cl.kind === 'coord') {
        const vi = body.findIndex((s) => s.role === 'verb' && s.from <= fin && fin <= s.to);
        const si = body.findIndex((s) => s.role === 'subject');
        if (!mood && vi === 1 && si > vi && body[0].role !== 'subject') {
          add('inversion', cl.id, [fin, ...range(body[si].from, body[si].to)], { first: body[0].text, verb: tokens[fin].t, subject: body[si].text });
        }
        // Verb bracket: finite verb early, the rest of the verb at the end
        const restIdx = verbs.filter((i) => i > fin && cx.role[i] === 'verbPart' && !cx.kids[i].some((k) => tokens[k].dep === 'mark' && inList(TE[lang], tokens[k])));
        if (vi >= 0 && restIdx.length && body.slice(vi + 1).some((s) => s.role !== 'verbPart' && s.role !== 'verb' && s.from < restIdx[0])) {
          add('bracket', cl.id, [fin, ...restIdx], { verb: tokens[fin].t, rest: restIdx.map((i) => tokens[i].t).join(' ') });
        }
      } else if (cl.kind === 'sub' || cl.kind === 'relative') {
        const after = ws.filter((i) => i > fin && cx.role[i] !== 'punct');
        const before = ws.filter((i) => i < fin && cx.role[i] !== 'punct' && cx.role[i] !== 'link');
        if (before.length > 1 && after.every((i) => cx.role[i] === 'verb' || cx.role[i] === 'verbPart')) {
          const link = ws.find((i) => cx.role[i] === 'link' || feats(tokens[i]).PronType === 'Rel');
          add('verbFinal', cl.id, [fin], { verb: tokens[fin].t, link: link !== undefined ? tokens[link].t : '' });
        }
      }
      // Separable verbs: the particle is split off and stands at the end
      for (const i of ws) {
        const x = tokens[i];
        if (x.dep === 'compound:prt' && isParticle(x) && x.head < i) add('separable', cl.id, [x.head, i], { verb: tokens[x.head].t, prt: x.t });
      }
    }

    // Relative clause
    if (cl.kind === 'relative') {
      const pron = ws.find((i) => feats(tokens[i]).PronType === 'Rel') ?? ws.find((i) => cx.role[i] !== 'punct');
      const noun = tokens[cl.head].head;
      if (pron !== undefined && noun !== cl.head) add('relative', cl.id, [pron, noun], { pron: tokens[pron].t, noun: tokens[noun].t });
    }
    // te/zu/to + infinitive: completing a verb (xcomp), or as a clause of its own ("om … te", "to play" = in order to)
    for (const i of ws) {
      if (tokens[i].dep !== 'xcomp' && !(verbal(tokens[i]) && feats(tokens[i]).VerbForm === 'Inf')) continue;
      const te = cx.kids[i].find((k) => tokens[k].dep === 'mark' && inList(TE[lang], tokens[k]));
      if (te !== undefined) add('teInf', cl.id, [te, i], { te: tokens[te].t, verb: tokens[i].t, main: tokens[tokens[i].head].t });
    }
  }

  // Whole sentence: negation, reflexive verbs, comparison, articles
  const neg = tokens.findIndex((x, i) => cx.role[i] === 'negation');
  if (neg >= 0) {
    const w = low(tokens[neg].t);
    const kind = lang === 'nl' ? (w === 'geen' ? 'nl.geen' : 'nl.niet') : lang === 'de' ? (w.startsWith('kein') ? 'de.kein' : 'de.nicht') : ['en', 'fr', 'es'].includes(lang) ? lang : 'any';
    const pair = lang === 'fr' ? tokens.findIndex((x, i) => i > neg && inList(NEG.fr, x) && low(x.t) !== 'ne' && low(x.t) !== 'n\'') : -1;
    add('negation', cx.clauseIdx[neg], pair >= 0 ? [neg, pair] : [neg], { word: pair >= 0 ? `${tokens[neg].t} … ${tokens[pair].t}` : tokens[neg].t, kind });
  }
  tokens.forEach((x, i) => {
    const f = feats(x);
    if ((f.Reflex === 'Yes' && x.pos === 'PRON' && verbal(tokens[x.head])) || reflexiveOf(tokens, cx.kids, i, lang)) add('reflexive', cx.clauseIdx[i], [i, x.head], { pron: x.t, verb: tokens[x.head].t });
    if ((x.pos === 'ADJ' || x.pos === 'ADV') && (f.Degree === 'Cmp' || f.Degree === 'Sup')) add('degree', cx.clauseIdx[i], [i], { word: x.t, base: x.lemma, kind: f.Degree === 'Cmp' ? 'cmp' : 'sup' });
  });
  if (lang === 'nl' || lang === 'de') {
    const groups: Record<string, string[]> = {};
    const idx: number[] = [];
    tokens.forEach((x, i) => {
      const f = feats(x);
      if (x.pos !== 'NOUN' || f.Number === 'Plur' || !f.Gender) return;
      const art = lang === 'nl' ? (f.Gender === 'Neut' ? 'het' : 'de') : ({ Masc: 'der', Fem: 'die', Neut: 'das' } as Record<string, string>)[f.Gender];
      if (!art) return;
      const word = lang === 'de' ? x.t : low(x.t);
      if (!(groups[art] ??= []).includes(word)) { groups[art].push(word); idx.push(i); }
    });
    if (idx.length) add('articles', main, idx, Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.join(', ')])));
  }

  // One tense note per tense: "weet · komt · is" rather than three notes saying the same.
  for (let i = 0; i < notes.length; i++) {
    const a1 = notes[i];
    if (a1.kind !== 'tense') continue;
    for (let j = notes.length - 1; j > i; j--) {
      const b1 = notes[j];
      if (b1.kind === 'tense' && b1.p.tense === a1.p.tense && b1.p.aux === a1.p.aux) {
        a1.p.verbs += ` · ${b1.p.verbs}`; a1.tokens.push(...b1.tokens); notes.splice(j, 1);
      }
    }
  }

  // One note per rule: a second "inversion" says nothing new; its words are lit up with the first one.
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].kind === 'tense') continue;
    for (let j = notes.length - 1; j > i; j--) {
      if (notes[j].kind === notes[i].kind && notes[j].kind !== 'separable') { notes[i].tokens.push(...notes[j].tokens); notes.splice(j, 1); }
    }
  }

  const ORDER: NoteKind[] = ['question', 'whQuestion', 'imperative', 'tense', 'inversion', 'bracket', 'verbFinal', 'separable', 'modal', 'passive', 'teInf', 'relative', 'negation', 'reflexive', 'degree', 'articles'];
  return notes.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.clause - y.clause);
}

/** A separable verb's particle: a preposition or particle (op, aan), or another word (terug, dicht, mee) when the
 *  server has confirmed the verb in the dictionary (`sep`). */
const isParticle = (x: UdToken) => x.pos === 'ADP' || x.pos === 'PART' || x.sep === true;

/** With a particle in front unless it is there already: (op, bellen) -> opbellen. */
const withParticle = (prt: string, lemma: string) => (prt && !lemma.startsWith(prt) ? prt + lemma : lemma);
/** Lemmas of a verb: the parser's (lower case) and the dictionary's when the server added one ("Herinner" -> herinneren). */
const lemmasOf = (x: UdToken) => [...new Set([low(x.lemma), ...(x.dlemma ? [low(x.dlemma)] : [])])];

/** Possible infinitives of the verb at `v`, with its split-off particle in front (vraag … af -> afvragen). */
function infinitives(tokens: UdToken[], kids: number[][], v: number): string[] {
  const prt = kids[v].map((k) => tokens[k]).find((k) => k.dep === 'compound:prt');
  return lemmasOf(tokens[v]).map((l) => withParticle(prt ? low(prt.t) : '', l));
}

/** True for me/je/ons/zich as the object of a verb from REFLEXIVE_VERBS, in the same person as its subject
 *  ("Ik kan me … herinneren", but not "Ik herinner je aan …"). */
function reflexiveOf(tokens: UdToken[], kids: number[][], i: number, lang: string): boolean {
  const x = tokens[i], person = REFLEXIVE_PRON[lang]?.[low(x.t)], v = x.head;
  if (!person || x.pos !== 'PRON' || !['obj', 'iobj', 'expl'].includes(base(x.dep)) || !tokens[v] || !verbal(tokens[v])) return false;
  if (!infinitives(tokens, kids, v).some((inf) => REFLEXIVE_VERBS[lang]?.includes(inf))) return false;
  const subj = kids[v].map((k) => tokens[k]).find((k) => base(k.dep) === 'nsubj');
  const sp = subj && feats(subj).Person;
  return !sp || sp === person;
}

/** What the server's dictionary says about a lower-case word form (the phase 3b `dictionary` table). */
export interface DictEntry { lemma?: string; pos?: string; separable?: boolean }

/**
 * Adds what the dictionary knows to a parse, on the server (which has the dictionary):
 * - `dlemma` on a verb whose dictionary lemma differs from the parser's (doe -> doen, Herinner -> herinneren). It is
 *   an extra candidate: the parser's lemma stays, so a wrong dictionary lemma cannot remove a right one.
 * - `sep` on a particle the parser does not call ADP/PART (terug, dicht, mee) when particle + verb is listed as separable.
 */
export function markFromDictionary(parsed: UdToken[], lang: string, lookup: (form: string) => DictEntry | null | undefined): UdToken[] {
  if (lang !== 'nl' && lang !== 'de') return parsed;
  const prtDep = lang === 'de' ? 'svp' : 'compound:prt';
  const toks = parsed.map((x) => {
    if (!verbal(x)) return x;
    const e = lookup(low(x.t));
    const dl = e?.pos === 'verb' && typeof e.lemma === 'string' ? low(e.lemma) : '';
    return dl && dl !== low(x.lemma) ? { ...x, dlemma: dl } : x;
  });
  return toks.map((x) => {
    const v = toks[x.head];
    if (x.dep !== prtDep || x.pos === 'ADP' || x.pos === 'PART' || !v || !verbal(v)) return x;
    return lemmasOf(v).some((l) => lookup(withParticle(low(x.t), l))?.separable === true) ? { ...x, sep: true } : x;
  });
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** True when clause `c` sits (at any depth) inside clause `outer`. */
function isInside(clauses: Clause[], c: number, outer: number): boolean {
  for (let p = clauses[c]?.parent ?? -1, guard = 0; p >= 0 && guard < clauses.length; p = clauses[p].parent, guard++) if (p === outer) return true;
  return false;
}
