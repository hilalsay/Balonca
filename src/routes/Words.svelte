<script lang="ts">
  import { AUTO_LANGS, type AutoLang } from '../lib/settings';
  import Mascot from '../components/Mascot.svelte';
  import Review from '../components/Review.svelte';
  import ConfirmButton from '../components/ConfirmButton.svelte';
  import WordCard from '../components/WordCard.svelte';
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import { countByLang, filterWords, toCsv, languagesIn } from '../lib/words/bags';
  import { isDue, progress, reviewQueue } from '../lib/srs/scheduler';
  import { download } from '../lib/download';
  import { toast } from '../lib/toast.svelte';
  import { BackupError } from '../lib/storage';
  import type { MessageKey } from '../lib/i18n/tr';
  import type { SavedWord } from '../lib/types';

  const PAGE = 60;
  type Sort = 'new' | 'az' | 'due';
  let picked = $state<string | null>(null);
  let query = $state('');
  let sort = $state<Sort>('new');
  let limit = $state(PAGE);
  let reviewing = $state(false);
  let pendingBackup = $state<string | null>(null);
  let importInput: HTMLInputElement;

  const langs = $derived(languagesIn(app.words));
  const lang = $derived(picked && langs.includes(picked) ? picked : (langs[0] ?? null));
  const counts = $derived(countByLang(app.words));
  const inLang = $derived(lang ? app.words.filter((w) => w.lang === lang) : []);
  const stats = $derived(progress(inLang));
  const dueCount = $derived(reviewQueue(inLang).length);
  const sorters: Record<Sort, (a: SavedWord, b: SavedWord) => number> = {
    new: (a, b) => b.added - a.added,
    az: (a, b) => a.w.localeCompare(b.w, lang ?? undefined),
    due: (a, b) => Number(isDue(b)) - Number(isDue(a)) || (a.due ?? 0) - (b.due ?? 0),
  };
  const all = $derived(filterWords(app.words, { lang: lang ?? undefined, query }).sort(sorters[sort]));
  const shown = $derived(all.slice(0, limit));

  $effect(() => { void lang; void query; void sort; limit = PAGE; });

  async function exportAll() {
    try {
      download(await app.exportAll(), `balonca-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast(t('backup.exported'), 'success');
    } catch { toast(t('backup.err.no-storage'), 'error'); }
  }
  async function picks(file: File | undefined) {
    if (file) pendingBackup = await file.text();
  }
  async function doImport(mode: 'merge' | 'replace') {
    try {
      const r = await app.importAll(pendingBackup!, mode);
      toast(t('backup.done', r), 'success');
      pendingBackup = null;
    } catch (e) {
      const code = e instanceof BackupError ? e.code : 'no-storage';
      toast(t(`backup.err.${code}` as MessageKey), 'error', 7000);
    }
  }
  // One line instead of chips: the language meanings are shown in (not the words' own language).
  const ownLangs = $derived(new Set(app.words.map((w) => w.lang)));
  const meaningChoices = $derived(AUTO_LANGS.filter((l) => !(ownLangs.size === 1 && ownLangs.has(l))));
  function pickMeaning(l: AutoLang) { if (app.settings.separateMeaning) app.setSetting('meaningLang', l); else app.setTranslationLang(l); }
</script>

<div class="page">
  <div class="title">
    <h1>{t('words.title')}</h1>
    {#if langs.length > 1}
      <div class="chips" role="group" aria-label={t('words.bags')}>
        {#each langs as l}
          <button class="chip" class:on={l === lang} aria-pressed={l === lang} onclick={() => (picked = l)}>
            {langName(l, i18n.locale)} <span class="n">{counts[l]}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if app.words.length && meaningChoices.length}
    <label class="meanings"><span>{t('words.meaningsIn')}:</span>
      <select value={app.settings.meaningLang} onchange={(e) => pickMeaning(e.currentTarget.value as AutoLang)}>
        {#if !app.settings.meaningLang}<option value="">{t('common.choose')}…</option>{/if}
        {#each meaningChoices as l}<option value={l}>{langName(l, i18n.locale)}</option>{/each}
      </select>
    </label>
  {/if}

  {#if reviewing && lang}
    <Review {lang} onclose={() => (reviewing = false)} />
  {/if}

  {#if !app.words.length}
    <div class="card empty">
      <Mascot size={96} float />
      <h2>{t('words.empty.title')}</h2>
      <p class="muted">{t('words.empty.desc')}</p>
      <a class="cta" href="#/watch">{t('words.empty.cta')}</a>
    </div>
  {:else}
    <section class="card hero" class:done={!dueCount}>
      <div class="hero-text">
        {#if dueCount}
          <h2>{t('words.hero.due', { n: dueCount })}</h2>
          <p class="muted">{t('words.hero.due.desc')}</p>
        {:else}
          <h2>{t('words.hero.done')}</h2>
          <p class="muted">{t('words.hero.done.desc')}</p>
        {/if}
        <div class="progress">
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.percent} aria-label={t('words.progress', { n: stats.percent })}>
            <span style:width="{stats.percent}%"></span>
          </div>
          <span class="muted small">{t('words.hero.stats', { learned: stats.learned, total: stats.total })}</span>
        </div>
      </div>
      {#if dueCount}
        <button class="primary big" onclick={() => (reviewing = true)}>{t('words.hero.start')}</button>
      {:else}
        <a class="btn big" href="#/watch">{t('words.hero.more')}</a>
      {/if}
    </section>

    <section class="list-wrap">
      <div class="tools">
        <input type="search" bind:value={query} placeholder={t('words.search')} aria-label={t('words.search')} />
        <label class="sort">
          <span class="sr-only">{t('words.sort')}</span>
          <select bind:value={sort} aria-label={t('words.sort')}>
            <option value="new">{t('words.sort.new')}</option>
            <option value="az">{t('words.sort.az')}</option>
            <option value="due">{t('words.sort.due')}</option>
          </select>
        </label>
      </div>
      <p class="muted small count" aria-live="polite">{t('words.count', { n: all.length })}</p>

      {#if !shown.length}
        <p class="muted">{t('words.none')}</p>
      {:else}
        <ul class="grid">
          {#each shown as w (w.id)}<li><WordCard word={w} /></li>{/each}
        </ul>
        {#if all.length > shown.length}
          <button class="more" onclick={() => (limit += PAGE)}>{t('words.more', { n: all.length - shown.length })}</button>
        {/if}
      {/if}
    </section>
  {/if}

  <details class="card extra">
    <summary>{t('words.extra')}</summary>
    <div class="extra-body">
      {#if lang && inLang.length}
        <div class="block">
          <h3>{t('words.bag', { lang: langName(lang, i18n.locale) })}</h3>
          <div class="row">
            <button onclick={() => download(new Blob([toCsv(inLang)], { type: 'text/csv;charset=utf-8' }), `balonca-${lang}.csv`)}>{t('words.csv')}</button>
            <ConfirmButton onconfirm={() => { app.clearLanguage(lang!); picked = null; }}>{t('words.clear')}</ConfirmButton>
          </div>
        </div>
      {/if}
      <div class="block">
        <h3>{t('backup.title')}</h3>
        <p class="muted small">{t('backup.desc')}</p>
        <div class="row">
          <button onclick={exportAll}>{t('backup.export')}</button>
          <button onclick={() => importInput.click()}>{t('backup.import')}</button>
          <input bind:this={importInput} type="file" accept=".json,application/json" hidden
            onchange={(e) => { picks(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        </div>
        {#if pendingBackup}
          <div class="choice">
            <div><button class="primary" onclick={() => doImport('merge')}>{t('backup.merge')}</button><p class="muted">{t('backup.merge.desc')}</p></div>
            <div><ConfirmButton onconfirm={() => doImport('replace')}>{t('backup.replace')}</ConfirmButton><p class="muted">{t('backup.replace.desc')}</p></div>
            <button onclick={() => (pendingBackup = null)}>{t('common.cancel')}</button>
          </div>
        {/if}
      </div>
    </div>
  </details>
</div>

<style>
  .meanings { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; margin-bottom: var(--space-3); }
  .meanings select { min-height: 44px; border-radius: 99px; padding: 0 12px; }
  .page { display: grid; gap: var(--space-4); }
  .title { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.2rem); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .chip { border-radius: 99px; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chip .n { opacity: 0.75; font-weight: 400; margin-left: 4px; }
  .empty { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-6) var(--space-4); text-align: center; }
  .cta { display: inline-flex; align-items: center; min-height: 48px; padding: 0 28px; background: var(--accent); color: var(--accent-ink); border-radius: 99px; font-weight: 800; text-decoration: none; }

  .hero { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; justify-content: space-between;
    background: linear-gradient(135deg, var(--accent-soft), var(--surface)); }
  .hero-text { flex: 1 1 260px; display: grid; gap: var(--space-1); }
  .hero h2 { font-size: clamp(1.2rem, 4vw, 1.5rem); margin: 0; }
  .hero p { margin: 0; }
  .progress { display: grid; gap: 4px; margin-top: var(--space-2); }
  .bar { height: 10px; background: var(--surface-2); border-radius: 99px; overflow: hidden; max-width: 360px; }
  .bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--pink)); border-radius: 99px; transition: width 0.4s ease; }
  .big { min-height: 52px; padding: 0 28px; font-size: 1.05rem; border-radius: 99px; }
  .btn { display: inline-flex; align-items: center; border: 1.5px solid var(--line); text-decoration: none; color: var(--text); background: var(--surface); font-weight: 800; }
  .btn:hover { border-color: var(--accent); }

  .tools { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .tools input { flex: 1 1 220px; min-width: 0; }
  .sort select { min-height: 44px; }
  .count { margin: var(--space-2) 0; }
  .small { font-size: 0.85rem; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: start; }
  .more { width: 100%; margin-top: var(--space-3); }

  @media (max-width: 760px) {
    .page { gap: var(--space-3); }
    h1 { font-size: 1.5rem; }
    .chips { width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .chip { flex: none; }
    .hero { padding: var(--space-4); gap: var(--space-3); }
    .hero .big { width: 100%; justify-content: center; }
    .tools { flex-wrap: nowrap; }
    .tools input { flex: 1 1 0; width: 0; } /* no built-in text-box width: it would push a 320px screen sideways */
    .sort select { width: 8.5rem; }
  }
  .extra summary { cursor: pointer; font-weight: 800; min-height: 44px; display: flex; align-items: center; gap: 8px; list-style: none; }
  .extra summary::-webkit-details-marker { display: none; }
  .extra summary::before { content: '▸'; color: var(--accent); transition: transform 0.15s; }
  .extra[open] summary::before { transform: rotate(90deg); }
  .extra-body { display: grid; gap: var(--space-4); margin-top: var(--space-3); }
  .block h3 { font-size: 1rem; margin: 0 0 var(--space-2); }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .choice { display: grid; gap: var(--space-3); margin-top: var(--space-4); padding: var(--space-4); border-radius: var(--radius-sm); background: var(--surface-2); }
  .choice p { margin: 4px 0 0; font-size: 0.9rem; }
</style>
