<script lang="ts">
  import Mascot from '../components/Mascot.svelte';
  import { account, AccountError, BASE, type AuthError } from '../lib/account.svelte';
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
  // Back from Google with a problem (#/giris?hata=…): say it once.
  const GOOGLE_ERRORS: AuthError[] = ['need-invite', 'google-failed', 'google-cancelled', 'bad-login', 'bad-invite', 'rate-limit'];
  $effect(() => {
    const h = router.params.get('hata') as AuthError | null;
    if (h) error = t(`auth.err.${GOOGLE_ERRORS.includes(h) ? h : 'failed'}` as MessageKey);
  });
  const googleHref = $derived(`${BASE}/auth/google/start${mode === 'invite' && invite.trim() ? `?invite=${encodeURIComponent(invite.trim())}` : ''}`);

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

  {#if account.google && mode !== 'reset'}
    <!-- A plain link: the whole page goes to Google and comes back signed in. -->
    <a class="google" href={googleHref}>
      <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6C6.6 42.6 14.6 48 24 48z"/></svg>
      {t('auth.google')}
    </a>
    <p class="or muted">{t('auth.or')}</p>
  {/if}

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
  .google { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 54px; border-radius: 99px;
    border: 2px solid var(--line); background: var(--surface); color: inherit; font-weight: 800;
    font-size: 1.05rem; text-decoration: none; }
  .google:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .or { font-weight: 700; }
  .error { color: var(--danger); font-weight: 700; }
  .small { font-size: 0.92rem; max-width: 30rem; }
</style>
