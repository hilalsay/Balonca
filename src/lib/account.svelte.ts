/**
 * The signed-in account. The server says whether accounts are on: /api/me answers 200 (signed in),
 * 401 (accounts on, signed out) or 404 (no accounts: the app works locally as before).
 */
export const BASE = (import.meta.env.VITE_SUBS_API as string | undefined) ?? '/api';

export interface Me { email: string; displayName: string | null; isAdmin: boolean }
export type AccountStatus = 'unknown' | 'off' | 'out' | 'in';
export type AuthError = 'bad-login' | 'bad-email' | 'short-password' | 'bad-invite' | 'email-taken' | 'bad-reset' | 'rate-limit' | 'network' | 'failed'
  | 'need-invite' | 'google-failed' | 'google-cancelled'; // the last three come back from Google in the address (?hata=)

class Account {
  status = $state<AccountStatus>('unknown');
  me = $state<Me | null>(null);
  /** The server offers "Continue with Google". */
  google = $state(false);

  async check() {
    try {
      const r = await fetch(`${BASE}/me`, { headers: { accept: 'application/json' } });
      if (r.ok) { this.me = await r.json(); this.status = 'in'; }
      else if (r.status === 401) {
        this.google = !!((await r.json().catch(() => null)) as { google?: boolean } | null)?.google;
        this.me = null; this.status = 'out';
      }
      else this.status = 'off'; // no account service (or not reachable): the app works on this device only
    } catch { this.status = 'off'; }
    return this.status;
  }

  private async post(path: string, body: unknown): Promise<Me | { ok: true }> {
    let r: Response;
    try {
      r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new AccountError('network'); }
    const j = (await r.json().catch(() => null)) as (Me & { error?: string }) | null;
    if (!r.ok) {
      const known: AuthError[] = ['bad-login', 'bad-email', 'short-password', 'bad-invite', 'email-taken', 'bad-reset', 'rate-limit'];
      throw new AccountError(known.includes(j?.error as AuthError) ? (j!.error as AuthError) : 'failed');
    }
    return j as Me;
  }

  async login(email: string, password: string) { this.signedIn(await this.post('/auth/login', { email, password }) as Me); }
  async register(email: string, password: string, invite: string) { this.signedIn(await this.post('/auth/register', { email, password, invite }) as Me); }
  async reset(token: string, password: string) { this.signedIn(await this.post('/auth/reset', { token, password }) as Me); }
  async changePassword(current: string, password: string) { await this.post('/auth/password', { current, password }); }
  async logout() {
    await this.post('/auth/logout', {}).catch(() => {});
    this.me = null; this.status = 'out';
  }
  private signedIn(me: Me) { this.me = me; this.status = 'in'; }
}

export class AccountError extends Error {
  constructor(public readonly code: AuthError) { super(code); }
}

export const account = new Account();

// Accounts can be switched on while a tab is open: look again when the tab comes back, and whenever the server
// answers "login-required".
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && account.status !== 'in') void account.check(); });
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...a: Parameters<typeof fetch>) => {
    const r = await orig(...a);
    if (r.status === 401 && account.status !== 'out' && String(a[0]).includes('/api/') && !String(a[0]).includes('/api/me')) void account.check();
    return r;
  };
}
