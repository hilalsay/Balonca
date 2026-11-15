<script lang="ts">
  import { tokenize } from '../lib/words/tokenize';
  import { app } from '../lib/state.svelte';
  import { player } from '../lib/player/controller.svelte';
  import { wordPop } from '../lib/wordpop.svelte';

  let { text, lang, trans }: { text: string; lang: string; trans?: () => { lang: string; text: string }[] } = $props();
  const tokens = $derived(tokenize(text, lang));

  /** Tapping a word opens its card (meaning, save, "I know this"); a second tap on the same word closes it. */
  function open(e: MouseEvent, key: string, surface: string) {
    const el = e.currentTarget as HTMLElement;
    if (wordPop.cur?.anchor === el) { wordPop.close(); return; }
    const r = el.getBoundingClientRect();
    wordPop.open({
      lang, key, surface, ctx: text, trans: trans?.() ?? [], t: player.now(), anchor: el,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
    });
  }
  const status = (key: string) => (app.settings.colorWords || app.isSaved(lang, key) ? app.wordStatus(lang, key) : 'new');

  /** Arrow keys move between words; the event never reaches the global player shortcuts. */
  function onkeydown(e: KeyboardEvent) {
    const cur = (e.target as HTMLElement).closest('button.w');
    if (!cur || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const all = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button.w')];
    const next = all[all.indexOf(cur as HTMLButtonElement) + (e.key === 'ArrowRight' ? 1 : -1)];
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="wordrow" {lang} {onkeydown}>{#each tokens as tok}{#if tok.isWord}<button
        type="button"
        class="w"
        class:sv={status(tok.key) === 'learning'}
        class:kn={status(tok.key) === 'known'}
        class:open={wordPop.cur?.key === tok.key && wordPop.cur?.lang === lang && wordPop.cur?.ctx === text}
        tabindex="-1"
        aria-haspopup="dialog"
        onclick={(e) => open(e, tok.key, tok.text)}>{tok.text}</button>{:else}{tok.text}{/if}{/each}</span>

<style>
  .w {
    all: unset;
    display: inline;
    cursor: pointer;
    border-radius: 0.25em;
    padding: 0.12em 0.04em;
    margin: -0.12em 0;
    touch-action: manipulation;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .w:hover { background: var(--accent); color: var(--accent-ink); }
  .w:focus-visible { outline: 3px solid var(--pink); outline-offset: 1px; }
  .w.sv { text-decoration: underline wavy var(--pink); text-decoration-thickness: 1.5px; text-underline-offset: 0.22em; }
  .w.kn { opacity: 0.62; }
  .w.open { background: var(--accent); color: var(--accent-ink); opacity: 1; }
</style>
