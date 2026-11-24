# Security checklist (phase 6b)

Only "done / not done". How each point is met is in the code and its tests. Server settings are tracked in a
private list (`docs/security/private/`, never committed): open points of a live server are not written here.
Last review: 2026-11-24.

## Identity and permissions
- [x] Every route but `/api/health` and `/api/config` needs a signed-in user (`lib.mjs`); admin routes need an admin (`admin.mjs`)
- [x] Users reach only their own data: library texts, saved words, sessions (IDOR tests: `sources.test.mjs`, red-team round 1)
- [x] Passwords: scrypt N=2^15, per-password salt; same answer and similar time for unknown e-mail and wrong password
- [x] Login tries limited (10 per 15 min per address + e-mail)
- [x] Sessions: 256-bit random, only the SHA-256 stored, HttpOnly + Secure + SameSite=Lax, 30 days; password change and reset end all other sessions; disabled account is signed out at once
- [x] Invites: 128-bit random, one use (stays used after the account is deleted), 14 days by default
- [x] Password reset links: one use, one hour, only made by an admin
- [x] Google sign-in: state cookie + nonce, issuer / audience / expiry checked, code exchanged by the server itself
- [x] Deleting one's account removes all of its own data (`DELETE /api/me`)

## Input and output
- [x] All SQL with parameters (`db.mjs`), no SQL built from input
- [x] Every request body validated, with size limits; oversized bodies get 413
- [x] No free text to models, the voice or the grammar parser: requests name a source, sentences must occur in it (`sources.mjs`)
- [x] Model answers checked: length, links, e-mail addresses, markup (`llm/guard.mjs`)
- [x] No raw HTML in the app (`{@html}`, `innerHTML`…; test `no-raw-html.test.ts`)
- [x] Content-Security-Policy, nosniff, Referrer-Policy, frame-ancestors none (example: `deploy/nginx-balonca.conf`)
- [x] Files: PDF and .txt are read in the browser only; nothing is uploaded or stored as a file on the server
- [x] No SSRF: the server only calls fixed hosts (YouTube via yt-dlp, Wiktionary, Google, the model API); web links given by users are never fetched
- [x] No shell: yt-dlp and Python run with argument lists; codes and ids are checked so none can look like an option
- [x] Errors to the browser are short codes; logs go through `redact()` and never hold user texts

## Abuse
- [x] Per-user limits: translations per hour, retranslations per day, meanings, speech (sentences / characters per day), grammar, YouTube videos per day
- [x] Shared YouTube budget with a circuit breaker; daily model budget (`LLM_DAILY_BUDGET_USD`) with fallback
- [x] Request limits in nginx (`limit_req` / `limit_conn`, example in `deploy/nginx-balonca.conf`)

## Operations
- [x] Secrets only in a root-made env file (mode 600), never in the repository or in process lists; gitleaks hook + CI
- [x] Nightly database backup, checked, owner-only, 14 days (`scripts/backup-db.mjs`)
- [x] Dependencies audited: `npm audit --omit=dev` clean; Python venv (`pip-audit`) clean (2026-11-24)
- [x] The service runs as an ordinary user, bound to 127.0.0.1 behind nginx
- [ ] Encrypted backup copy off the server
- [ ] Server hardening items: see the private list
