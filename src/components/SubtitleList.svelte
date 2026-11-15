<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import { autoSubs } from '../lib/auto.svelte';
  import { SUBS_API_ENABLED } from '../lib/ytsubs/api';

  const offer = $derived(SUBS_API_ENABLED && app.tracks.length && !autoSubs.running ? autoSubs.offerable() : []);

  const isAi = (name: string) => / \(AI…?\)$/.test(name);
  const shift = (id: string, cur: number, d: number) => app.updateTrack(id, { offset: Math.round((cur + d) * 10) / 10 });
</script>

{#if app.tracks.length}
  <ul class="subs">
    {#each app.tracks as tr, i (tr.id)}
      <li>
        <div class="line">
          <label class="show">
            <input type="checkbox" checked={tr.visible} onchange={(e) => app.updateTrack(tr.id, { visible: e.currentTarget.checked })} />
            <span class="dot" style:background={tr.color} aria-hidden="true"></span>
            <span class="name">{tr.label || langName(tr.lang, i18n.locale)}</span>
            {#if i === 0}<span class="tag">{t('subs.original')}</span>{:else if isAi(tr.name)}<span class="tag ai">{t('subs.ai')}</span>{/if}
          </label>
          <button class="remove" onclick={() => app.removeTrack(tr.id)} aria-label={t('tracks.remove')} title={t('tracks.remove')}>✕</button>
        </div>
        <div class="sync" role="group" aria-label={t('tracks.offset')}>
          <span class="muted">{t('tracks.offset')}</span>
          <button onclick={() => shift(tr.id, tr.offset, -0.2)} aria-label={t('tracks.earlier')}>−</button>
          <output>{tr.offset > 0 ? '+' : ''}{tr.offset.toFixed(1)}s</output>
          <button onclick={() => shift(tr.id, tr.offset, 0.2)} aria-label={t('tracks.later')}>+</button>
        </div>
      </li>
    {/each}
  </ul>
  {#if offer.length}
    <div class="more">
      <span class="muted">{t('auto.askMore')}</span>
      {#each offer as code}<button onclick={() => autoSubs.translateTo(code)}>＋ {langName(code, i18n.locale)}</button>{/each}
    </div>
  {:else if autoSubs.running}
    <p class="muted small">{t('subs.translating')}</p>
  {/if}
  <p class="muted small">{t('subs.hint')}</p>
{:else}
  <p class="muted small">{t('subs.none')}</p>
{/if}

<style>
  .subs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li { display: grid; gap: 2px; padding: 6px 0; border-top: 1px solid var(--line); }
  .line { display: flex; align-items: center; gap: var(--space-2); }
  li:first-child { border-top: 0; }
  .show { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; }
  .show input { width: 20px; height: 20px; accent-color: var(--accent); flex: none; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--surface-2); color: var(--muted); white-space: nowrap; }
  .tag.ai { background: var(--accent-soft); color: var(--accent); }
  .sync { display: flex; align-items: center; gap: 4px; padding-left: 28px; font-size: 0.85rem; }
  .sync .muted { margin-right: 4px; }
  .sync button { min-width: 36px; min-height: 36px; padding: 0; }
  .sync output { min-width: 3.2rem; text-align: center; font-size: 0.85rem; font-variant-numeric: tabular-nums; color: var(--muted); }
  .remove { min-width: 36px; min-height: 36px; padding: 0; color: var(--danger); }
  .more { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin-top: var(--space-2); font-size: 0.88rem; }
  .more button { border-radius: 99px; min-height: 36px; padding: 0 14px; font-size: 0.88rem; }
  .small { font-size: 0.85rem; margin: var(--space-2) 0 0; }
</style>
