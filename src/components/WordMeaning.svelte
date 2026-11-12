<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import { AUTO_LANGS } from '../lib/settings';
  import { defineWord, posKey, DefineError } from '../lib/words/define';
  import type { SavedWord } from '../lib/types';
  import type { MessageKey } from '../lib/i18n/tr';

  let { word }: { word: SavedWord } = $props();

  /** Languages a meaning can be shown in: our three, minus the word's own. */
  const langs = $derived(AUTO_LANGS.filter((l) => l !== word.lang));
  // Open on a meaning already saved, else on the language picked last time (loads right away), else ask.
  const initial = () => {
    const pref = app.settings.meaningLang;
    if (pref && word.meanings?.[pref]) return pref;
    const saved = langs.find((l) => word.meanings?.[l]);
    if (saved) return saved;
    return pref && pref !== word.lang ? pref : null;
  };
  let lang = $state<string | null>(initial());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let ctl: AbortController | null = null;

  const m = $derived(lang ? word.meanings?.[lang] : undefined);
  const others = $derived(m ? m.senses.filter((s) => !s.best) : []);
  const best = $derived(m?.senses.find((s) => s.best) ?? m?.senses[0]);
  const pos = (p: string) => { const k = posKey(p); return k ? t(k as MessageKey) : p; };

  async function load(to: string) {
    ctl?.abort();
    ctl = new AbortController();
    loading = true; error = null;
    try {
      const res = await defineWord({ word: word.w, lang: word.lang, to, ctx: word.ctx, signal: ctl.signal });
      app.setMeaning(word.id, to, res);
    } catch (e) {
      const code = e instanceof DefineError ? e.code : 'failed';
      if (code !== 'cancelled') error = t(`meaning.err.${code}` as MessageKey);
    } finally {
      loading = false;
    }
  }

  function choose(to: string) {
    error = null;
    lang = to; // the effect below fetches it if needed
    if (app.settings.meaningLang !== to) app.setSetting('meaningLang', to as (typeof AUTO_LANGS)[number]);
  }

  // Whenever the chosen language has no saved meaning yet (also when opening on the remembered one): fetch it.
  $effect(() => {
    const l = lang;
    if (l && !word.meanings?.[l]) untrack(() => { if (!loading && !error) void load(l); });
  });
  $effect(() => () => ctl?.abort());
</script>

<div class="meaning">
  <div class="head">
    <span class="q">{lang ? t('meaning.in') : t('meaning.ask')}</span>
    <div class="langs" role="group" aria-label={t('meaning.ask')}>
      {#each langs as l}
        <button class:on={lang === l} aria-pressed={lang === l} onclick={() => choose(l)} disabled={loading && lang === l}>{langName(l, i18n.locale)}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <p class="muted loading" role="status"><span class="spin" aria-hidden="true"></span>{t('meaning.loading')}</p>
  {:else if error}
    <p class="error" role="alert">{error} <button class="link" onclick={() => lang && load(lang)}>{t('meaning.retry')}</button></p>
  {:else if m && best}
    <div class="main">
      <div class="label">{t('meaning.here')}</div>
      <p class="answer" lang={lang ?? undefined}>{m.inContext}</p>
      <p class="sub muted">
        {#if m.lemma && m.lemma !== word.w}<span>{t('meaning.lemma')} <strong lang={word.lang}>{m.lemma}</strong></span>{/if}
        {#if best.pos}<span class="pos">{pos(best.pos)}</span>{/if}
        {#if best.en && best.en !== m.inContext}<span class="en" lang="en">{best.en}</span>{/if}
      </p>
      {#if best.example}<p class="ex" lang={word.lang}>“{best.example}”</p>{/if}
    </div>

    {#if others.length}
      <details class="more" open={others.length <= 4}>
        <summary>{t('meaning.others', { n: others.length })}</summary>
        <ol>
          {#each others as s}
            <li>
              <div><span class="pos">{pos(s.pos)}</span> <span lang={lang ?? undefined}>{s.meaning}</span>
                {#if s.head && s.head !== word.w && s.head !== m.lemma}<span class="muted small" lang={word.lang}>({s.head})</span>{/if}</div>
              {#if s.en && s.en !== s.meaning}<div class="en small" lang="en">{s.en}</div>{/if}
              {#if s.example}<div class="ex small" lang={word.lang}>“{s.example}”</div>{/if}
            </li>
          {/each}
        </ol>
      </details>
    {/if}

    <p class="source small" class:ai={m.source === 'ai'}>
      {m.source === 'ai' ? t('meaning.source.ai') : t(lang === 'en' ? 'meaning.source.dict.en' : 'meaning.source.dict')}
    </p>
  {/if}
</div>

<style>
  .meaning { display: grid; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--surface-2); }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); justify-content: space-between; }
  .q { font-size: 0.88rem; color: var(--muted); font-weight: 700; }
  .langs { display: flex; gap: 6px; flex-wrap: wrap; }
  .langs button { border-radius: 99px; min-height: 36px; padding: 0 14px; font-size: 0.88rem; }
  .langs button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .loading { display: flex; align-items: center; gap: 8px; margin: 0; }
  .spin { width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; }
  .error { color: var(--danger); font-weight: 700; margin: 0; }
  .link { all: unset; cursor: pointer; text-decoration: underline; color: var(--accent); font-weight: 700; margin-left: 6px; }
  .main { display: grid; gap: 2px; }
  .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .answer { margin: 0; font: 800 1.25rem var(--font-display); color: var(--accent); overflow-wrap: anywhere; }
  .sub { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.85rem; }
  .pos { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); vertical-align: 1px; }
  .en { font-style: italic; color: var(--muted); }
  .ex { margin: 2px 0 0; color: var(--muted); font-size: 0.88rem; }
  .more summary { cursor: pointer; font-weight: 700; font-size: 0.9rem; min-height: 36px; display: flex; align-items: center; gap: 6px; list-style: none; }
  .more summary::-webkit-details-marker { display: none; }
  .more summary::before { content: '▸'; color: var(--accent); transition: transform 0.15s; }
  .more[open] summary::before { transform: rotate(90deg); }
  ol { margin: 0; padding-left: 1.3rem; display: grid; gap: 8px; }
  .small { font-size: 0.8rem; }
  .source { margin: 0; color: var(--muted); }
  .source.ai { color: var(--danger); font-weight: 700; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
