export interface Cue {
  start: number; // seconds
  end: number;
  text: string; // plain text only, never HTML
}

export interface Track {
  id: string;
  name: string; // original file name
  lang: string; // language code, e.g. "nl"; the key word bags are grouped by
  label: string; // user-editable display name
  color: string;
  visible: boolean;
  offset: number; // seconds, positive = subtitles appear later
  cues: Cue[];
}

export interface StoredTrack extends Track {
  vid: string; // YouTube video id this track belongs to
}

export interface SavedWord {
  id: string; // `${lang}:${w}`
  w: string; // normalized word
  lang: string;
  ctx: string; // sentence it was saved from
  trans: { lang: string; text: string; edited?: boolean }[]; // the same moment in the other visible tracks (translations); edited: fixed by the learner
  vid?: string;
  doc?: string; // id of the text it was saved from (reading mode); then `t` is the sentence number
  t: number; // seconds into the video
  added: number; // epoch ms
  reps: number;
  ivl: number; // days
  ease: number;
  lapses: number;
  due?: number; // epoch ms; undefined = new card, due now
  meanings?: Record<string, WordMeaning>; // by the language they are explained in ("tr", "en"…)
}

/** What /api/define answers: dictionary senses (Wiktionary) explained in one language, best match first. */
export interface WordMeaning {
  lemma: string; // dictionary form ("graven" for "graaf")
  inContext: string; // what it means in the saved sentence
  senses: { head: string; pos: string; meaning: string; en?: string; example?: string; best?: boolean }[];
  source: 'dictionary' | 'ai'; // 'ai': no dictionary entry, the model guessed
  temporary?: boolean; // the dictionary could not be reached: a stopgap guess, never stored
  edited?: boolean; // inContext was corrected by the learner
  at: number;
}

/** A text the learner reads (reading mode). Sentences are worked out from `body` each time it opens. */
export interface TextDoc {
  id: string;
  title: string;
  lang: string;
  body: string;
  added: number; // epoch ms
  opened: number; // epoch ms, last time it was read
  pos: number; // sentence the learner was at
  done: number; // furthest sentence read aloud or reached (progress)
  trans?: Record<string, (string | null)[]>; // translations per language, one per sentence (null: not yet)
}

export const TRACK_COLORS = ['#ffb020', '#2dd4a7', '#38bdf8', '#ff8fb8', '#a995ff'] as const;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
