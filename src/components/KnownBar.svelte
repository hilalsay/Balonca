<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { tokenize } from '../lib/words/tokenize';
  import type { StoredTrack } from '../lib/types';

  let { track }: { track: StoredTrack } = $props();

  // The distinct words of the video (its own language), worked out once per track.
  const keys = $derived.by(() => {
    const set = new Set<string>();
    for (const c of track.cues) for (const tok of tokenize(c.text, track.lang)) if (tok.isWord && /\p{L}/u.test(tok.key)) set.add(tok.key);
    return [...set];
  });
  const counts = $derived.by(() => {
    let known = 0, learning = 0;
    for (const k of keys) {
      const s = app.wordStatus(track.lang, k);
      if (s === 'known') known++; else if (s === 'learning') learning++;
    }
    return { known, learning, total: keys.length };
  });
  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);
</script>

{#if counts.total >= 10}
  <div class="kb">
    <div class="line">
      <span><strong>{t('known.pct', { n: pct(counts.known) })}</strong> {t('known.summary', { known: counts.known, total: counts.total })}</span>
      {#if counts.learning}<span class="learning">{t('known.learning', { n: counts.learning })}</span>{/if}
    </div>
    <div class="bar" role="img" aria-label={t('known.bar', { known: pct(counts.known), learning: pct(counts.learning) })}>
      <span class="k" style:width="{pct(counts.known)}%"></span><span class="l" style:width="{pct(counts.learning)}%"></span>
    </div>
    {#if app.settings.colorWords}
      <div class="legend muted">
        <span><i class="new"></i>{t('known.new')}</span><span><i class="learn"></i>{t('known.learn')}</span><span><i class="know"></i>{t('known.know')}</span>
        {#if !counts.known && !counts.learning}<span class="tip">{t('known.tip')}</span>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .kb { display: grid; gap: 4px; padding: 0 0 var(--space-2); border-bottom: 1px solid var(--line); margin-bottom: var(--space-1); font-size: 0.85rem; }
  .line { display: flex; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
  strong { color: var(--good); font-size: 0.95rem; }
  .learning { color: var(--muted); }
  .bar { display: flex; height: 6px; border-radius: 99px; overflow: hidden; background: var(--surface-2); }
  .bar .k { background: var(--good); transition: width 0.3s; }
  .bar .l { background: var(--pink); transition: width 0.3s; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.78rem; align-items: center; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  i { display: inline-block; width: 18px; height: 0.8em; border-radius: 3px; }
  i.new { border-bottom: 2px solid var(--muted); opacity: 0.6; height: 0.4em; border-radius: 0; }
  i.learn { border-bottom: 2px dashed var(--pink); height: 0.4em; border-radius: 0; }
  i.know { background: var(--good); opacity: 0.45; }
  .tip { flex-basis: 100%; }
</style>
