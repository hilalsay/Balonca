<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  import { AUTO_LANGS, type SubStyle } from '../lib/settings';
  import { langName } from '../lib/languages';
  import { SUBS_API_ENABLED } from '../lib/ytsubs/api';
  import { tour } from '../lib/tour.svelte';
  import { subAdjust } from '../lib/subadjust.svelte';
  import SubtitleList from './SubtitleList.svelte';

  const translateChoices = ['ask', ...AUTO_LANGS] as const;
  const styles: SubStyle[] = ['box', 'outline', 'shadow', 'contrast'];
  // Everyday switches stay in view; the rest waits under "More settings".
  const main = [
    ['pauseOnSave', 'settings.pauseOnSave'],
    ['hideSecondary', 'settings.hideSecondary'],
    ['colorWords', 'settings.colorWords'],
  ] as const;
  const more = [
    ['autoScroll', 'settings.autoScroll'],
    ['autoPause', 'settings.autoPause'],
  ] as const;
  const keys: [string, MessageKey][] = [
    ['Space', 'kbd.play'], ['← →', 'kbd.line'], ['R', 'kbd.loop'], ['F', 'kbd.full'], ['W', 'kbd.word'],
  ];
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
</script>

<div class="panel">
  <section>
    <h3>{t('subs.title')}</h3>
    <SubtitleList />
    <button class="adj" onclick={() => { subAdjust.on = true; document.querySelector('.stage')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }}>
      <span class="aa-ic" aria-hidden="true">Aa</span> {t('subadj.settings')}
    </button>
  </section>

  {#if SUBS_API_ENABLED}
    <section>
      <h3>{t('settings.autoTranslate')}</h3>
      <div class="chips" role="radiogroup" aria-label={t('settings.autoTranslate')}>
        {#each translateChoices as code}
          <label class="chip" class:on={app.settings.autoTranslate === code}>
            <input type="radio" name="autotranslate" checked={app.settings.autoTranslate === code} onchange={() => app.setSetting('autoTranslate', code)} />
            {code === 'ask' ? t('settings.autoTranslate.ask') : langName(code, i18n.locale)}
          </label>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    {#each main as [key, label]}
      <label class="toggle">
        <input type="checkbox" checked={app.settings[key]} onchange={(e) => app.setSetting(key, e.currentTarget.checked)} />
        <span>{t(label)}</span>
      </label>
    {/each}
  </section>

  <details class="more">
    <summary>{t('settings.more')}</summary>
    <div class="more-body">
      <section>
        <h3>{t('settings.subtitles')}</h3>
        <div class="preview {app.settings.subStyle}" style:--sub-size="{app.settings.subSize}px" style:--sub-bg={app.settings.subBg / 100} style:--sub-scale="0.8" aria-label={t('settings.preview')}>
          <span class="line">{t('settings.preview.text')}</span>
        </div>
        <label class="field">
          <span>{t('settings.size')} <output>{app.settings.subSize}px</output></span>
          <input type="range" min="14" max="48" value={app.settings.subSize} oninput={(e) => app.setSetting('subSize', +e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>{t('settings.bg')} <output>{app.settings.subBg}%</output></span>
          <input type="range" min="0" max="100" value={app.settings.subBg} oninput={(e) => app.setSetting('subBg', +e.currentTarget.value)} />
        </label>
        <div class="chips" role="radiogroup" aria-label={t('settings.style')}>
          {#each styles as s}
            <label class="chip" class:on={app.settings.subStyle === s}>
              <input type="radio" name="substyle" value={s} checked={app.settings.subStyle === s} onchange={() => app.setSetting('subStyle', s)} />
              {t(`settings.style.${s}`)}
            </label>
          {/each}
        </div>
      </section>

      <section>
        <h3>{t('settings.behavior')}</h3>
        {#if SUBS_API_ENABLED}
          <label class="toggle">
            <input type="checkbox" checked={app.settings.autoSubs} onchange={(e) => app.setSetting('autoSubs', e.currentTarget.checked)} />
            <span>{t('settings.autoSubs')}</span>
          </label>
        {/if}
        {#each more as [key, label]}
          <label class="toggle">
            <input type="checkbox" checked={app.settings[key]} onchange={(e) => app.setSetting(key, e.currentTarget.checked)} />
            <span>{t(label)}</span>
          </label>
        {/each}
      </section>

      {#if !touch}
        <section>
          <h3>{t('settings.shortcuts')}</h3>
          <dl class="keys">
            {#each keys as [k, label]}<div><dt><kbd>{k}</kbd></dt><dd>{t(label)}</dd></div>{/each}
          </dl>
        </section>
      {/if}
    </div>
  </details>

  <button class="tour" onclick={() => tour.start()}>✨ {t('tour.replay')}</button>
</div>

<style>
  .adj { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; margin-top: var(--space-2); font-weight: 700; justify-content: flex-start; }
  .aa-ic { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font: 800 0.8rem var(--font-display); }
  .panel { display: grid; gap: var(--space-4); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .more { border-top: 1px solid var(--line); padding-top: var(--space-2); }
  .more summary { cursor: pointer; font-weight: 800; min-height: 44px; display: flex; align-items: center; gap: 8px; list-style: none; }
  .more summary::-webkit-details-marker { display: none; }
  .more summary::before { content: '▸'; color: var(--accent); transition: transform 0.15s; }
  .more[open] summary::before { transform: rotate(90deg); }
  .more-body { display: grid; gap: var(--space-4); padding-top: var(--space-2); }
  .tour { justify-self: start; }
  h3 { font-size: 1rem; margin-bottom: var(--space-2); }
  section { display: grid; gap: var(--space-2); }
  .preview { background: #3a4a63 linear-gradient(135deg, #3a4a63, #7a5c8a); border-radius: var(--radius-sm); min-height: 84px; display: grid; place-items: end center; padding: var(--space-3); overflow: hidden; }
  .line { font-size: calc(var(--sub-size) * var(--sub-scale)); color: #fff; padding: 0.08em 0.55em; border-radius: 0.45em; line-height: 1.3; text-align: center; }
  .box .line { background: rgb(0 0 0 / var(--sub-bg)); text-shadow: 0 1px 2px #000; }
  .outline .line { paint-order: stroke fill; -webkit-text-stroke: 0.16em #000; text-shadow: 0 0 0.1em #000; }
  .shadow .line { text-shadow: 0 0 0.18em #000, 0 0.05em 0.12em #000, 0 0.08em 0.24em #000, 0 0 0.5em #000; }
  .contrast .line { background: #000; color: #ffe14a; font-weight: 700; }
  .field { display: grid; gap: 4px; }
  .field span { display: flex; justify-content: space-between; font-weight: 700; }
  .field output { color: var(--muted); font-weight: 400; }
  input[type='range'] { width: 100%; accent-color: var(--accent); min-height: 32px; }
  .chip { display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--space-4); border: 1.5px solid var(--line); border-radius: 99px; cursor: pointer; font-weight: 700; background: var(--surface); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chip input { position: absolute; opacity: 0; pointer-events: none; }
  .chip:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  .toggle { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; cursor: pointer; }
  .toggle input { width: 22px; height: 22px; accent-color: var(--accent); flex: none; }
  .keys { margin: 0; display: grid; gap: 6px; }
  .keys div { display: flex; gap: var(--space-3); align-items: baseline; }
  dt { min-width: 5.5rem; } dd { margin: 0; color: var(--muted); }
  kbd { font: 700 0.85rem var(--font-body); background: var(--surface-2); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; padding: 2px 8px; }
</style>
