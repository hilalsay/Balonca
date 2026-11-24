import { DEFAULT_SETTINGS, type Settings } from './settings';
import { TRACK_COLORS, uid, type SavedWord, type StoredTrack, type TextDoc, type WordMeaning } from './types';
import { openBalonca, loadSettings, saveSettings, loadWords, loadKnown, saveKnown, type KnownWords, putWord, deleteWord, deleteLanguage, loadTracks, saveTracks,
  getLastVideo, setLastVideo, exportBackup, parseBackup, importBackup, loadTexts, putText, deleteText, TEXT_LIMIT, cleanWord, cleanText, type Db } from './storage';
import { sanitizeSettings, FONT_SCALES, withTranslationLang, type AutoLang } from './settings';
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
  /** YouTube videos opened on this account (synced as library items). */
  videos = $state<{ vid: string; openedAt: number }[]>([]);

  // ------------------------------------------------------------------------------------------------------------
  // Change journal for sync: what changed (or was deleted) and when, until the server has it.
  journal: Journal = { words: {}, known: {}, texts: {}, videos: {}, settings: 0 };
  /** Called after every local change (the sync engine schedules a push). */
  onChange: (() => void) | null = null;
  private persistJournal = debounce(() => { if (this.db) void this.db.put('meta', JSON.parse(JSON.stringify(this.journal)), 'journal'); }, 300);
  private mark(kind: 'words' | 'known' | 'texts' | 'videos', key: string, deleted = false) {
    this.journal[kind][key] = { at: Date.now(), ...(deleted ? { deleted: true } : {}) };
    this.persistJournal();
    this.onChange?.();
  }
  private markSettings() { this.journal.settings = Date.now(); this.persistJournal(); this.onChange?.(); }

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
      this.journal = { ...this.journal, ...(((await this.db.get('meta', 'journal')) as Journal | undefined) ?? {}) };
      this.videos = ((await this.db.get('meta', 'videos')) as AppState['videos'] | undefined) ?? [];
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
    if (typeof document !== 'undefined') document.documentElement.style.fontSize = `${FONT_SCALES[this.settings.fontScale] * 100}%`;
    applyTheme();
    setLocale(this.settings.locale);
    if (persist) this.persistSettings();
  }

  /** The one translation language (see settings.ts). */
  setTranslationLang(lang: AutoLang) {
    Object.assign(this.settings, withTranslationLang(this.settings, lang));
    this.markSettings();
    this.persistSettings();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.settings[key] = value;
    this.markSettings();
    if (key === 'theme' || key === 'locale' || key === 'fontScale') this.applySettings(true);
    else this.persistSettings();
  }

  async openVideo(id: string) {
    if (this.vid === id) return;
    this.vid = id;
    this.videos = [{ vid: id, openedAt: Date.now() }, ...this.videos.filter((v) => v.vid !== id)].slice(0, 500);
    if (this.db) void this.db.put('meta', $state.snapshot(this.videos), 'videos');
    this.mark('videos', id);
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
    this.mark('words', w.id, !added);
    return added;
  }

  /** Adds (or replaces) the sentence's translation in one language. */
  setTrans(id: string, lang: string, text: string) {
    const w = this.words.find((x) => x.id === id);
    if (!w || !text) return;
    w.trans = [...w.trans.filter((x) => x.lang !== lang), { lang, text }];
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
    this.mark('words', w.id);
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
    if (meaning || trans) this.mark('words', w.id);
  }

  /** Stores a word's meaning in one language (shown again instantly, kept in backups). */
  setMeaning(id: string, to: string, meaning: WordMeaning) {
    const w = this.words.find((x) => x.id === id);
    if (!w || meaning.temporary) return; // a stopgap guess (dictionary unreachable) is shown, never kept
    w.meanings = { ...(w.meanings ?? {}), [to]: meaning };
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
    this.mark('words', w.id);
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
    this.mark('known', `${lang}\t${key}`, !on);
  }

  isSaved(lang: string, key: string) {
    return this.savedIds.has(wordId(lang, key));
  }

  /** Puts a deleted word back exactly as it was ("Undo"). */
  restoreWord(w: SavedWord) {
    if (this.wordById.has(w.id)) return;
    this.words = [...this.words, w];
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
    this.mark('words', w.id);
  }

  removeWord(id: string) {
    this.words = this.words.filter((w) => w.id !== id);
    if (this.db) void deleteWord(this.db, id);
    this.mark('words', id, true);
  }

  clearLanguage(lang: string) {
    for (const w of this.words) if (w.lang === lang) this.mark('words', w.id, true);
    this.words = this.words.filter((w) => w.lang !== lang);
    if (this.db) void deleteLanguage(this.db, lang);
  }

  grade(id: string, grade: Grade) {
    const w = this.words.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, schedule(w, grade));
    if (this.db) void putWord(this.db, $state.snapshot(w) as SavedWord);
    this.mark('words', w.id);
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
    this.mark('texts', doc.id);
    return doc;
  }

  /** Changes a text (where the learner is, translations…); saved a moment later. */
  updateText(id: string, patch: Partial<Omit<TextDoc, 'id'>>) {
    const x = this.texts.find((d) => d.id === id);
    if (!x) return;
    Object.assign(x, patch);
    this.dirtyTexts.add(id);
    this.persistTexts();
    this.mark('texts', id);
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

  // ------------------------------------------------------------------------------------------------------------
  // Sync (src/lib/sync.svelte.ts drives these)

  /** Everything in the journal, as the server wants it. */
  collect(): SyncPayload {
    const j = this.journal;
    const words = Object.entries(j.words).map(([id, s]) => {
      const w = s.deleted ? undefined : this.wordById.get(id);
      return w ? { id, lang: w.lang, updatedAt: s.at, data: $state.snapshot(w) } : { id, lang: id.split(':')[0], updatedAt: s.at, deleted: true };
    });
    const known = Object.entries(j.known).map(([k, s]) => { const [lang, w] = k.split('\t'); return { lang, w, updatedAt: s.at, ...(s.deleted ? { deleted: true } : {}) }; });
    const library: RemoteItem[] = [
      ...Object.entries(j.texts).map(([id, s]) => {
        const x = s.deleted ? undefined : this.textById.get(id);
        return x ? { id, kind: 'text' as const, title: x.title, body: x.body, meta: { lang: x.lang, pos: x.pos, done: x.done, trans: $state.snapshot(x.trans) ?? null },
          createdAt: x.added, openedAt: x.opened, updatedAt: s.at } : { id, kind: 'text' as const, updatedAt: s.at, deleted: true };
      }),
      ...Object.entries(j.videos).map(([vid, s]) => ({ id: `yt-${vid}`, kind: 'youtube' as const, vid, openedAt: s.at, createdAt: s.at, updatedAt: s.at })),
    ];
    const data: Record<string, unknown> = { ...$state.snapshot(this.settings) };
    for (const k of LOCAL_SETTINGS) delete data[k];
    return { words, known, library, settings: j.settings ? { data, updatedAt: j.settings } : null };
  }

  /** The server has everything changed up to `upTo`: forget it (newer changes stay). */
  acknowledge(upTo: number) {
    for (const kind of ['words', 'known', 'texts', 'videos'] as const) {
      for (const [k, s] of Object.entries(this.journal[kind])) if (s.at <= upTo) delete this.journal[kind][k];
    }
    if (this.journal.settings && this.journal.settings <= upTo) this.journal.settings = 0;
    this.persistJournal();
  }

  /** Changes from the server. A newer change made here (still in the journal) wins and is not overwritten. */
  async applyRemote(r: SyncPayload) {
    const db = this.db, j = this.journal;
    const words = new Map(this.words.map((w) => [w.id, w]));
    for (const x of r.words) {
      if ((j.words[x.id]?.at ?? 0) >= x.updatedAt) continue;
      if (x.deleted) { words.delete(x.id); if (db) await deleteWord(db, x.id); continue; }
      const w = cleanWord(x.data);
      if (!w || w.id !== x.id) continue;
      words.set(w.id, w);
      if (db) await putWord(db, w);
    }
    this.words = [...words.values()];
    if (r.known.length) {
      const known: KnownWords = JSON.parse(JSON.stringify(this.known));
      for (const k of r.known) {
        if ((j.known[`${k.lang}\t${k.w}`]?.at ?? 0) >= k.updatedAt) continue;
        const list = (known[k.lang] ??= []);
        if (k.deleted) known[k.lang] = list.filter((w) => w !== k.w); else if (!list.includes(k.w)) list.push(k.w);
      }
      this.known = known;
      if (db) await saveKnown(db, known);
    }
    if (r.settings && (j.settings || 0) < r.settings.updatedAt) {
      const keep = Object.fromEntries(LOCAL_SETTINGS.map((k) => [k, this.settings[k]]));
      this.settings = sanitizeSettings({ ...(r.settings.data as object), ...keep });
      this.applySettings(false);
      if (db) await saveSettings(db, $state.snapshot(this.settings) as Settings);
    }
    const texts = new Map(this.texts.map((x) => [x.id, x]));
    let videos = [...this.videos];
    for (const it of r.library) {
      if (it.kind === 'text') {
        if ((j.texts[it.id]?.at ?? 0) >= it.updatedAt) continue;
        if (it.deleted) { texts.delete(it.id); if (db) await deleteText(db, it.id); continue; }
        const m = (it.meta ?? {}) as Record<string, unknown>;
        const doc = cleanText({ id: it.id, title: it.title, body: it.body, lang: m.lang, pos: m.pos, done: m.done, trans: m.trans, added: it.createdAt, opened: it.openedAt });
        if (!doc) continue;
        texts.set(doc.id, doc);
        if (db) await putText(db, doc);
      } else if (it.kind === 'youtube' && it.vid && !it.deleted) {
        if (!videos.some((v) => v.vid === it.vid && v.openedAt >= (it.openedAt ?? 0))) {
          videos = [{ vid: it.vid, openedAt: it.openedAt ?? it.updatedAt }, ...videos.filter((v) => v.vid !== it.vid)];
        }
      }
    }
    this.texts = sortTexts([...texts.values()]);
    this.videos = videos.sort((a, b) => b.openedAt - a.openedAt).slice(0, 500);
    if (db) await db.put('meta', $state.snapshot(this.videos), 'videos');
  }

  localCounts() { return { words: this.words.length, texts: this.texts.length }; }

  /** Removes this device's words, known words, texts and video list (after the learner said "only my account's"). */
  async wipeLocal() {
    const db = this.db;
    if (db) {
      const tx = db.transaction(['words', 'texts', 'meta'], 'readwrite');
      await Promise.all([tx.objectStore('words').clear(), tx.objectStore('texts').clear(), tx.objectStore('meta').delete('known'), tx.objectStore('meta').delete('videos')]);
      await tx.done;
    }
    this.words = []; this.known = {}; this.texts = []; this.videos = [];
    this.journal = { words: {}, known: {}, texts: {}, videos: {}, settings: 0 };
    this.persistJournal();
  }

  /** Marks everything on this device as changed now (first sign-in: "add my words to my account"). */
  markAll() {
    for (const w of this.words) this.journal.words[w.id] = { at: Date.now() };
    for (const [lang, list] of Object.entries(this.known)) for (const w of list) this.journal.known[`${lang}\t${w}`] = { at: Date.now() };
    for (const x of this.texts) this.journal.texts[x.id] = { at: Date.now() };
    for (const v of this.videos) this.journal.videos[v.vid] = { at: v.openedAt };
    this.journal.settings = Date.now();
    this.persistJournal();
  }

  async meta<T>(key: string): Promise<T | undefined> { return this.db ? ((await this.db.get('meta', key)) as T | undefined) : undefined; }
  async setMeta(key: string, value: unknown) { if (this.db) await this.db.put('meta', JSON.parse(JSON.stringify(value)), key); }

  removeText(id: string) {
    this.texts = this.texts.filter((d) => d.id !== id);
    if (this.db) void deleteText(this.db, id);
    this.mark('texts', id, true);
  }
}

/** Local changes not yet on the server: key -> when (and whether it was a deletion). */
export interface Journal {
  words: Record<string, Stamp>; known: Record<string, Stamp>; texts: Record<string, Stamp>; videos: Record<string, Stamp>;
  settings: number; // when the settings last changed here (0 = not since the last sync)
}
export interface Stamp { at: number; deleted?: true }

// ---------------------------------------------------------------------------------------------------------------
// Sync payloads (shapes of server/sync.mjs)

export interface RemoteWord { id: string; lang: string; updatedAt: number; deleted?: boolean; data?: unknown }
export interface RemoteKnown { lang: string; w: string; updatedAt: number; deleted?: boolean }
export interface RemoteItem {
  id: string; kind: 'youtube' | 'link' | 'text' | 'pdf' | 'subfile'; title?: string | null; url?: string | null; vid?: string | null;
  body?: string | null; meta?: Record<string, unknown> | null; createdAt?: number; openedAt?: number | null; updatedAt: number; deleted?: boolean;
}
export interface SyncPayload { words: RemoteWord[]; known: RemoteKnown[]; library: RemoteItem[]; settings: { data: unknown; updatedAt: number } | null }
/** Settings that belong to one device and do not travel. */
const LOCAL_SETTINGS = ['readVoices'] as const;

const sortTexts = (list: TextDoc[]) => [...list].sort((a, b) => b.opened - a.opened);

export const app = new AppState();
export type { Grade };
