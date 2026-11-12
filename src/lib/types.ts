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
  trans: { lang: string; text: string }[]; // the same moment in the other visible tracks (translations)
  vid?: string;
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
  at: number;
}

export const TRACK_COLORS = ['#ffb020', '#2dd4a7', '#38bdf8', '#ff8fb8', '#a995ff'] as const;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
