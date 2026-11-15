<script lang="ts">
  import Mascot from './Mascot.svelte';
  import WordCard from './WordCard.svelte';
  import { app } from '../lib/state.svelte';
  import { player } from '../lib/player/controller.svelte';
  import { t } from '../lib/i18n/index.svelte';

  const mine = $derived(app.words.filter((w) => w.vid && w.vid === app.vid).sort((a, b) => b.added - a.added));
</script>

<div class="panel">
  <div class="top">
    <h3>{t('words.here')} <span class="count">{mine.length}</span></h3>
    <a href="#/words">{t('words.all')} →</a>
  </div>
  {#if !mine.length}
    <div class="empty"><Mascot size={56} /><p class="muted">{t('words.here.empty')}</p></div>
  {:else}
    <ul>
      {#each mine as w (w.id)}<li><WordCard word={w} onplay={(s) => player.seek(s)} /></li>{/each}
    </ul>
  {/if}
</div>

<style>
  .panel { display: grid; gap: var(--space-3); }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
  h3 { font-size: 1rem; }
  .count { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 1px 10px; font-size: 0.85rem; }
  .empty { display: grid; justify-items: center; gap: var(--space-2); text-align: center; padding: var(--space-5) 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
</style>
