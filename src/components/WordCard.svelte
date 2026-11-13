<script lang="ts">
  import WordMeaning from './WordMeaning.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { tokenize } from '../lib/words/tokenize';
  import { isDue, isLearned } from '../lib/srs/scheduler';
  import { watchUrl } from '../lib/router.svelte';
  import { DEFINE_ENABLED } from '../lib/words/define';
  import type { SavedWord } from '../lib/types';
  import { shownLang, SENTENCE_ENABLED, SentenceError } from '../lib/words/sentence';
  import { langName } from '../lib/languages';
  import { i18n } from '../lib/i18n/index.svelte';
  import { untrack } from 'svelte';

  /** `onplay` set: jump inside the open player (Words tab); otherwise link to the video (My words page). */
  let { word, onplay }: { word: SavedWord; onplay?: (t: number) => void } = $props();
  let open = $state(false);

  const parts = $derived(tokenize(word.ctx, word.lang));
  // Everything is shown in the language chosen above the list; something in another language is labelled as such.
  const pref = $derived(shownLang(word, app.settings.meaningLang));
  const meaning = $derived((pref && word.meanings?.[pref]) || Object.values(word.meanings ?? {})[0]);
  const meaningLang = $derived(pref && word.meanings?.[pref] ? pref : Object.keys(word.meanings ?? {})[0]);
  const tr = $derived((pref && word.trans.find((x) => x.lang === pref)) || word.trans[0]);
  const missing = $derived(!!pref && !word.trans.some((x) => x.lang === pref));
  const tag = (l: string | undefined) => (l && pref && l !== pref ? l.toUpperCase() : '');

  let busy = $state(false);
  let failed = $state(false);
  // The video's own subtitles may already have the sentence in that language: fill it in quietly (no server).
  $effect(() => {
    if (missing && pref) { const l = pref; untrack(() => void app.transFromTracks(word, l)); }
  });
  async function getTrans() {
    if (!pref) return;
    busy = true; failed = false;
    try { await app.translateWordSentence(word, pref); }
    catch (e) { failed = !(e instanceof SentenceError && e.code === 'cancelled'); }
    finally { busy = false; }
  }
  const learned = $derived(isLearned(word));
  const due = $derived(!learned && word.reps > 0 && isDue(word));
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<article class="wc" class:open>
  <div class="top">
    <strong class="w" lang={word.lang}>{word.w}</strong>
    {#if learned}<span class="badge good">✓ {t('words.learned.one')}</span>
    {:else if due}<span class="badge due">{t('words.due.one')}</span>
    {:else if !word.reps}<span class="badge new">{t('words.new')}</span>{/if}
  </div>

  {#if meaning}<p class="gloss">{#if tag(meaningLang)}<span class="lt">{tag(meaningLang)}</span>{/if}{meaning.inContext}</p>{/if}

  <p class="sent" lang={word.lang}>
    {#each parts as p}{#if p.isWord && p.key === word.w}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
  </p>
  {#if tr && !(missing && (busy || failed))}<p class="tr" lang={tr.lang}>{#if tag(tr.lang)}<span class="lt">{tag(tr.lang)}</span>{/if}{tr.text}</p>{/if}
  {#if missing && pref && SENTENCE_ENABLED}
    {#if busy}<p class="muted small" role="status"><span class="spin" aria-hidden="true"></span>{t('trans.loading')}</p>
    {:else if failed}<p class="err small" role="alert">{t('trans.err')} <button class="link" onclick={getTrans}>{t('trans.retry')}</button></p>
    {:else}<button class="link get" onclick={getTrans}>🌐 {t('trans.get', { lang: langName(pref, i18n.locale) })}</button>{/if}
  {/if}

  <div class="actions">
    {#if DEFINE_ENABLED}
      <button class="mean" class:on={open} aria-expanded={open} onclick={() => (open = !open)}>
        📖 <span class="long">{open ? t('words.meaning.hide') : meaning ? t('words.meaning.more') : t('words.meaning.show')}</span><span class="short">{t('words.meaning.short')}</span>
      </button>
    {/if}
    {#if word.vid}
      {#if onplay}
        <button class="play" onclick={() => onplay(word.t)} aria-label={t('words.play', { time: fmt(word.t) })}>▶ {fmt(word.t)}</button>
      {:else}
        <a class="play" href={watchUrl(word.vid, word.t)} aria-label={t('words.play', { time: fmt(word.t) })}>▶ <span class="long">{t('words.watch')} · </span>{fmt(word.t)}</a>
      {/if}
    {/if}
    <span class="grow"></span>
    <ConfirmButton onconfirm={() => app.removeWord(word.id)} label={t('words.remove', { word: word.w })}>✕</ConfirmButton>
  </div>

  {#if open}<WordMeaning {word} />{/if}
</article>

<style>
  .wc { display: grid; gap: 6px; padding: var(--space-3); border: 1.5px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
  .wc.open { border-color: var(--accent); }
  .top { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
  .w { font: 800 1.2rem var(--font-display); }
  .badge { font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
  .badge.good { background: color-mix(in srgb, var(--good) 15%, transparent); color: var(--good); }
  .badge.due { background: var(--accent-soft); color: var(--accent); }
  .gloss { margin: 0; color: var(--accent); font-weight: 800; }
  .sent { margin: 0; font-size: 0.92rem; color: var(--muted); overflow-wrap: anywhere; }
  .sent mark { background: var(--accent-soft); color: var(--text); font-weight: 700; border-radius: 4px; padding: 0 3px; }
  .tr { margin: 0; font-size: 0.88rem; color: var(--text); opacity: 0.75; overflow-wrap: anywhere; }
  .lt { display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 5px; font: 800 0.65rem/1.5 var(--font-body);
    letter-spacing: 0.04em; background: var(--surface-2); color: var(--muted); vertical-align: 0.15em; }
  .get { justify-self: start; font-size: 0.86rem; font-weight: 700; color: var(--accent); }
  .link { all: unset; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .link:focus-visible { outline: 2px solid var(--focus); border-radius: 4px; }
  .small { margin: 0; font-size: 0.86rem; display: flex; align-items: center; gap: 6px; }
  .err { color: var(--danger); }
  .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: 2px; }
  .grow { flex: 1; }
  .mean, .play { min-height: 38px; padding: 0 12px; font-size: 0.88rem; font-weight: 700; }
  .mean.on { background: var(--accent-soft); border-color: var(--accent); }
  a.play { display: inline-flex; align-items: center; border: 1.5px solid var(--line); border-radius: var(--radius-sm); text-decoration: none; color: var(--text); background: var(--surface); }
  a.play:hover { border-color: var(--accent); }
  .short { display: none; }
  @media (max-width: 760px) {
    .long { display: none; }
    .short { display: inline; }
    .actions { flex-wrap: nowrap; gap: 6px; }
    .mean, .play { min-height: 40px; }
  }
  .actions :global(.wrap button) { min-height: 38px; min-width: 38px; padding: 0 10px; font-size: 0.88rem; }
</style>
