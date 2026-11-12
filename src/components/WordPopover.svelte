<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { wordPop } from '../lib/wordpop.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import { langName } from '../lib/languages';
  import { AUTO_LANGS, type AutoLang } from '../lib/settings';
  import { defineWord, posKey, DefineError, DEFINE_ENABLED } from '../lib/words/define';
  import { wordId } from '../lib/words/bags';
  import type { WordMeaning } from '../lib/types';
  import type { MessageKey } from '../lib/i18n/tr';

  /** Rendered twice: in the page, and inside the player for real fullscreen. Only one shows at a time. */
  let { where }: { where: 'page' | 'stage' } = $props();

  /** The page copy lives in <body>: a transformed ancestor (the page-enter animation) would trap position: fixed. */
  function portal(node: HTMLElement) {
    if (where === 'page') document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  // Meanings of words that are not saved (yet) live only for this visit.
  const memo = new Map<string, WordMeaning>();

  const w = $derived(wordPop.cur && (where === 'stage') === wordPop.fullscreen ? wordPop.cur : null);
  const saved = $derived(w ? app.wordById.get(wordId(w.lang, w.key)) : undefined);
  const status = $derived(w ? app.wordStatus(w.lang, w.key) : 'new');
  const known = $derived(w ? app.isKnown(w.lang, w.key) : false);
  const langs = $derived(w ? AUTO_LANGS.filter((l) => l !== w.lang) : []);
  const to = $derived(w && app.settings.meaningLang && app.settings.meaningLang !== w.lang ? app.settings.meaningLang : null);

  let meaning = $state<WordMeaning | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let card: HTMLDivElement | undefined = $state();
  let ctl: AbortController | null = null;
  let retry = $state(0);

  const memoKey = (x: { lang: string; key: string; ctx: string }, lang: string) => `${x.lang}:${x.key}:${lang}:${x.ctx}`;

  // Look the word up whenever another word opens or the meaning language changes.
  $effect(() => {
    const cur = w, lang = to, have = saved?.meanings?.[lang ?? ''];
    void retry;
    ctl?.abort();
    error = null;
    const ready = have ?? (cur && lang ? memo.get(memoKey(cur, lang)) ?? null : null);
    meaning = ready;
    if (!cur || !lang || ready || !DEFINE_ENABLED) { loading = false; return; }
    const c = (ctl = new AbortController());
    loading = true;
    defineWord({ word: cur.key, lang: cur.lang, to: lang, ctx: cur.ctx, signal: c.signal })
      .then((m) => {
        if (!m.temporary) memo.set(memoKey(cur, lang), m);
        if (c.signal.aborted) return;
        meaning = m;
        const s = app.wordById.get(wordId(cur.lang, cur.key));
        if (s && !s.meanings?.[lang]) app.setMeaning(s.id, lang, m);
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        error = t(`meaning.err.${e instanceof DefineError ? e.code : 'failed'}` as MessageKey);
      })
      .finally(() => { if (!c.signal.aborted) loading = false; });
    return () => c.abort();
  });

  // Keyboard users land in the card; Escape or a click outside closes it.
  $effect(() => { if (w) void tick().then(() => card?.querySelector<HTMLElement>('.actions button')?.focus({ preventScroll: true })); });

  function onkey(e: KeyboardEvent) {
    if (w && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); wordPop.close(); }
  }
  function onpointer(e: PointerEvent) {
    if (!w || !card) return;
    const el = e.target as HTMLElement;
    if (card.contains(el) || el.closest('button.w')) return; // another word opens its own card
    wordPop.close();
  }

  function toggleSave() {
    if (!w) return;
    const added = app.toggleWord({ lang: w.lang, word: w.surface, ctx: w.ctx, trans: w.trans, t: w.t });
    if (added && meaning && to) app.setMeaning(wordId(w.lang, w.key), to, meaning);
    if (added && known) app.setKnown(w.lang, w.key, false); // in the bag now, so it is being learned
  }

  const pos = (p: string) => { const k = posKey(p); return k ? t(k as MessageKey) : p; };
  const others = $derived(meaning ? meaning.senses.filter((s) => !s.best).slice(0, 3) : []);
  const best = $derived(meaning?.senses.find((s) => s.best) ?? meaning?.senses[0]);

  // Next to the word on wide screens (above it when there is room), a bottom sheet on phones.
  const W = 320;
  const place = $derived.by(() => {
    if (!w) return '';
    const vw = innerWidth, vh = innerHeight, r = w.rect;
    if (vw < 600) return 'left:0;right:0;bottom:0;';
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), vw - W - 8);
    return r.top > 300 ? `left:${left}px;bottom:${vh - r.top + 10}px;` : `left:${left}px;top:${r.bottom + 10}px;`;
  });
</script>

<svelte:window onkeydown={onkey} onpointerdown={onpointer} onresize={() => wordPop.close({ keepPaused: true })} />

{#if w}
  <div class="pop" class:sheet={place.startsWith('left:0')} use:portal bind:this={card} role="dialog" aria-label={t('pop.label', { word: w.surface })} style={place}>
    <div class="hd">
      <strong class="word" lang={w.lang}>{w.surface}</strong>
      {#if meaning?.lemma && meaning.lemma !== w.key}<span class="lemma" lang={w.lang}>→ {meaning.lemma}</span>{/if}
      <span class="st {status}">{t(`pop.status.${status}` as MessageKey)}</span>
      <button class="x" onclick={() => wordPop.close()} aria-label={t('common.close')}>✕</button>
    </div>

    {#if DEFINE_ENABLED}
      {#if !to}
        <p class="q">{t('meaning.ask')}</p>
        <div class="langs">
          {#each langs as l}<button onclick={() => app.setSetting('meaningLang', l as AutoLang)}>{langName(l, i18n.locale)}</button>{/each}
        </div>
      {:else if loading}
        <p class="muted loading" role="status"><span class="spin" aria-hidden="true"></span>{t('meaning.loading')}</p>
      {:else if error}
        <p class="error" role="alert">{error}</p>
      {:else if meaning && best}
        <p class="ans" lang={to}>{meaning.inContext}</p>
        <p class="meta">
          {#if best.pos}<span class="pos">{pos(best.pos)}</span>{/if}
          {#if best.en && best.en !== meaning.inContext}<span class="en" lang="en">{best.en}</span>{/if}
        </p>
        {#if others.length}<p class="others"><span class="muted">{t('pop.also')}</span> <span lang={to}>{others.map((s) => s.meaning).join(' · ')}</span></p>{/if}
        {#if meaning.temporary}<p class="warn">{t('pop.temporary')} <button class="link" onclick={() => { if (w && to) memo.delete(memoKey(w, to)); retry++; }}>{t('meaning.retry')}</button></p>
        {:else if meaning.source === 'ai'}<p class="warn">{t('pop.ai')}</p>{/if}
      {/if}
      {#if to && langs.length > 1}
        <div class="switch">
          {#each langs.filter((l) => l !== to) as l}
            <button class="link" onclick={() => app.setSetting('meaningLang', l as AutoLang)}>{t('pop.showIn', { lang: langName(l, i18n.locale) })}</button>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="actions">
      <button class:primary={!saved} class:done={!!saved} onclick={toggleSave} aria-pressed={!!saved}>
        {saved ? `✓ ${t('pop.saved')}` : `＋ ${t('pop.save')}`}
      </button>
      {#if !saved}
        <button class:done={known} onclick={() => app.setKnown(w.lang, w.key, !known)} aria-pressed={known}>
          {known ? `✓ ${t('pop.known')}` : t('pop.know')}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pop {
    position: fixed; z-index: 300; width: 320px; max-width: calc(100vw - 16px);
    display: grid; gap: 6px; padding: var(--space-3) var(--space-3) var(--space-3);
    background: var(--surface); color: var(--text); border: 1.5px solid var(--accent-soft); border-radius: var(--radius);
    box-shadow: 0 12px 40px rgb(20 10 50 / 0.28); font-size: 0.95rem; line-height: 1.4; text-align: left;
    animation: rise 0.14s ease-out;
  }
  .pop.sheet { width: auto; max-width: none; border-radius: 22px 22px 0 0; border: 0; padding: 22px var(--space-4) max(var(--space-4), env(safe-area-inset-bottom));
    box-shadow: 0 -10px 40px rgb(20 10 50 / 0.25); animation: sheet 0.2s ease-out; }
  .pop.sheet::before { content: ''; position: absolute; top: 8px; left: 50%; width: 40px; height: 5px; margin-left: -20px; border-radius: 99px; background: var(--line); }
  .pop.sheet .word { font-size: 1.5rem; }
  .pop.sheet .ans { font-size: 1.3rem; }
  .pop.sheet .actions button { min-height: 50px; font-size: 1rem; border-radius: 14px; }
  @keyframes sheet { from { transform: translateY(100%); } }
  .hd { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding-right: 36px; position: relative; }
  .word { font: 800 1.3rem var(--font-display); }
  .lemma { color: var(--muted); font-weight: 700; }
  .st { font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
  .st.learning { background: color-mix(in srgb, var(--pink) 22%, transparent); color: var(--text); }
  .st.known { background: color-mix(in srgb, var(--good) 15%, transparent); color: var(--good); }
  .x { position: absolute; right: -6px; top: -6px; min-width: 36px; min-height: 36px; padding: 0; border: 0; background: none; color: var(--muted); }
  .q { margin: 0; font-size: 0.88rem; color: var(--muted); font-weight: 700; }
  .langs, .actions, .switch { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .langs button { border-radius: 99px; min-height: 36px; padding: 0 14px; }
  .loading { display: flex; align-items: center; gap: 8px; margin: 0; }
  .spin { width: 1rem; height: 1rem; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.9s linear infinite; }
  .error { margin: 0; color: var(--danger); font-weight: 700; font-size: 0.9rem; }
  .ans { margin: 0; font: 800 1.15rem var(--font-display); color: var(--accent); overflow-wrap: anywhere; }
  .meta { margin: 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 0.85rem; }
  .pos { font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); }
  .en { font-style: italic; color: var(--muted); }
  .others { margin: 0; font-size: 0.88rem; }
  .warn { margin: 0; font-size: 0.8rem; color: var(--danger); }
  .link { all: unset; cursor: pointer; font-size: 0.82rem; color: var(--accent); text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--focus); }
  .actions { margin-top: 4px; }
  .actions button { flex: 1; min-height: 42px; font-weight: 800; }
  .actions .done { background: color-mix(in srgb, var(--good) 14%, var(--surface)); border-color: var(--good); color: var(--good); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes rise { from { opacity: 0; transform: translateY(4px); } }
  @media (prefers-reduced-motion: reduce) { .pop, .spin { animation: none; } }
</style>
