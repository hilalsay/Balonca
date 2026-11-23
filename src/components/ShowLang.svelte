<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import { AUTO_LANGS, type AutoLang } from '../lib/settings';

  /** One choice for every explanation: sentence translations and word meanings (cards, review, word popup). */
  /** `exclude`: the language being read, which makes no sense as its own translation. */
  let { compact = false, exclude = '' }: { compact?: boolean; exclude?: string } = $props();
  const id = `showlang-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="sl" class:compact>
  <span class="q" id={id}>{t('showLang.title')}</span>
  <div class="chips" role="radiogroup" aria-labelledby={id}>
    {#each AUTO_LANGS.filter((x) => x !== exclude) as l}
      <button role="radio" aria-checked={app.settings.meaningLang === l} class:on={app.settings.meaningLang === l}
        onclick={() => app.setSetting('meaningLang', l as AutoLang)}>{langName(l, i18n.locale)}</button>
    {/each}
  </div>
  {#if !compact}<p class="muted note">{t('showLang.note')}</p>{/if}
</div>

<style>
  .sl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--space-2); }
  .q { font-weight: 700; font-size: 0.92rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { min-height: 36px; padding: 0 14px; border-radius: 99px; font-size: 0.9rem; font-weight: 700; }
  .chips button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .note { flex-basis: 100%; margin: 0; font-size: 0.85rem; }
  .compact .q { color: var(--muted); font-weight: 600; }
</style>
