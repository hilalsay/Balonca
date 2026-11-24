<script lang="ts">
  import ConfirmButton from '../ConfirmButton.svelte';
  import { app } from '../../lib/state.svelte';
  import { t, i18n } from '../../lib/i18n/index.svelte';
  import { LANGUAGES, langName } from '../../lib/languages';
  import { readUrl } from '../../lib/router.svelte';
  import { splitText, allSentences, guessLang, titleFrom } from '../../lib/read/text';
  import { nlpInfo } from '../../lib/read/api';
  import { speech } from '../../lib/read/speech.svelte';
  import { SAMPLES } from '../../lib/read/samples';
  import { tokenize } from '../../lib/words/tokenize';
  import { TEXT_LIMIT } from '../../lib/storage';

  let body = $state('');
  let title = $state('');
  let picked = $state<string | null>(null);
  let chooseLang = $state(false); // a sure guess shows one line; the choices open on request // a language the learner chose; otherwise the guess
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let area: HTMLTextAreaElement;

  const guess = $derived(guessLang(body));
  const lastLang = $derived(app.texts[0]?.lang ?? 'nl');
  const lang = $derived(picked ?? (guess || lastLang));
  const COMMON = ['nl', 'en', 'de', 'fr', 'es', 'tr'];
  const others = $derived(Object.keys(LANGUAGES).filter((c) => !COMMON.includes(c)).sort((a, b) => langName(a, i18n.locale).localeCompare(langName(b, i18n.locale), i18n.locale)));

  let grammarLangs = $state<string[]>([]);
  void nlpInfo().then((x) => (grammarLangs = x.parse));

  function start(e?: SubmitEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text) { error = t('read.add.empty'); area?.focus(); return; }
    if (!allSentences(splitText(text, lang)).length) { error = t('read.add.empty'); return; }
    const doc = app.addText({ title: title.trim() || titleFrom(text), lang, body: text });
    location.hash = readUrl(doc.id);
  }

  async function fromFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    if (f.size > TEXT_LIMIT * 4) { error = t('read.add.tooBig'); return; }
    const text = await f.text().catch(() => '');
    if (!text.trim()) { error = t('read.add.badFile'); return; }
    body = text.slice(0, TEXT_LIMIT);
    title = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120);
    picked = null;
    error = null;
  }

  function sample(code: string) {
    const s = SAMPLES[code];
    const have = app.texts.find((x) => x.body === s.body);
    location.hash = readUrl((have ?? app.addText({ title: s.title, lang: code, body: s.body })).id);
  }

  // Per text: sentences, progress and how many of its words are known (the same counting as the video bar).
  const stats = $derived(new Map(app.texts.map((d) => {
    const n = allSentences(splitText(d.body, d.lang)).length;
    const keys = new Set<string>();
    for (const tok of tokenize(d.body.slice(0, 20000), d.lang)) if (tok.isWord && /\p{L}/u.test(tok.key)) keys.add(tok.key);
    let kn = 0;
    for (const k of keys) if (app.wordStatus(d.lang, k) === 'known') kn++;
    return [d.id, { n, done: n ? Math.min(1, Math.max(d.done, d.pos + 1) / n) : 0, known: keys.size ? Math.round((kn / keys.size) * 100) : 0, words: keys.size }];
  })));
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(i18n.locale === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'short' });
</script>

<section class="intro">
  <h1>🎧 {t('read.title')}</h1>
  <p class="muted">{t('read.lead')}</p>
</section>

<div class="layout">
  <form class="card add" onsubmit={start}>
    <h2>{t('read.add.title')}</h2>
    <label class="sr-only" for="read-body">{t('read.add.body')}</label>
    <textarea id="read-body" bind:this={area} bind:value={body} rows="8" maxlength={TEXT_LIMIT} placeholder={t('read.add.placeholder')}
      oninput={() => (error = null)} lang={lang}></textarea>
    <div class="row small muted">
      <span>{body.length ? t('read.add.count', { n: body.trim().split(/\s+/).filter(Boolean).length }) : t('read.add.tip')}</span>
      <button type="button" class="link" onclick={() => fileInput.click()}>📄 {t('read.add.file')}</button>
      <input bind:this={fileInput} type="file" accept=".txt,text/plain" hidden onchange={fromFile} />
    </div>

    <fieldset class="langs">
      <legend>{t('read.add.lang')}{#if guess && !picked}<span class="guess"> · {t('read.add.guessed')}</span>{/if}</legend>
      {#if guess && !chooseLang}
        <p class="sure"><strong>{langName(lang, i18n.locale)} ✓</strong> <button type="button" class="link" onclick={() => (chooseLang = true)}>({t('read.add.change')})</button></p>
      {:else}
      <div class="chips">
        {#each COMMON as code}
          <label class="chip" class:on={lang === code}>
            <input type="radio" name="read-lang" checked={lang === code} onchange={() => (picked = code)} />{langName(code, i18n.locale)}
          </label>
        {/each}
        <select aria-label={t('read.add.otherLang')} value={COMMON.includes(lang) ? '' : lang} onchange={(e) => e.currentTarget.value && (picked = e.currentTarget.value)} class:on={!COMMON.includes(lang)}>
          <option value="">{t('read.add.otherLang')}…</option>
          {#each others as code}<option value={code}>{langName(code, i18n.locale)}</option>{/each}
        </select>
      </div>
      {/if}
      <p class="can small">
        <span class:yes={speech.canRead(lang)}>{speech.canRead(lang) ? '✓' : '✗'} {t('read.can.voice')}</span>
        <span class:yes={grammarLangs.includes(lang)}>{grammarLangs.includes(lang) ? '✓' : '✗'} {t('read.can.grammar')}</span>
        <span class="yes">✓ {t('read.can.words')}</span>
      </p>
    </fieldset>

    <details class="name">
      <summary>{t('read.add.name')} <span class="muted">({t('read.add.optional')})</span></summary>
      <input bind:value={title} maxlength="120" placeholder={body.trim() ? titleFrom(body) : t('read.add.namePh')} autocomplete="off" aria-label={t('read.add.name')} />
    </details>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary go" type="submit">{t('read.add.go')} →</button>

    <div class="samples">
      <span class="muted">{t('read.sample')}</span>
      {#each Object.keys(SAMPLES) as code}<button type="button" onclick={() => sample(code)}>✨ {langName(code, i18n.locale)}</button>{/each}
    </div>
  </form>

  <section class="list" aria-labelledby="my-texts">
    <h2 id="my-texts">{t('read.mine')} {#if app.texts.length}<span class="muted">({app.texts.length})</span>{/if}</h2>
    {#if !app.texts.length}
      <div class="card empty">
        <p class="big" aria-hidden="true">📚</p>
        <p class="muted">{t('read.mine.empty')}</p>
      </div>
    {:else}
      <ul>
        {#each app.texts as d (d.id)}
          {@const st = stats.get(d.id)}
          <li class="card item">
            <a href={readUrl(d.id)} class="open">
              <strong lang={d.lang}>{d.title || t('read.untitled')}</strong>
              <span class="meta muted">{langName(d.lang, i18n.locale)} · {t('read.sentences', { n: st?.n ?? 0 })}{#if st?.words} · {t('read.knownPct', { n: st.known })}{/if} · {fmtDate(d.opened)}</span>
              <span class="pbar" role="img" aria-label={t('read.progress', { n: Math.round((st?.done ?? 0) * 100) })}><span style:width="{(st?.done ?? 0) * 100}%"></span></span>
            </a>
            <ConfirmButton onconfirm={() => app.removeText(d.id)} label={t('read.remove', { title: d.title || t('read.untitled') })}>✕</ConfirmButton>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .sure { margin: 0; display: flex; gap: 8px; align-items: center; font-size: 1.05rem; }
  .name summary { cursor: pointer; font-weight: 700; min-height: 44px; display: flex; align-items: center; gap: 6px; }
  .name input { min-height: 44px; width: 100%; margin-top: 6px; }
  .chip { min-height: 44px; }
  .intro { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
  h1 { margin: 0; font-size: clamp(1.7rem, 5vw, 2.4rem); }
  .intro p { margin: 0; max-width: 44rem; font-size: 1.05rem; }
  .layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
  h2 { margin: 0; font-size: 1.2rem; }
  .add { display: grid; gap: var(--space-3); }
  textarea { width: 100%; min-height: 180px; resize: vertical; font-size: 1.02rem; line-height: 1.6; padding: 12px 14px; border-radius: var(--radius-sm); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: -6px; }
  .small { font-size: 0.86rem; }
  .link { all: unset; cursor: pointer; color: var(--accent); font-weight: 700; min-height: 44px; display: inline-flex; align-items: center; }
  .link:focus-visible { outline: 3px solid var(--focus); }
  fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
  legend { font-weight: 800; padding: 0; margin-bottom: 6px; }
  .guess { color: var(--good); font-weight: 700; font-size: 0.85rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border: 1.5px solid var(--line); border-radius: 99px; cursor: pointer; font-weight: 700; background: var(--surface); min-height: 44px; }
  .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chip input { position: absolute; opacity: 0; pointer-events: none; }
  .chip:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
  select { min-height: 44px; border-radius: 99px; padding: 0 12px; max-width: 12rem; }
  select.on { border-color: var(--accent); color: var(--accent); font-weight: 700; }
  .can { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0; color: var(--muted); }
  .can .yes { color: var(--good); font-weight: 700; }
  .go { min-height: 52px; border-radius: 99px; font-weight: 800; font-size: 1.05rem; }
  .error { margin: 0; color: var(--danger); font-weight: 700; }
  .samples { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border-top: 1px solid var(--line); padding-top: var(--space-3); font-size: 0.92rem; }
  .samples button { min-height: 44px; border-radius: 99px; padding: 0 14px; font-weight: 700; }
  .list { display: grid; gap: var(--space-3); }
  .list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); }
  .open { flex: 1; min-width: 0; display: grid; gap: 4px; text-decoration: none; color: var(--text); }
  .open strong { font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .open:hover strong { color: var(--accent); }
  .meta { font-size: 0.85rem; }
  .pbar { display: block; height: 6px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
  .pbar span { display: block; height: 100%; background: var(--accent); border-radius: 99px; }
  .empty { text-align: center; padding: var(--space-5) var(--space-4); }
  .empty p { margin: 0; }
  .big { font-size: 2rem; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
</style>
