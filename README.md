# Balonca

A language-learning app with two ways in. **Watch:** paste a YouTube link; its subtitles come from YouTube by
themselves and are translated while you watch (for example Dutch captions plus a Turkish translation).
**Listen · Read · Learn:** paste a text or load a PDF and have it read aloud sentence by sentence, with each
sentence's translation and grammar. Tap any word to drop it into a per-language **word bag**, then review the bag
with flashcards. A short tour (4 steps per mode) is offered on first use and can be replayed from Help.

Accounts are optional. With `AUTH=on` people join with an invite link (e-mail + password, or Google) and their words,
progress and texts sync between devices; without it everything stays in the browser (IndexedDB). An optional small
Node service fetches subtitles from YouTube and translates them with an AI model (Tinker, or a local Ollama); without
it the site still works as a plain static site.
Videos play through YouTube's official IFrame player only; nothing is downloaded or re-hosted.

## Features
- Several subtitle tracks at once (the video's own + translations): show/hide and ±0.2 s sync in Settings
- Subtitles come from YouTube by themselves (`.json3`); auto-caption rolling duplicates merged
- Known words ("I know this") per language, kept in backups; saved words marked everywhere, jump back to the moment, CSV export
- Flashcard review with simple spaced repetition (again / good / easy), progress and counts
- Transcript synced to playback, virtualized for long videos; prev/next line, repeat line, speed, fullscreen
- Optional: hide translations until tapped, pause at the end of each line, 4 subtitle styles incl. high contrast
- Full backup/restore of words, settings and subtitles as one JSON file
- **Automatic subtitles**: open a video and Balonca fetches its own subtitle from YouTube. A translation someone
  already made appears at once; otherwise it asks which language to translate into (or uses the remembered one) and
  translates with an AI model (Tinker, or a local Ollama); lines appear while the rest is translated. "Try a new
  translation" makes the learner's own version (3 a day)
- **Tap a word while watching**: a card shows its meaning in that sentence, with "add to my words" and "I know this";
  words are coloured by status (new / learning / known) and the transcript shows what share of the video's words you know
- **Word meanings**: 📖 next to a saved word shows its meaning in that sentence, the dictionary form, other meanings
  and examples, in Turkish or English (Wiktionary senses, translated and matched to the sentence by the model)
- **Reading mode**: texts up to 200,000 characters, pasted or from a PDF (read in the browser, 20 MB / 300 pages, no
  OCR) or `.txt`; speech from the server (Piper) or the device, grammar from spaCy, progress kept per text
- **Accounts** (`AUTH=on`): invite links, e-mail + password or Google, words / texts / settings synced between
  devices, an admin page (usage, invites, accounts), deleting one's own account
- Turkish and English UI, light / dark / auto theme, text size Normal / Large / Very large, phone and desktop layouts

Keyboard: `Space` play/pause · `←` `→` previous/next line · `R` repeat line · `F` fullscreen ·
`W` word mode (then `←` `→` to move between words, `Enter` to save).

## Quality
Lighthouse (production build, mobile profile, local preview over HTTP): performance 92–98, accessibility 100,
best practices 96–100, SEO 100. It is not a PWA (by design: no service worker or manifest).

## Setup
Requires Node 22.13+ (the server uses `node:sqlite`; the site alone builds on 20.19+).

```bash
npm install
npm run dev        # http://localhost:5173  (add --host to test on a phone on the same Wi-Fi)
npm test           # unit tests (parsers, storage, word bags, scheduler, translation)
npm run check      # type-check Svelte + TypeScript
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

The dev server drops the strict Content-Security-Policy (Vite injects inline styles); production builds keep it.

## Subtitles from YouTube
Subtitles are fetched by the server with [yt-dlp](https://github.com/yt-dlp/yt-dlp); there is no manual upload any more.
Things to know:
- YouTube answers **HTTP 429 for its machine-translated captions** when asked by scripts; Balonca never uses them
  (`auto-translated` is refused) and translates the original track itself.
- Servers in data centres are sometimes asked to "sign in to confirm you're not a bot". The app reports that, and
  the server pauses YouTube calls for a while (15 min, then longer).
- Keep `yt-dlp` current: YouTube changes break old versions, and distribution packages can lag behind
  (`pipx upgrade yt-dlp`, or a newer standalone binary). `/api/health` shows the last success.

`translate.py` is an old offline script (yt-dlp + the Anthropic API → `subs.json`) kept for reference; the app does
not use it.

## The server (`server/`)
A zero-dependency Node service (Node ≥ 22.13, `node:sqlite`) behind nginx: YouTube subtitles through `yt-dlp`
(`server/youtube.mjs`: persistent cache, a per-minute/hour/day budget, one call per video at a time, a circuit
breaker), translation, word meanings, speech, grammar, accounts and sync. Without it the site still loads, but the
video and reading modes need it for subtitles, translation and speech.

```bash
npm run api                    # http://127.0.0.1:8787, uses the yt-dlp installed on this machine
npm run dev                    # the dev server proxies /api to it
```

Only YouTube video ids and plain language codes are accepted and `yt-dlp` is started without a shell.
Budget: `YT_MAX_PER_MIN` (6), `YT_MAX_PER_HOUR` (120), `YT_MAX_PER_DAY` (1000), `YT_NEW_VIDEOS_PER_USER_DAY` (30).
The service uses **the `yt-dlp` of the operating system it runs on** (whatever is on `PATH`; it logs the version at
startup and `/api/health` reports whether it was found). `YTDLP_BIN=/path/to/yt-dlp` is only an override.
Install it with your system's package manager (`sudo apt install yt-dlp`, `brew install yt-dlp`, `pacman -S yt-dlp`) or
`pipx install yt-dlp`.
Environment: `PORT`, `HOST`, `YTDLP_BIN` (optional), `TRUST_PROXY=1` (behind nginx), `RATE_PER_MINUTE`, `ALLOWED_ORIGINS`,
`PUBLIC_ORIGIN` (the site's own origin, e.g. `https://balonca.example.com`), and for the reading mode `TTS_ENABLED`
(`0` switches speech off; the app then uses the device voice), `TTS_NEW_PER_10MIN`, `TTS_CHARS_PER_DAY`,
`TTS_CACHED_PER_MIN`, `PARSE_PER_MINUTE`. See `deploy/balonca.env.example`.

Things to know:
- YouTube answers **HTTP 429 for its machine-translated captions** when asked by scripts, so those often fail while the
  original track (`nl-orig`) works. The app says so and suggests the translation helper instead.
- Servers in data centres are sometimes asked to "sign in to confirm you're not a bot". The app reports that too.
- Keep `yt-dlp` current: YouTube changes break old versions, and distribution packages can lag behind. If the
  packaged one stops working, update it (`pipx upgrade yt-dlp`, or a newer package/standalone binary).

## Automatic translation
The same service translates with an AI model: [Tinker](https://thinkingmachines.ai/tinker/) (an Anthropic-compatible
API) when a key is set, otherwise a local model through [Ollama](https://ollama.com), which also is the fallback.
When a video opens with no subtitles, the app:

1. lists the video's subtitles and picks the spoken language (YouTube's `-orig` auto-caption tells which), preferring
   a hand-made track in that language over the automatic one;
2. for every language under **Settings → Automatic subtitles** (default Turkish and English; the video's own language
   is skipped) uses a hand-made YouTube subtitle if there is one, otherwise translates with the local model.

`POST /api/translate` with `{v, code, kind, to}` (a YouTube subtitle) or `{libraryId, to}` (a text of the signed-in
user's library) answers with NDJSON events (`meta`, `queued`, `pivot`, `cues`, `ping`, `done` / `error`).

**The browser never sends text to a model** (nor to the voice or the grammar parser). Every request names a source
and the server reads the text itself (`server/sources.mjs`): the video's subtitle through the YouTube cache, a text
or a saved word from the user's account. Where the browser names a sentence (the one on screen, the one read aloud),
it must occur in that source, or the request is refused (`not-in-source`). Model answers that are far longer than
their source, or bring links, e-mail addresses or markup it did not have, are dropped (`server/llm/guard.mjs`), and
the app never inserts raw HTML (a test checks). Translations of videos are shared; a user's own texts are cached
under that user only. With `PIVOT=en`, Turkish is made from the English translation on the server.

| Request | Source |
|---|---|
| `POST /api/translate` | `{v, code, kind, to}` or `{libraryId, to}` |
| `POST /api/sentence` | `{wordId, to}` or `{libraryId, text, to}` (`text` must be in the text) |
| `POST /api/define` | `{word, lang, to, ref, ctx?}`, `ref` = `{v}`, `{libraryId}` or `{wordId}`; `ctx` used only when found there |
| `GET /api/tts` | `?lang&word=` (one word), `?lang&lib=&text=` (a sentence of a text), `?lang&wordId=` |
| `POST /api/parse` | `{lang, ref:{libraryId}, sents}` (every sentence must be in the text) |

**Shared pool (phase 4b).** A video translation, once complete, is offered to everyone who opens that video:
`GET /api/translations?v=` lists the languages ready, and the app loads them at once (no model call). A learner who
does not like it can ask for a new one (`{…, fresh: true}`): it is made again and kept as that learner's own
version, which they keep seeing; others keep the shared one (`RETRANSLATE_PER_DAY`, default 3). Word meanings are
kept in two halves: the word's meanings (shared by everyone, no sentence in them) and which one a sentence uses (a
small call, cached per sentence; a sentence from someone's own text under that user only).

How translation keeps small models accurate:
- **Sentences, not lines.** Subtitle lines are cut mid-sentence ("Ik graaf naar een verborgen" / "schat."), which makes
  small models shift words between lines. Lines are joined and re-split into sentences, each with a time span
  interpolated from its words; the translated track has one cue per sentence.
- **Numbered JSON with a schema.** Each batch (8 sentences, 3 earlier ones as context) is sent as `{"1": …, "2": …}`
  and Ollama is constrained to answer exactly those keys, so nothing can go missing or out of order.
- A batch the model answered in the source language is retried once; stray characters some models append are removed.

With Tinker, up to 8 translations run at once (4 batches of one video in parallel, `LLM_CONCURRENCY` calls in all);
with only Ollama on a CPU, one at a time. Others wait in a queue and are told how many jobs are ahead. Progress is
saved to disk after every batch (`.cache/translations/`), so a repeated video is instant and an interrupted one
resumes. Each user (each client, without accounts) may start `TRANSLATE_JOBS_PER_HOUR` (12) new translations per hour.

Provider settings (in `/etc/balonca.env` or `.env`, never in the repository): `LLM_PROVIDER` (`tinker` | `ollama`),
`LLM_FALLBACK` (`ollama` | `off`), `TINKER_API_KEY`, `TINKER_BASE_URL`, `TINKER_MODEL` (default
`thinkingmachines/Inkling`), `TINKER_MODEL_<LANG>`, `LLM_CONCURRENCY` (16), `LLM_DAILY_BUDGET_USD` (over it, calls go
to Ollama for the rest of the day), `LLM_PRICE_IN` / `LLM_PRICE_OUT`. Tinker answers 429/5xx are retried three
times, then Ollama answers; once the credit is gone (402/403) Tinker is asked again only once an hour.

Grammar by the model (`grammar-llm.md`): `GRAMMAR_ENGINE=model|parser` (default `parser`). With `model`, the sentence a
reader opens in the grammar panel (Dutch and English) is labelled by the model; the explanations stay the hand-written
templates, and its only free text is a short "AI note". The parser and its rules answer whenever the provider is not
Tinker, `GRAMMAR_DAILY_BUDGET_USD` (2) is used up, the call fails or the answer fails validation. Answers are cached in
`GRAMMAR_CACHE_DIR` (`.cache/grammar/`): shared for videos and the sample texts, per user for their own texts. The admin
page shows how often each engine answered and why. Compare the engines with `npm run grammar:compare`.

Environment: `OLLAMA_URL` (default `http://127.0.0.1:11434`, `off` disables translation), `OLLAMA_MODEL`
(default `gemma3:latest`), `OLLAMA_HOST_HEADER` (only if your Ollama checks the `Host` header),
`TRANSLATE_CACHE_DIR`, `TRANSLATE_JOBS_PER_HOUR`. `/api/health` reports whether the model is reachable.
On a CPU, `gemma3` (4B) translates about one sentence per second: a 10-minute video takes 3–4 minutes.
English output is good; Turkish is usable with occasional wrong words, and a larger model (e.g. `gemma3:12b`, ~8 GB RAM)
improves it. `qwen2.5:3b` tends to copy the Dutch input back instead of translating.

## Accounts, backups, privacy
- `DELETE /api/me {confirm: <e-mail>}` deletes the signed-in account and all of its own data (words, texts, settings,
  sessions, events; the user's own cached translations); invites it used stay used. In the app: Settings → My account.
- `scripts/backup-db.mjs <db> <folder> [days]` makes a consistent copy of the database while the server runs
  (`VACUUM INTO`), checks it, keeps it readable by its owner only and deletes copies older than `days` (14). Run it
  nightly from cron, e.g. `30 3 * * * node /path/backup-db.mjs /path/balonca.db /path/backups 14`.
- What is stored and where it goes is explained to users in Help → Privacy.

## Word meanings
`POST /api/define` with `{word, lang, to, ref, ctx?}` (see the table above) answers `{lemma, inContext, senses:[{head,pos,meaning,en?,example?,best?}], source}`.
1. Senses come from [Wiktionary](https://en.wiktionary.org) (`/api/rest_v1/page/definition/<word>`): grammar lines such as
   "first-person singular present" are dropped, and "inflection of graven" is followed to *graven*.
2. The model only picks the sense used in the sentence (asked in English) and, for Turkish or Dutch, translates the
   English glosses. A word's meanings are kept for everyone (no sentence in them); which one a sentence uses is a
   second, small cached call. The English original stays visible for checking.
3. A word Wiktionary does not have (names, misheard words) gets the model's own guess, labelled `source: "ai"`.
Results are cached on disk (`DEFINE_CACHE_DIR`, default `.cache/definitions/`), except a guess made while Wiktionary
could not be reached. In the app, meanings are saved with the word, shown on flashcards and kept in backups.

## Example video (optional, installed per machine)
The repository contains no example video or captions. If you want first-time visitors to land on a video that already
has subtitles, install one on the machine that builds or serves the site. It uses the machine's own `yt-dlp`:

```bash
EXAMPLE_VIDEO="https://www.youtube.com/watch?v=VIDEO_ID" npm run setup:example   # before `npm run build`
npm run setup:example -- --out dist/examples                                      # or into an already built site
```

It downloads the best original track (or `--langs nl-orig,tr` / `EXAMPLE_LANGS`), writes `examples/manifest.json`
and the subtitle files, and does nothing if that video is already installed (`--force` downloads again). The files
are git-ignored. On a visitor's first visit with no saved video the app opens the example and adds its subtitles once
(deleting them keeps them deleted); without a manifest it simply starts with an empty player.
Only use videos and captions you are allowed to use this way.

## Data and backups
With accounts, words, known words, texts and settings live in the account (SQLite on the server) and a copy in the
browser's IndexedDB (database `balonca`); without accounts, only in the browser. **My words → Backup** exports one
JSON file that can be imported on another device (merge or replace). Data from the earlier single-file prototype
(`legacy/balonca.html`) is migrated automatically the first time the new app opens in the same browser profile.

## Project layout
```
src/lib/subtitles/   parsers, rolling-caption merge, errors      (unit-tested)
src/lib/words/       tokenizer, word-bag logic, CSV               (unit-tested)
src/lib/srs/         spaced-repetition scheduler                  (unit-tested)
src/lib/storage/     IndexedDB, backup/restore, legacy migration  (unit-tested)
src/lib/player/      YouTube wrapper, cue lookup/alignment, controller
src/lib/translate/   batch runner, streaming client for the server   (unit-tested)
src/lib/auto.svelte.ts  automatic subtitles: fetch source, translate into the chosen languages
src/lib/ytsubs/      client + language filter for the subtitle service (unit-tested)
scripts/             per-machine example-video setup (unit-tested)
src/lib/read/        reading mode: sentences, PDF, speech, grammar   (unit-tested)
src/lib/tour.svelte.ts  the two tours (video, text), 4 steps each
server/              API: YouTube, translation (server/llm: Tinker + Ollama), accounts, sync, admin (Node, no dependencies)  (unit-tested)
src/lib/i18n/        tr.ts is the source, en.ts must cover every key
src/components/      UI pieces      src/routes/   pages
legacy/              the original single-file prototypes (reference only)
deploy/              nginx server block, PM2 config for the service
```

## Deploy
It is a plain static folder, so any static host works (Cloudflare Pages, Netlify, GitHub Pages at the domain root).

### Own server (balonca.example.com)
```bash
# optional, once per machine: EXAMPLE_VIDEO="<YouTube link>" npm run setup:example   (see "Example video")
npm run build
rsync -av --delete dist/ user@your-server:/var/www/balonca/        # create the folder first and make it writable for your user
# once, with sudo on the server:
sudo cp deploy/nginx-balonca.conf /etc/nginx/sites-available/balonca
sudo ln -s /etc/nginx/sites-available/balonca /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d balonca.example.com
```
Subtitle service on the same server (install `yt-dlp` once with your package manager, then):
```bash
rsync -av server/ user@your-server:~/balonca-api/server/ && scp deploy/ecosystem.config.cjs user@your-server:~/balonca-api/
ssh user@your-server 'cd ~/balonca-api && pm2 start ecosystem.config.cjs && pm2 save'
```
DNS: an `A` record for `balonca.example.com` → the server's IP. Use HTTPS in production: some browser
features (and YouTube embedding behaviour) are more reliable on a secure origin.

## Security notes
- Subtitle text is parsed to plain text and rendered through Svelte's escaping; there is no `innerHTML` or `{@html}`.
- Strict CSP (meta tag and nginx header): scripts only from self and youtube.com, API calls only to self,
  no inline styles or scripts.
- The service only listens on 127.0.0.1 behind nginx. Translation requests are size-limited (1 MB, 5000 lines),
  validated, rate-limited per client and cancelled when the browser disconnects.
- Imported backups and settings are re-validated field by field; CSV export neutralises spreadsheet formulas.
- The API only answers the site itself: browsers mark its requests `Sec-Fetch-Site: same-origin` (older Safari: a
  `Referer` from the site), and POSTs must carry the site's `Origin`. Other sites, embeds and links opened directly get
  403. `/api/health` is open for monitoring.
- Speech audio is `cache-control: private`, not indexed, and limited per client (cached audio, new sentences per
  10 minutes, characters per day, two at a time). Text is cleaned first (no control characters, links or e-mail
  addresses). Grammar requests have their own per-minute limit.
- Logs never hold query strings, user text, keys, tokens or cookies: everything goes through `server/redact.mjs`.

### Secret scanning
The repository is public. A pre-commit hook and a GitHub Actions job scan for keys, tokens and real server addresses
with [gitleaks](https://github.com/gitleaks/gitleaks) (`.gitleaks.toml`). After cloning:

```sh
# install gitleaks (any of: brew install gitleaks / a release binary on PATH), then
git config core.hooksPath .githooks
```

Never commit `.env` files, databases, logs, caches or real server settings; examples use `203.0.113.x` and
`balonca.example.com`. If a key ever leaks: revoke it first, then clean the history.

## Copyright
Use this tool for personal language learning and respect creators' rights.

## License
MIT, see `LICENSE`.
