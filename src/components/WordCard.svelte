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

  /** `onplay` set: jump inside the open player (Words tab); otherwise link to the video (My words page). */
  let { word, onplay }: { word: SavedWord; onplay?: (t: number) => void } = $props();
  let open = $state(false);

  const parts = $derived(tokenize(word.ctx, word.lang));
  const meaning = $derived(
    (app.settings.meaningLang && word.meanings?.[app.settings.meaningLang]) || Object.values(word.meanings ?? {})[0],
  );
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

  {#if meaning}<p class="gloss">{meaning.inContext}</p>{/if}

  <p class="sent" lang={word.lang}>
    {#each parts as p}{#if p.isWord && p.key === word.w}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
  </p>
  {#if word.trans[0]}<p class="tr" lang={word.trans[0].lang}>{word.trans[0].text}</p>{/if}

  <div class="actions">
    {#if DEFINE_ENABLED}
      <button class="mean" class:on={open} aria-expanded={open} onclick={() => (open = !open)}>
        📖 {open ? t('words.meaning.hide') : meaning ? t('words.meaning.more') : t('words.meaning.show')}
      </button>
    {/if}
    {#if word.vid}
      {#if onplay}
        <button class="play" onclick={() => onplay(word.t)} aria-label={t('words.play', { time: fmt(word.t) })}>▶ {fmt(word.t)}</button>
      {:else}
        <a class="play" href={watchUrl(word.vid, word.t)} aria-label={t('words.play', { time: fmt(word.t) })}>▶ {t('words.watch')} · {fmt(word.t)}</a>
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
  .actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: 2px; }
  .grow { flex: 1; }
  .mean, .play { min-height: 38px; padding: 0 12px; font-size: 0.88rem; font-weight: 700; }
  .mean.on { background: var(--accent-soft); border-color: var(--accent); }
  a.play { display: inline-flex; align-items: center; border: 1.5px solid var(--line); border-radius: var(--radius-sm); text-decoration: none; color: var(--text); background: var(--surface); }
  a.play:hover { border-color: var(--accent); }
  .actions :global(.wrap button) { min-height: 38px; min-width: 38px; padding: 0 10px; font-size: 0.88rem; }
</style>
