<script lang="ts">
  import { account, AccountError } from '../lib/account.svelte';
  import { sync } from '../lib/sync.svelte';
  import { app } from '../lib/state.svelte';
  import { t, i18n } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';

  let current = $state(''), next = $state(''), msg = $state<string | null>(null), err = $state<string | null>(null), open = $state(false);
  async function change(e: SubmitEvent) {
    e.preventDefault(); msg = err = null;
    try { await account.changePassword(current, next); msg = t('account.saved'); current = next = ''; open = false; }
    catch (x) { err = t(`auth.err.${x instanceof AccountError ? x.code : 'failed'}` as MessageKey); }
  }
  // Deleting the account: a backup file of this device is saved first, then everything goes (server and device).
  let delOpen = $state(false), confirm = $state(''), delBusy = $state(false), delErr = $state<string | null>(null);
  async function remove(e: SubmitEvent) {
    e.preventDefault(); delErr = null; delBusy = true;
    try {
      try {
        const blob = await app.exportAll();
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `balonca-yedek-${new Date().toISOString().slice(0, 10)}.json` });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { /* no backup possible: the account is still deleted as asked */ }
      await account.deleteAccount(confirm.trim());
      await app.wipeLocal();
      location.hash = '#/giris';
    } catch (x) { delErr = t(`auth.err.${x instanceof AccountError ? x.code : 'failed'}` as MessageKey); }
    finally { delBusy = false; }
  }
  const time = (ms: number) => new Date(ms).toLocaleTimeString(i18n.locale === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
</script>

{#if account.status === 'in' && account.me}
  <section class="card acc" aria-labelledby="acc-title">
    <h2 id="acc-title">{t('account.title')}</h2>
    <p>{t('account.signedIn', { email: account.me.email })}</p>
    <p class="muted">{sync.state === 'error' ? t('account.syncErr') : sync.lastAt ? t('account.synced', { time: time(sync.lastAt) }) : t('account.sync')}</p>
    <div class="row">
      <button onclick={() => sync.run()} disabled={sync.state === 'busy'}>{t('account.syncNow')}</button>
      <button onclick={() => (open = !open)} aria-expanded={open}>{t('account.changePw')}</button>
      <button onclick={() => account.logout()}>{t('account.logout')}</button>
    </div>
    {#if open}
      <form onsubmit={change}>
        <label><span>{t('account.current')}</span><input type="password" bind:value={current} autocomplete="current-password" required /></label>
        <label><span>{t('auth.newPassword')}</span><input type="password" bind:value={next} autocomplete="new-password" minlength="10" required /></label>
        <button class="primary" type="submit">{t('auth.reset.go')}</button>
      </form>
    {/if}
    {#if msg}<p class="ok" role="status">{msg}</p>{/if}
    {#if err}<p class="err" role="alert">{err}</p>{/if}
    <details class="del" bind:open={delOpen}>
      <summary>{t('account.delete')}</summary>
      <form onsubmit={remove}>
        <p>{t('account.delete.lead')}</p>
        <label><span>{t('account.delete.confirm', { email: account.me.email })}</span>
          <input type="email" bind:value={confirm} autocomplete="off" required /></label>
        {#if delErr}<p class="err" role="alert">{delErr}</p>{/if}
        <button class="danger" type="submit" disabled={delBusy || confirm.trim().toLowerCase() !== account.me.email.toLowerCase()}>{delBusy ? t('auth.wait') : t('account.delete.go')}</button>
      </form>
    </details>
  </section>
{/if}

<style>
  .acc { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
  h2, p { margin: 0; }
  .row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .row button, form button { min-height: 44px; border-radius: 99px; padding: 0 16px; font-weight: 700; }
  form { display: grid; gap: var(--space-2); max-width: 26rem; }
  label { display: grid; gap: 4px; font-weight: 700; }
  input { min-height: 46px; }
  .del summary { cursor: pointer; font-weight: 700; color: var(--danger); min-height: 44px; display: flex; align-items: center; }
  .danger { background: var(--danger); color: #fff; border: 0; }
  .danger:disabled { opacity: 0.5; }
  .ok { color: var(--good); font-weight: 700; } .err { color: var(--danger); font-weight: 700; }
</style>
