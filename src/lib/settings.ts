export type ThemeSetting = 'auto' | 'light' | 'dark';
export type SubStyle = 'box' | 'outline' | 'shadow' | 'contrast';

export interface Settings {
  theme: ThemeSetting;
  locale: 'tr' | 'en';
  subSize: number; // px, 14-48
  subBg: number; // 0-100
  subStyle: SubStyle;
  subPos: number; // where the subtitles sit on the video: 0 = top, 100 = bottom
  pauseOnSave: boolean;
  autoScroll: boolean;
  hideSecondary: boolean; // blur 2nd+ tracks until clicked
  autoPause: boolean; // pause at the end of every line
  autoSubs: boolean; // a new video gets its own subtitle from YouTube automatically
  autoTranslate: 'ask' | AutoLang; // then: ask which language to translate into, or always use this one
  meaningLang: '' | AutoLang; // language word meanings were last shown in ('' = ask)
  colorWords: boolean; // mark words in subtitles by how well the learner knows them
  mode: '' | 'video' | 'text'; // the way of learning chosen on the home page ('' = not chosen yet)
  fontScale: 'normal' | 'large' | 'xlarge'; // text size of the whole app
  fontAsked: boolean; // the one-time "bigger text?" question was answered
  separateMeaning: boolean; // word meanings in another language than translations (advanced)
  transLang: '' | AutoLang; // the one translation language chosen in Settings ('' = not chosen yet)
  // Reading mode
  readRate: number; // speech speed, 0.5-1.5
  readEngine: 'auto' | 'server' | 'device'; // whose voice reads: Balonca's server, the device, or the best available
  readVoices: Record<string, string>; // the device voice picked per language (voiceURI)
  readSize: number; // text size, px
  readHide: boolean; // listening practice: sentences stay hidden until they have been heard
  readTrans: boolean; // show the translation under every sentence
  readLoop: boolean; // repeat the current sentence instead of going on
  readHint: boolean; // the "how it works" card above a text
}

/** Languages offered for translation and word meanings. */
export const AUTO_LANGS = ['tr', 'en', 'nl'] as const;
export type AutoLang = (typeof AUTO_LANGS)[number];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  locale: 'tr',
  subSize: 26,
  subBg: 55,
  subStyle: 'box',
  subPos: 92,
  pauseOnSave: true,
  autoScroll: true,
  hideSecondary: false,
  autoPause: false,
  autoSubs: true,
  autoTranslate: 'ask',
  meaningLang: '',
  colorWords: true,
  mode: '',
  fontScale: 'normal',
  fontAsked: false,
  separateMeaning: false,
  transLang: '',
  readRate: 1,
  readEngine: 'auto',
  readVoices: {},
  readSize: 20,
  readHide: false,
  readTrans: false,
  readLoop: false,
  readHint: true,
};

const clamp = (n: unknown, lo: number, hi: number, d: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T =>
  (opts as readonly unknown[]).includes(v) ? (v as T) : d;

/** Validates untrusted settings (backup files, old data) and fills gaps with defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(r.theme, ['auto', 'light', 'dark'] as const, d.theme),
    locale: oneOf(r.locale, ['tr', 'en'] as const, d.locale),
    subSize: clamp(r.subSize, 14, 48, d.subSize),
    subBg: clamp(r.subBg, 0, 100, d.subBg),
    subStyle: oneOf(r.subStyle, ['box', 'outline', 'shadow', 'contrast'] as const, d.subStyle),
    subPos: clamp(r.subPos, 0, 100, d.subPos),
    pauseOnSave: bool(r.pauseOnSave, d.pauseOnSave),
    autoScroll: bool(r.autoScroll, d.autoScroll),
    hideSecondary: bool(r.hideSecondary, d.hideSecondary),
    autoPause: bool(r.autoPause, d.autoPause),
    autoSubs: bool(r.autoSubs, d.autoSubs),
    autoTranslate: oneOf(r.autoTranslate, ['ask', ...AUTO_LANGS] as const, d.autoTranslate),
    meaningLang: oneOf(r.meaningLang, ['', ...AUTO_LANGS] as const, d.meaningLang),
    colorWords: bool(r.colorWords, d.colorWords),
    mode: oneOf(r.mode, ['', 'video', 'text'] as const, d.mode),
    fontScale: oneOf(r.fontScale, ['normal', 'large', 'xlarge'] as const, d.fontScale),
    fontAsked: bool(r.fontAsked, d.fontAsked),
    separateMeaning: bool(r.separateMeaning, d.separateMeaning),
    transLang: oneOf(r.transLang, ['', ...AUTO_LANGS] as const, d.transLang),
    readRate: clamp(r.readRate, 0.5, 1.5, d.readRate),
    readEngine: oneOf(r.readEngine, ['auto', 'server', 'device'] as const, d.readEngine),
    readVoices: voices(r.readVoices),
    readSize: clamp(r.readSize, 14, 34, d.readSize),
    readHide: bool(r.readHide, d.readHide),
    readTrans: bool(r.readTrans, d.readTrans),
    readLoop: bool(r.readLoop, d.readLoop),
    readHint: bool(r.readHint, d.readHint),
  };
}

function voices(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [lang, uri] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    if (/^[a-z]{2,3}$/.test(lang) && typeof uri === 'string' && uri.length <= 200) out[lang] = uri;
  }
  return out;
}

/** How much bigger all text gets (root font size). */
export const FONT_SCALES = { normal: 1, large: 1.15, xlarge: 1.3 } as const;

/** The one "translation language" (falls back to what older settings had). */
export const translationLang = (s: Settings): '' | AutoLang => s.transLang || (s.autoTranslate !== 'ask' ? s.autoTranslate : s.meaningLang);

/**
 * Choosing the translation language: subtitles are translated into it (unless "ask every video" is on), and word
 * meanings follow it (unless "meanings in another language" is on). The older two settings stay the ones the rest
 * of the app reads, so every combination is still possible.
 */
export function withTranslationLang(s: Settings, lang: AutoLang): Partial<Settings> {
  // The first choice also switches automatic translation on (good defaults); "ask every video" stays only if it
  // was chosen on purpose later.
  const auto = s.autoTranslate !== 'ask' || !s.transLang;
  return { transLang: lang, ...(auto ? { autoTranslate: lang } : {}), ...(s.separateMeaning ? {} : { meaningLang: lang }) };
}
