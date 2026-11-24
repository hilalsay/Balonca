<script lang="ts">
  import Mascot from '../components/Mascot.svelte';
  import { account, AccountError } from '../lib/account.svelte';
  import { router } from '../lib/router.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import type { MessageKey } from '../lib/i18n/tr';

  /** login: e-mail + password; invite: sign up with the code from the link; reset: a new password from a reset link. */
  const mode = $derived(router.route === 'invite' ? 'invite' : router.route === 'reset' ? 'reset' : 'login');
  let email = $state('');
  let password = $state('');
  let invite = $state('');
  let show = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  $effect(() => { if (router.route === 'invite' && router.rest) invite = router.rest; });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      if (mode === 'login') await account.login(email.trim(), password);
      else if (mode === 'invite') await account.register(email.trim(), password, invite.trim());
      else await account.reset(router.rest, password);
      // Back to where the learner wanted to go (sign-in pages lead home).
      const back = sessionStorage.getItem('balonca.afterLogin');
      sessionStorage.removeItem('balonca.afterLogin');
      location.hash = back && !/#\/(giris|davet|sifre)/.test(back) ? back : '#/';
    } catch (err) {
      error = t(`auth.err.${err instanceof AccountError ? err.code : 'failed'}` as MessageKey);
    } finally { busy = false; }
  }
</script>

<section class="login">
  <Mascot size={72} />
  <h1>{t(mode === 'invite' ? 'auth.invite.title' : mode === 'reset' ? 'auth.reset.title' : 'auth.login.title')}</h1>
  <p class="muted">{t(mode === 'invite' ? 'auth.invite.lead' : mode === 'reset' ? 'auth.reset.lead' : 'auth.login.lead')}</p>

  <form class="card" onsubmit={submit}>
    {#if mode !== 'reset'}
      <label><span>{t('auth.email')}</span>
        <input type="email" bind:value={email} autocomplete="email" inputmode="email" required maxlength="254" /></label>
    {/if}
    <label><span>{t(mode === 'login' ? 'auth.password' : 'auth.newPassword')}</span>
      <span class="pw">
        <input type={show ? 'text' : 'password'} bind:value={password} required minlength={mode === 'login' ? 1 : 10} maxlength="200"
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'} />
        <button type="button" class="eye" onclick={() => (show = !show)} aria-pressed={show}>{show ? t('auth.hide') : t('auth.show')}</button>
      </span>
      {#if mode !== 'login'}<small class="muted">{t('auth.passwordHint')}</small>{/if}
    </label>
    {#if mode === 'invite'}
      <label><span>{t('auth.inviteCode')}</span>
        <input bind:value={invite} required maxlength="100" autocomplete="off" spellcheck="false" /></label>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary go" type="submit" disabled={busy}>
      {busy ? t('auth.wait') : t(mode === 'invite' ? 'auth.invite.go' : mode === 'reset' ? 'auth.reset.go' : 'auth.login.go')}
    </button>
  </form>

  {#if mode === 'login'}
    <p class="muted small">{t('auth.noAccount')}</p>
    <p class="muted small">{t('auth.forgot')}</p>
  {:else}
    <a href="#/giris">{t('auth.toLogin')}</a>
  {/if}
</section>

<style>
  .login { display: grid; justify-items: center; gap: var(--space-3); max-width: 420px; margin: var(--space-5) auto; text-align: center; }
  h1 { margin: 0; font-size: 1.8rem; }
  p { margin: 0; }
  form { display: grid; gap: var(--space-3); width: 100%; text-align: left; }
  label { display: grid; gap: 6px; font-weight: 700; }
  input { min-height: 50px; font-size: 1.05rem; padding: 0 14px; border-radius: var(--radius-sm); width: 100%; }
  .pw { display: flex; gap: 8px; }
  .pw input { flex: 1; min-width: 0; }
  .eye { min-height: 50px; min-width: 72px; border-radius: var(--radius-sm); font-weight: 700; }
  small { font-weight: 400; }
  .go { min-height: 54px; border-radius: 99px; font-weight: 800; font-size: 1.05rem; }
  .error { color: var(--danger); font-weight: 700; }
  .small { font-size: 0.92rem; max-width: 30rem; }
</style>
