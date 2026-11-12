# Balonca

A language-learning subtitle player. Paste a YouTube link, add one or more subtitle files and watch with
several tracks at once (for example Dutch auto-captions plus a Turkish translation). Tap any word to drop it
into a per-language **word bag**, then review the bag with flashcards.

No accounts. Your words, progress and subtitles stay in your browser (IndexedDB). An optional small Node service
fetches subtitles from YouTube and translates them with a local AI model (Ollama); without it the site still works as
a plain static site.
Videos play through YouTube's official IFrame player only; nothing is downloaded or re-hosted.

## Features
- Several subtitle tracks at once: visibility, colour, editable name, language code, ±0.2 s sync offset
- Formats: `.srt`, `.vtt`, YouTube `.json3`, simple JSON `[{start,end,text}]`; drag & drop or paste text
- Language auto-detected from the file name (`video.nl.srt`); YouTube auto-caption rolling duplicates merged
- Click-to-save words (per language), saved words marked everywhere, jump back to the moment, CSV export
- Flashcard review with simple spaced repetition (again / good / easy), progress and counts
- Transcript synced to playback, virtualized for long videos; prev/next line, repeat line, speed, fullscreen
- Optional: hide translations until tapped, pause at the end of each line, 4 subtitle styles incl. high contrast
- Full backup/restore of words, settings and subtitles as one JSON file
- **Automatic subtitles**: open a video and Balonca fetches its own subtitle from YouTube, asks which language to
  translate into (or uses the remembered one), and translates with a local Ollama model; lines appear while the rest
  is translated
- **Word meanings**: 📖 next to a saved word shows its meaning in that sentence, the dictionary form, other meanings
  and examples, in Turkish or English (Wiktionary senses, translated and matched to the sentence by the local model)
- Optional in-browser translation helper (local model on the server, or your own Anthropic API key)
- Turkish and English UI, light / dark / auto theme, mobile-first layout

Keyboard: `Space` play/pause · `←` `→` previous/next line · `R` repeat line · `F` fullscreen ·
`W` word mode (then `←` `→` to move between words, `Enter` to save).

## Quality
Lighthouse (production build, mobile profile, local preview over HTTP): performance 92–98, accessibility 100,
best practices 96–100, SEO 100. It is not a PWA (by design: no service worker or manifest).

## Setup
Requires Node 20.19+.

```bash
npm install
npm run dev        # http://localhost:5173  (add --host to test on a phone on the same Wi-Fi)
npm test           # unit tests (parsers, storage, word bags, scheduler, translation)
npm run check      # type-check Svelte + TypeScript
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

The dev server drops the strict Content-Security-Policy (Vite injects inline styles); production builds keep it.

## Getting subtitles
YouTube's auto-captions can be downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```bash
yt-dlp --write-auto-subs --sub-langs nl --sub-format json3 --skip-download "https://youtu.be/VIDEO_ID"
```

Drop the resulting `.json3` onto the **Subtitles** tab.

### Translating: two options
1. **In the browser** (Subtitles tab, "Translation helper"): paste your Anthropic API key, choose the source
   track and target language, watch the progress, cancel any time. The key is kept in memory (or in
   `localStorage` if you tick "remember"), is sent only to `api.anthropic.com`, and is never part of a backup.
   It uses Anthropic's browser-direct-access header, which is appropriate for a personal key on your own device.
2. **Offline script** `translate.py` (kept as an alternative workflow):

   ```bash
   pip install yt-dlp anthropic
   export ANTHROPIC_API_KEY=...
   python translate.py                                   # uses the default video inside the script
   python translate.py "https://youtu.be/VIDEO_ID" nl Türkçe   # URL, source language code, target language
   ```

   It downloads the captions, translates them in batches of 25 and writes `subs.json`
   (`[{start,end,text}]`), which you then load into the app like any other subtitle file.

## Subtitle service (yt-dlp)
The only server-side piece, and optional: `server/` is a ~200-line zero-dependency Node service that runs
`yt-dlp` so the **Subtitles → Fetch subtitles from YouTube** panel can list every subtitle a video has
(manual, original auto-captions, and YouTube's auto-translations) with the language code and its full
Turkish/English name, filterable, and add one with a click. Without the service the rest of the app works
unchanged and the panel explains how to add a file instead. Set `VITE_SUBS_API=off` at build time to hide it.

```bash
npm run api                    # http://127.0.0.1:8787, uses the yt-dlp installed on this machine
npm run dev                    # the dev server proxies /api to it
```

Endpoints: `GET /api/subs?v=ID` (list), `GET /api/sub?v=ID&lang=CODE&kind=auto|manual` (download),
`GET /api/health`. Only YouTube video ids and plain language codes are accepted, `yt-dlp` is started without a
shell, at most 2 run at once, results are cached for 10 minutes, and each client is limited to 30 requests per minute.
The service uses **the `yt-dlp` of the operating system it runs on** (whatever is on `PATH`; it logs the version at
startup and `/api/health` reports whether it was found). `YTDLP_BIN=/path/to/yt-dlp` is only an override.
Install it with your system's package manager (`sudo apt install yt-dlp`, `brew install yt-dlp`, `pacman -S yt-dlp`) or
`pipx install yt-dlp`.
Environment: `PORT`, `HOST`, `YTDLP_BIN` (optional), `TRUST_PROXY=1` (behind nginx), `RATE_PER_MINUTE`, `ALLOWED_ORIGINS`.

Things to know:
- YouTube answers **HTTP 429 for its machine-translated captions** when asked by scripts, so those often fail while the
  original track (`nl-orig`) works. The app says so and suggests the translation helper instead.
- Servers in data centres are sometimes asked to "sign in to confirm you're not a bot". The app reports that too.
- Keep `yt-dlp` current: YouTube changes break old versions, and distribution packages can lag behind. If the
  packaged one stops working, update it (`pipx upgrade yt-dlp`, or a newer package/standalone binary).

## Automatic translation (Ollama)
The same service translates subtitles with a local model through [Ollama](https://ollama.com), so it costs nothing
per video and no text leaves your server. When a video opens with no subtitles, the app:

1. lists the video's subtitles and picks the spoken language (YouTube's `-orig` auto-caption tells which), preferring
   a hand-made track in that language over the automatic one;
2. for every language under **Settings → Automatic subtitles** (default Turkish and English; the video's own language
   is skipped) uses a hand-made YouTube subtitle if there is one, otherwise translates with the local model.

`POST /api/translate` with `{from, to, cues:[{start,end,text}]}` answers with NDJSON events
(`meta`, `queued`, `cues`, `ping`, `done` / `error`). How it keeps small models accurate:
- **Sentences, not lines.** Subtitle lines are cut mid-sentence ("Ik graaf naar een verborgen" / "schat."), which makes
  small models shift words between lines. Lines are joined and re-split into sentences, each with a time span
  interpolated from its words; the translated track has one cue per sentence.
- **Numbered JSON with a schema.** Each batch (8 sentences, 3 earlier ones as context) is sent as `{"1": …, "2": …}`
  and Ollama is constrained to answer exactly those keys, so nothing can go missing or out of order.
- A batch the model answered in the source language is retried once; stray characters some models append are removed.

One translation runs at a time (the model runs on the CPU), others wait in a queue and are told how many jobs are
ahead. Progress is saved to disk after every batch (`.cache/translations/`), so a repeated video is instant and an
interrupted one resumes. Each client may start 12 new (uncached) translations per hour.

Environment: `OLLAMA_URL` (default `http://127.0.0.1:11434`, `off` disables translation), `OLLAMA_MODEL`
(default `gemma3:latest`), `OLLAMA_HOST_HEADER` (only if your Ollama checks the `Host` header),
`TRANSLATE_CACHE_DIR`, `TRANSLATE_JOBS_PER_HOUR`. `/api/health` reports whether the model is reachable.
On a CPU, `gemma3` (4B) translates about one sentence per second: a 10-minute video takes 3–4 minutes.
English output is good; Turkish is usable with occasional wrong words, and a larger model (e.g. `gemma3:12b`, ~8 GB RAM)
improves it. `qwen2.5:3b` tends to copy the Dutch input back instead of translating.

## Word meanings
`POST /api/define` with `{word, lang, to, ctx}` answers `{lemma, inContext, senses:[{head,pos,meaning,en?,example?,best?}], source}`.
1. Senses come from [Wiktionary](https://en.wiktionary.org) (`/api/rest_v1/page/definition/<word>`): grammar lines such as
   "first-person singular present" are dropped, and "inflection of graven" is followed to *graven*.
2. The local model only picks the sense used in the saved sentence (asked in English, the easiest task for a small
   model) and, for Turkish or Dutch, translates the English glosses. The English original stays visible for checking.
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
Words, settings and subtitles live in IndexedDB (database `balonca`). Use **My words → Backup** to export one
JSON file and import it on another device (merge or replace). Data from the earlier single-file prototype
(`legacy/balonca.html`) is migrated automatically the first time the new app opens in the same browser profile.

## Project layout
```
src/lib/subtitles/   parsers, rolling-caption merge, errors      (unit-tested)
src/lib/words/       tokenizer, word-bag logic, CSV               (unit-tested)
src/lib/srs/         spaced-repetition scheduler                  (unit-tested)
src/lib/storage/     IndexedDB, backup/restore, legacy migration  (unit-tested)
src/lib/player/      YouTube wrapper, cue lookup/alignment, controller
src/lib/translate/   Anthropic client, batch runner, streaming client for the server   (unit-tested)
src/lib/auto.svelte.ts  automatic subtitles: fetch source, translate into the chosen languages
src/lib/ytsubs/      client + language filter for the subtitle service (unit-tested)
scripts/             per-machine example-video setup (unit-tested)
server/              yt-dlp subtitle service + Ollama translation (Node, no dependencies)  (unit-tested)
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
- Strict CSP (meta tag and nginx header): scripts only from self and youtube.com, API calls only to self and
  api.anthropic.com, no inline styles or scripts.
- The service only listens on 127.0.0.1 behind nginx. Translation requests are size-limited (1 MB, 5000 lines),
  validated, rate-limited per client and cancelled when the browser disconnects.
- Imported backups and settings are re-validated field by field; CSV export neutralises spreadsheet formulas.

## Copyright
Use this tool for personal language learning and respect creators' rights.

## License
MIT, see `LICENSE`.
