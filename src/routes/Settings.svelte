<script lang="ts">
  import AccountBox from '../components/AccountBox.svelte';
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';
  import { AUTO_LANGS, translationLang, type AutoLang, type Settings } from '../lib/settings';
  import { langName } from '../lib/languages';
  import { tour } from '../lib/tour.svelte';

  const sizes = ['normal', 'large', 'xlarge'] as const;
  const themes = ['auto', 'light', 'dark'] as const;
  const lang = $derived(translationLang(app.settings));
  const toggles: [keyof Settings, MessageKey][] = [
    ['pauseOnSave', 'settings.pauseOnSave'], ['colorWords', 'settings.colorWords'], ['autoScroll', 'settings.autoScroll'],
    ['autoPause', 'settings.autoPause'], ['hideSecondary', 'settings.hideSecondary'],
  ];
  /** "Ask every video" on: autoTranslate = 'ask'; off: subtitles go straight into the translation language. */
  function setAsk(on: boolean) { app.setSetting('autoTranslate', on ? 'ask' : ((lang || 'tr') as AutoLang)); }
  function setSplit(on: boolean) {
    app.setSetting('separateMeaning', on);
    if (!on && lang) app.setSetting('meaningLang', lang as AutoLang); // back together
  }
</script>

<h1>{t('settings.page')}</h1>

<section class="card" aria-labelledby="basic">
  <h2 id="basic">{t('settings.basic')}</h2>

  <div class="row">
    <h3>{t('settings.fontScale')}</h3>
    <div class="chips" role="radiogroup" aria-label={t('settings.fontScale')}>
      {#each sizes as s}
        <button role="radio" aria-checked={app.settings.fontScale === s} class:on={app.settings.fontScale === s} onclick={() => { app.setSetting('fontScale', s); app.setSetting('fontAsked', true); }}>
          <span class="aa {s}" aria-hidden="true">A</span> {t(`settings.font.${s}` as MessageKey)}
        </button>
      {/each}
    </div>
  </div>

  <div class="row">
    <h3>{t('settings.transLang')}</h3>
    <p class="muted note">{t('settings.transLang.d')}</p>
    <div class="chips" role="radiogroup" aria-label={t('settings.transLang')}>
      {#each AUTO_LANGS as l}
        <button role="radio" aria-checked={lang === l} class:on={lang === l} onclick={() => app.setTranslationLang(l)}>{langName(l, i18n.locale)}</button>
      {/each}
    </div>
  </div>

  <div class="row">
    <h3>{t('settings.look')}</h3>
    <div class="chips" role="radiogroup" aria-label={t('settings.look')}>
      {#each themes as th}
        <button role="radio" aria-checked={app.settings.theme === th} class:on={app.settings.theme === th} onclick={() => app.setSetting('theme', th)}>{t(`settings.look.${th}` as MessageKey)}</button>
      {/each}
    </div>
  </div>

  <div class="row">
    <h3>{t('settings.uiLang')}</h3>
    <div class="chips" role="radiogroup" aria-label={t('settings.uiLang')}>
      <button role="radio" aria-checked={app.settings.locale === 'tr'} class:on={app.settings.locale === 'tr'} onclick={() => app.setSetting('locale', 'tr')}>Türkçe</button>
      <button role="radio" aria-checked={app.settings.locale === 'en'} class:on={app.settings.locale === 'en'} onclick={() => app.setSetting('locale', 'en')}>English</button>
    </div>
  </div>

  <div class="row">
    <h3>{t('settings.voice')}</h3>
    <div class="chips" role="radiogroup" aria-label={t('settings.voice')}>
      <button role="radio" aria-checked={app.settings.readEngine !== 'device'} class:on={app.settings.readEngine !== 'device'} onclick={() => app.setSetting('readEngine', 'auto')}>{t('read.set.voice.server')}</button>
      <button role="radio" aria-checked={app.settings.readEngine === 'device'} class:on={app.settings.readEngine === 'device'} onclick={() => app.setSetting('readEngine', 'device')}>{t('read.set.voice.device')}</button>
    </div>
  </div>
</section>

<details class="card adv">
  <summary><h2>{t('settings.advanced')}</h2></summary>
  <div class="adv-body">
    <label class="toggle">
      <input type="checkbox" checked={app.settings.autoTranslate === 'ask'} onchange={(e) => setAsk(e.currentTarget.checked)} />
      <span><strong>{t('settings.askEach')}</strong><small class="muted">{t('settings.askEach.d')}</small></span>
    </label>
    <label class="toggle">
      <input type="checkbox" checked={app.settings.separateMeaning} onchange={(e) => setSplit(e.currentTarget.checked)} />
      <span><strong>{t('settings.split')}</strong><small class="muted">{t('settings.split.d')}</small></span>
    </label>
    {#if app.settings.separateMeaning}
      <div class="chips sub" role="radiogroup" aria-label={t('settings.meaningLang')}>
        <span class="muted">{t('settings.meaningLang')}:</span>
        {#each AUTO_LANGS as l}
          <button role="radio" aria-checked={app.settings.meaningLang === l} class:on={app.settings.meaningLang === l} onclick={() => app.setSetting('meaningLang', l)}>{langName(l, i18n.locale)}</button>
        {/each}
      </div>
    {/if}
    {#each toggles as [key, label]}
      <label class="toggle">
        <input type="checkbox" checked={app.settings[key] as boolean} onchange={(e) => app.setSetting(key, e.currentTarget.checked as never)} />
        <span><strong>{t(label)}</strong></span>
      </label>
    {/each}
    <p class="muted note">{t('settings.videoMore')}</p>
  </div>
</details>

<AccountBox />

<section class="card links">
  <a href="#/help">❓ {t('settings.toHelp')}</a>
  <button onclick={() => tour.start()}>✨ {t('tour.button')}</button>
</section>

<style>
  h1 { margin: 0 0 var(--space-3); }
  .card { display: grid; gap: var(--space-4); margin-bottom: var(--space-4); }
  h2 { margin: 0; font-size: 1.2rem; }
  h3 { margin: 0; font-size: 1rem; }
  .row { display: grid; gap: 8px; }
  .note { margin: 0; font-size: 0.9rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .chips button { min-height: 48px; padding: 0 18px; border-radius: 99px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
  .chips .on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .aa { font: 800 1rem var(--font-display); }
  .aa.large { font-size: 1.2rem; } .aa.xlarge { font-size: 1.45rem; }
  .adv summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; min-height: 44px; }
  .adv summary::before { content: '▸'; color: var(--accent); transition: transform 0.15s; }
  .adv[open] summary::before { transform: rotate(90deg); }
  .adv summary::-webkit-details-marker { display: none; }
  .adv-body { display: grid; gap: var(--space-3); margin-top: var(--space-3); }
  .toggle { display: flex; gap: var(--space-3); align-items: flex-start; cursor: pointer; min-height: 44px; }
  .toggle input { width: 24px; height: 24px; margin-top: 2px; accent-color: var(--accent); flex: none; }
  .toggle span { display: grid; gap: 2px; }
  .toggle small { font-size: 0.88rem; }
  .sub { padding-left: 36px; }
  .links { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
  .links a, .links button { min-height: 48px; display: inline-flex; align-items: center; padding: 0 18px; border-radius: 99px; font-weight: 700; text-decoration: none; border: 1.5px solid var(--line); }
</style>
