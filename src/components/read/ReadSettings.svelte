<script lang="ts">
  import { app } from '../../lib/state.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { speech } from '../../lib/read/speech.svelte';
  import type { Settings } from '../../lib/settings';

  /** `sample`: a sentence of the open text, to try a voice with. */
  let { lang, sample, doc, onclose }: { lang: string; sample: string; doc: string; onclose: () => void } = $props();

  const server = $derived(speech.serverLangs.includes(lang));
  const deviceVoices = $derived(speech.deviceVoices(lang));
  const engine = $derived(speech.engineFor(lang));
  const RATES = [0.6, 0.8, 1, 1.2];
  const toggles: [keyof Settings, 'read.set.trans' | 'read.set.hide' | 'read.set.loop' | 'settings.colorWords' | 'settings.pauseOnSave', 'read.set.trans.d' | 'read.set.hide.d' | 'read.set.loop.d' | null][] = [
    ['readTrans', 'read.set.trans', 'read.set.trans.d'],
    ['readHide', 'read.set.hide', 'read.set.hide.d'],
    ['readLoop', 'read.set.loop', 'read.set.loop.d'],
    ['colorWords', 'settings.colorWords', null],
    ['pauseOnSave', 'settings.pauseOnSave', null],
  ];
  const setVoice = (uri: string) => app.setSetting('readVoices', { ...app.settings.readVoices, [lang]: uri });
  let dialog: HTMLDivElement;
  $effect(() => { dialog?.querySelector<HTMLElement>('button')?.focus(); });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onclose(); } }} />

<div class="scrim" onclick={onclose} aria-hidden="true"></div>
<div class="rs" role="dialog" aria-modal="true" aria-labelledby="rs-title" bind:this={dialog}>
  <header>
    <h3 id="rs-title">{t('read.settings')}</h3>
    <button class="x" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>
  <div class="body">
    <section>
      <h4>{t('read.set.voice')}</h4>
      <div class="seg" role="radiogroup" aria-label={t('read.set.voice')}>
        <button role="radio" aria-checked={app.settings.readEngine !== 'device'} class:on={app.settings.readEngine !== 'device'} disabled={!server}
          onclick={() => app.setSetting('readEngine', 'auto')}>{t('read.set.voice.server')}</button>
        <button role="radio" aria-checked={app.settings.readEngine === 'device'} class:on={app.settings.readEngine === 'device'} disabled={!deviceVoices.length}
          onclick={() => app.setSetting('readEngine', 'device')}>{t('read.set.voice.device')}</button>
      </div>
      {#if !server && !deviceVoices.length}<p class="warn">{t('read.noVoice')}</p>
      {:else if !server}<p class="muted small">{t('read.set.voice.noServer')}</p>
      {:else if !deviceVoices.length}<p class="muted small">{t('read.set.voice.noDevice')}</p>{/if}
      {#if engine === 'device' && deviceVoices.length > 1}
        <label class="field"><span>{t('read.set.voice.pick')}</span>
          <select value={speech.deviceVoice(lang)?.voiceURI} onchange={(e) => setVoice(e.currentTarget.value)}>
            {#each deviceVoices as v}<option value={v.voiceURI}>{v.name} ({v.lang})</option>{/each}
          </select>
        </label>
      {/if}
      {#if engine}<button class="try" onclick={() => speech.say(lang, sample, { src: { lib: doc, text: sample } })}>🔊 {t('read.set.try')}</button>{/if}
    </section>

    <section>
      <h4>{t('read.set.rate')} <output>{app.settings.readRate.toFixed(1)}×</output></h4>
      <div class="chips">
        {#each RATES as r}<button class:on={Math.abs(app.settings.readRate - r) < 0.01} onclick={() => app.setSetting('readRate', r)}>{r === 1 ? t('read.set.rate.normal') : `${r}×`}</button>{/each}
      </div>
    </section>

    <section>
      <h4>{t('read.set.size')} <output>{app.settings.readSize}px</output></h4>
      <div class="chips">
        <button onclick={() => app.setSetting('readSize', Math.max(14, app.settings.readSize - 2))} aria-label={t('read.set.smaller')}>A−</button>
        <button onclick={() => app.setSetting('readSize', Math.min(34, app.settings.readSize + 2))} aria-label={t('read.set.bigger')}>A+</button>
      </div>
    </section>

    <section class="toggles">
      {#each toggles as [key, label, desc]}
        <label class="toggle">
          <input type="checkbox" checked={app.settings[key] as boolean} onchange={(e) => app.setSetting(key, e.currentTarget.checked as never)} />
          <span><strong>{t(label)}</strong>{#if desc}<small class="muted">{t(desc)}</small>{/if}</span>
        </label>
      {/each}
    </section>

    {#if !app.settings.readHint}<button class="link" onclick={() => { app.setSetting('readHint', true); onclose(); }}>💡 {t('read.hint.again')}</button>{/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 250; background: rgb(10 5 30 / 0.35); }
  .rs { position: fixed; z-index: 260; right: 16px; top: 72px; width: min(400px, calc(100vw - 32px)); max-height: calc(100dvh - 96px);
    display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius); box-shadow: 0 20px 50px rgb(20 10 50 / 0.3); padding: var(--space-3) var(--space-4); }
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
  h3 { margin: 0; font-size: 1.1rem; }
  .x { min-width: 40px; min-height: 40px; border: 0; background: none; color: var(--muted); }
  .body { overflow-y: auto; overscroll-behavior: contain; display: grid; gap: var(--space-4); padding: var(--space-3) 0 var(--space-2); }
  section { display: grid; gap: 8px; }
  h4 { margin: 0; font-size: 0.95rem; display: flex; justify-content: space-between; }
  output { color: var(--muted); font-weight: 400; }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .seg button, .chips button { min-height: 44px; border-radius: 12px; font-weight: 700; }
  .seg .on, .chips .on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chips button { min-width: 56px; }
  .field { display: grid; gap: 4px; font-size: 0.9rem; font-weight: 700; }
  .try { justify-self: start; border-radius: 99px; min-height: 40px; }
  .small { margin: 0; font-size: 0.85rem; }
  .warn { margin: 0; color: var(--danger); font-weight: 700; font-size: 0.9rem; }
  .toggle { display: flex; gap: var(--space-3); align-items: flex-start; cursor: pointer; min-height: 44px; }
  .toggle input { width: 22px; height: 22px; margin-top: 2px; accent-color: var(--accent); flex: none; }
  .toggle span { display: grid; gap: 2px; }
  .toggle small { font-size: 0.82rem; }
  .link { all: unset; cursor: pointer; color: var(--accent); font-weight: 700; justify-self: start; }
  @media (max-width: 760px) {
    .rs { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 85dvh; border-radius: 22px 22px 0 0;
      padding-bottom: max(var(--space-3), env(safe-area-inset-bottom)); }
  }
</style>
