import { DEFAULT_SETTINGS, type Settings } from './settings';
import { TRACK_COLORS, uid, type SavedWord, type StoredTrack, type TextDoc, type WordMeaning } from './types';
import { openBalonca, loadSettings, saveSettings, loadWords, loadKnown, saveKnown, type KnownWords, putWord, deleteWord, deleteLanguage, loadTracks, saveTracks,
  getLastVideo, setLastVideo, exportBackup, parseBackup, importBackup, loadTexts, putText, deleteText, TEXT_LIMIT, type Db } from './storage';
import { parseSubtitles } from './subtitles';
import { detectLangFromFilename } from './languages';
import { makeWord, toggleWord, wordId } from './words/bags';
import { lineAt, translateSentence } from './words/sentence';
import { schedule, LEARNED_DAYS, type Grade } from './srs/scheduler';
import { setLocale } from './i18n/index.svelte';
import { loadExample, exampleFileUrl } from './example';
import { theme, applyTheme } from './theme.svelte';

const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let h: ReturnType<typeof setTimeout>;
  return (...a: A) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
};

class AppState {
  ready = $state(false);
  storageOk = $state(true); // false when IndexedDB is unavailable (private mode etc.): app still works, nothing persists
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  words = $state<SavedWord[]>([]);
  vid = $state<string | null>(null);
  tracks = $state<StoredTrack[]>([]);
  savedIds = $derived(new Set(this.words.map((w) => w.id)));
  wordById = $derived(new Map(this.words.map((w) => [w.id, w])));
  /** Words marked "I know this", per language. */
  known = $state<KnownWords>({});
  knownSets = $derived(new Map(Object.entries(this.known).map(([l, keys]) => [l, new Set(keys)])));
  visibleTracks = $derived(this.tracks.filter((t) => t.visible));
  /** Video id of the installed example, if this machine has one. */
  exampleId = $state<string | null>(null);
  /** Texts of the reading mode, most recently read first. */
  texts = $state<TextDoc[]>([]);
  textById = $derived(new Map(this.texts.map((x) => [x.id, x])));

  private db: Db | null = null;
  private persistTracks = debounce(() => {
    if (this.db && this.vid) void saveTracks(this.db, this.vid, $state.snapshot(this.tracks) as StoredTrack[]);
  }, 400);
  private persistKnown = debounce(() => {
    if (this.db) void saveKnown(this.db, $state.snapshot(this.known) as KnownWords);
  }, 400);
  private dirtyTexts = new Set<string>();
  private persistTexts = debounce(() => {
    const ids = [...this.dirtyTexts];
    this.dirtyTexts.clear();
    if (!this.db) return;
    for (const id of ids) { const x = this.textById.get(id); if (x) void putText(this.db, $state.snapshot(x) as TextDoc); }
  }, 500);
  private persistSettings = debounce(() => {
    if (this.db) void saveSettings(this.db, $state.snapshot(this.settings) as Settings);
  }, 300);

  async init(): Promise<void> {
    void loadExample().then((ex) => (this.exampleId = ex?.videoId ?? null));
    try {
      this.db = await openBalonca();
      this.settings = await loadSettings(this.db);
      this.words = await loadWords(this.db);
      this.known = await loadKnown(this.db);
      this.texts = sortTexts(await loadTexts(this.db));
      this.applySettings(false);
      const last = await getLastVideo(this.db);
      if (last) await this.openVideo(last);
    } catch {
      this.storageOk = false;
    }
    this.ready = true;
  }

  /** Mirrors theme/locale to the UI modules; `persist` is false while loading. */
  private applySettings(persist: boolean) {
    theme.value = this.settings.theme;
    applyTheme();
    setLocale(this.settings.locale);
    if (persist) this.persistSettings();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    if (key === 'theme' || key === 'locale') this.applySettings(true);
    else this.persistSettings();
  }

  async openVideo(id: string) {
    if (this.vid === id) return;
    this.vid = id;
    this.tracks = this.db ? await loadTracks(this.db, id) : [];
    if (this.db) await setLastVideo(this.db, id);
  }

  /**
   * Gives the example video its installed subtitles, once per browser: if the user later removes them they stay
   * removed. Silent on failure (offline, blocked): the example just opens without subtitles.
   */
  async seedExample() {
    const ex = await loadExample();
    if (!ex || this.vid !== ex.videoId || this.tracks.length) return;
    if (this.db && (await this.db.get('meta', 'exampleSeeded'))) return;
    let added = 0;
    try {
      for (const sub of ex.subtitles) {
        const res = await fetch(exampleFileUrl(sub.file));
        if (!res.ok) continue;
        const text = await res.text();
        if (this.vid !== ex.videoId) return; // the user moved on
        this.addTrack(text, sub.file, sub.lang);
        added++;
      }
    } catch {}
    if (added && this.db) await this.db.put('meta', true, 'exampleSeeded');
  }

  /** Parses subtitle text into a new track. Throws SubtitleParseError on bad input. */
  addTrack(text: string, name: string, hintLang?: string) {
    const res = parseSubtitles(text);
    const lang = hintLang || detectLangFromFilename(name) || '??';
    const track: StoredTrack = {
      id: uid(), vid: this.vid ?? '', name, lang, label: lang === '??' ? name.replace(/\.[^.]+$/, '') : '',
      color: TRACK_COLORS[this.tracks.length % TRACK_COLORS.length], visible: true, offset: 0, cues: res.cues,
    };
    this.tracks.push(track);
    this.persistTracks();
    return { track, result: res };
  }

  /** Adds an already-parsed track (e.g. the result of a translation). */
  addCues(cues: StoredTrack['cues'], name: string, lang: string) {
    const track: StoredTrack = {
      id: uid(), vid: this.vid ?? '', name, lang, label: '',
      color: TRACK_COLORS[this.tracks.length % TRACK_COLORS.length], visible: true, offset: 0, cues,
    };
    this.tracks.push(track);
    this.persistTracks();
    return track;
  }

  /** Appends cues to a track (streamed translation). Cues must come in time order. */
  appendCues(id: string, cues: StoredTrack['cues']) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.cues.push(...cues);
    this.persistTracks();
  }

  renameTrack(id: string, name: string) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    t.name = name;
    this.persistTracks();
  }

  updateTrack(id: string, patch: Partial<Pick<StoredTrack, 'label' | 'lang' | 'color' | 'visible' | 'offset'>>) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.persistTracks();
  }

  removeTrack(id: string) {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    this.persistTracks();
  }

  /** Saves the word if new, removes it if already saved. Returns true when it was added. */
  toggleWord(args: { lang: string; word: string; ctx: string; trans?: { lang: string; text: string }[]; t: number; doc?: string }): boolean {
    const w = makeWord({ ...args, vid: args.doc ? undefined : this.vid ?? undefined });
    const { list, added } = toggleWord(this.words, w);
    this.words = list;
    if (this.db) void (added ? putWord(this.db, $state.snapshot(w) as SavedWord) : deleteWord(this.db, w.id));
    return added;
  }

  /** Adds (or replaces) the sentence's translation in one language. */
  setTrans(id: string, lang: string, text: string) {
    const w = this.words.find((x) => x.id === id);
    if (!w || !text) return;
    w.trans = [...w.trans.filter((x) => x.lang !== lang), { lang, text }];
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
  }

  /** The saved sentence in `lang` from the video's own subtitles or the text's translation (no server); stores and returns it when found. */
  async transFromTracks(word: SavedWord, lang: string): Promise<string | null> {
    if (word.doc) {
      const text = this.textById.get(word.doc)?.trans?.[lang]?.[word.t] ?? null;
      if (text) this.setTrans(word.id, lang, text);
      return text;
    }
    if (!word.vid) return null;
    const tracks = word.vid === this.vid ? this.tracks : this.db ? await loadTracks(this.db, word.vid) : [];
    const text = lineAt(tracks as StoredTrack[], lang, word.t);
    if (text) this.setTrans(word.id, lang, text);
    return text;
  }

  /** The saved sentence in `lang`: from the video's subtitles if they have it, else translated by the server. */
  async translateWordSentence(word: SavedWord, lang: string, signal?: AbortSignal): Promise<string> {
    const local = await this.transFromTracks(word, lang);
    if (local) return local;
    const text = await translateSentence({ text: word.ctx, from: word.lang, to: lang, signal });
    this.setTrans(word.id, lang, text);
    return text;
  }

  /** The learner's own correction of a word's meaning and/or the sentence translation in `lang` (empty = leave as is). */
  fixWord(id: string, lang: string, fix: { meaning?: string; trans?: string }) {
    const w = this.words.find((x) => x.id === id);
    if (!w) return;
    const meaning = fix.meaning?.trim(), trans = fix.trans?.trim();
    if (meaning) {
      const m = w.meanings?.[lang];
      w.meanings = { ...(w.meanings ?? {}), [lang]: m ? { ...m, inContext: meaning, edited: true }
        : { lemma: w.w, inContext: meaning, senses: [], source: 'dictionary', at: Date.now(), edited: true } };
    }
    if (trans) w.trans = [...w.trans.filter((x) => x.lang !== lang), { lang, text: trans, edited: true }];
    if (this.db && (meaning || trans)) void putWord(this.db, $state.snapshot(w) as SavedWord);
  }

  /** Stores a word's meaning in one language (shown again instantly, kept in backups). */
  setMeaning(id: string, to: string, meaning: WordMeaning) {
    const w = this.words.find((x) => x.id === id);
    if (!w || meaning.temporary) return; // a stopgap guess (dictionary unreachable) is shown, never kept
    w.meanings = { ...(w.meanings ?? {}), [to]: meaning };
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
  }

  /** new: never saved or marked; learning: in the review bag; known: learned in review or marked "I know this". */
  wordStatus(lang: string, key: string): 'new' | 'learning' | 'known' {
    const w = this.wordById.get(wordId(lang, key));
    if (w) return w.ivl >= LEARNED_DAYS ? 'known' : 'learning';
    return this.knownSets.get(lang)?.has(key) ? 'known' : 'new';
  }

  isKnown(lang: string, key: string) {
    return !!this.knownSets.get(lang)?.has(key);
  }

  /** Marks a word as known (or not any more). A known word is not part of the review bag. */
  setKnown(lang: string, key: string, on: boolean) {
    const list = this.known[lang] ?? [];
    if (on === list.includes(key)) return;
    this.known = { ...this.known, [lang]: on ? [...list, key] : list.filter((k) => k !== key) };
    this.persistKnown();
  }

  isSaved(lang: string, key: string) {
    return this.savedIds.has(wordId(lang, key));
  }

  removeWord(id: string) {
    this.words = this.words.filter((w) => w.id !== id);
    if (this.db) void deleteWord(this.db, id);
  }

  clearLanguage(lang: string) {
    this.words = this.words.filter((w) => w.lang !== lang);
    if (this.db) void deleteLanguage(this.db, lang);
  }

  grade(id: string, grade: Grade) {
    const w = this.words.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, schedule(w, grade));
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
  }

  async exportAll(): Promise<Blob> {
    if (!this.db) throw new Error('no-storage');
    return new Blob([JSON.stringify(await exportBackup(this.db))], { type: 'application/json' });
  }

  async importAll(text: string, mode: 'replace' | 'merge') {
    if (!this.db) throw new Error('no-storage');
    const backup = parseBackup(text);
    const counts = await importBackup(this.db, backup, mode);
    this.words = await loadWords(this.db);
    this.known = await loadKnown(this.db);
    this.texts = sortTexts(await loadTexts(this.db));
    if (mode === 'replace') {
      this.settings = await loadSettings(this.db);
      this.applySettings(false);
      this.vid = null;
    } else if (this.vid) {
      this.tracks = await loadTracks(this.db, this.vid);
    }
    return counts;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Reading mode

  /** Stores a new text and returns it. */
  addText(x: { title: string; lang: string; body: string }): TextDoc {
    const now = Date.now();
    const doc: TextDoc = { id: uid(), title: x.title.trim().slice(0, 120), lang: x.lang, body: x.body.slice(0, TEXT_LIMIT), added: now, opened: now, pos: 0, done: 0 };
    this.texts = [doc, ...this.texts];
    if (this.db) void putText(this.db, doc);
    return doc;
  }

  /** Changes a text (where the learner is, translations…); saved a moment later. */
  updateText(id: string, patch: Partial<Omit<TextDoc, 'id'>>) {
    const x = this.texts.find((d) => d.id === id);
    if (!x) return;
    Object.assign(x, patch);
    this.dirtyTexts.add(id);
    this.persistTexts();
  }

  /** One sentence's translation of a text. */
  setTextTrans(id: string, lang: string, i: number, text: string) {
    const x = this.texts.find((d) => d.id === id);
    if (!x || !text) return;
    const list = [...(x.trans?.[lang] ?? [])];
    while (list.length < i) list.push(null);
    list[i] = text;
    this.updateText(id, { trans: { ...(x.trans ?? {}), [lang]: list } });
  }

  /** Opening a text moves it to the top of the list. */
  touchText(id: string) {
    this.updateText(id, { opened: Date.now() });
    this.texts = sortTexts(this.texts);
  }

  removeText(id: string) {
    this.texts = this.texts.filter((d) => d.id !== id);
    if (this.db) void deleteText(this.db, id);
  }
}

const sortTexts = (list: TextDoc[]) => [...list].sort((a, b) => b.opened - a.opened);

export const app = new AppState();
export type { Grade };
