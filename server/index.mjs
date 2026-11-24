import http from 'node:http';

// Secrets (TINKER_API_KEY …) come from a root-made file readable only by this user, never from the repository or the
// pm2 config (pm2 saves its env to disk). Variables already set win.
try { process.loadEnvFile(process.env.BALONCA_ENV_FILE ?? '/etc/balonca.env'); } catch { /* no file: fine */ }
import net from 'node:net';

// Node gives each address only 250 ms when it races IPv4/IPv6 ("happy eyeballs"); from this server Wiktionary often
// needs a little longer, which made about 1 in 10 lookups fail with ETIMEDOUT. Give a connection a fair chance.
net.setDefaultAutoSelectFamilyAttemptTimeout(2500);
import { checkYtDlp, createHandler, runYtDlp } from './lib.mjs';
import { chatStream, createTranslateHandler, ollamaStatus, parseModels } from './translate.mjs';
import { createLlm, TINKER_DEFAULT_URL } from './llm/index.mjs';
import { createDefineHandler } from './define.mjs';
import { createSentenceHandler } from './sentence.mjs';
import { createYouTube } from './youtube.mjs';
import { openDb } from './db.mjs';
import { createAuth } from './auth.mjs';
import { createSync } from './sync.mjs';
import { createParseHandler, createTtsHandler, nlpInfo, pyWorker } from './nlp.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1'; // keep it behind a reverse proxy
// By default the yt-dlp installed on this machine (found on PATH) is used. YTDLP_BIN only overrides that.
const bin = process.env.YTDLP_BIN || 'yt-dlp';
// YouTube needs a JavaScript runtime to unlock many videos ("This video is not available" without one).
// yt-dlp only looks for deno by default, so hand it the Node that runs this service. YTDLP_JS_RUNTIMES=off disables.
const js = process.env.YTDLP_JS_RUNTIMES ?? `node:${process.execPath}`;
const extra = js === 'off' ? [] : ['--js-runtimes', js];
const run = (args, opts) => runYtDlp(args[0] === '--version' ? args : [...extra, ...args], { ...opts, bin });

const version = await checkYtDlp(run, bin);
console.log(version ? `using system ${bin} ${version}` : `WARNING: "${bin}" not found. Install yt-dlp on this machine (see README); requests will fail until then.`);

// Automatic translation through Ollama. OLLAMA_URL=off disables it.
const llm = {
  baseUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'gemma3:latest',
  hostHeader: process.env.OLLAMA_HOST_HEADER ?? '',
  // A stronger model for some target languages, e.g. OLLAMA_MODELS="tr=aya-expanse:8b"; others use OLLAMA_MODEL.
  models: parseModels(process.env.OLLAMA_MODELS ?? ''),
};
const llmOn = llm.baseUrl !== 'off';
if (llmOn) {
  const st = await ollamaStatus(llm);
  console.log(st.ok ? `translation: ${llm.model} at ${llm.baseUrl}` : `WARNING: Ollama model "${llm.model}" not reachable at ${llm.baseUrl}; translation requests will fail until it is.`);
}
// Who writes: Tinker (LLM_PROVIDER=tinker and a key) with the local Ollama as fallback, or Ollama alone.
const env = process.env;
const tinkerModels = Object.fromEntries(Object.entries(env).filter(([k, v]) => /^TINKER_MODEL_[A-Z]{2,3}$/.test(k) && v).map(([k, v]) => [k.slice(13).toLowerCase(), v]));
const llmLayer = createLlm({
  provider: env.LLM_PROVIDER ?? 'ollama', fallback: env.LLM_FALLBACK ?? 'ollama',
  tinker: { url: env.TINKER_BASE_URL || TINKER_DEFAULT_URL, key: env.TINKER_API_KEY ?? '', model: env.TINKER_MODEL || 'thinkingmachines/Inkling', models: tinkerModels },
  ollama: { model: llm.model, models: llm.models, chat: chatStream },
  concurrency: Number(env.LLM_CONCURRENCY ?? 16), dailyBudgetUsd: Number(env.LLM_DAILY_BUDGET_USD ?? 5),
  priceIn: Number(env.LLM_PRICE_IN ?? 1.87), priceOut: Number(env.LLM_PRICE_OUT ?? 4.68),
  usageDir: env.LLM_USAGE_DIR ?? fileURLToPath(new URL('../.cache/usage', import.meta.url)),
});
const chat = (url, body, opts) => llmLayer.chat(url, body, opts);
// Caches are keyed by the model that writes, so a better model never gets the older model's answers.
const named = llmLayer.useTinker ? { ...llm, model: llmLayer.model(''), models: tinkerModels } : llm;
console.log(`model calls: ${llmLayer.status().provider} (${llmLayer.status().model})${llmLayer.useTinker ? `, key ${env.TINKER_API_KEY ? 'set' : 'missing'}` : ''}`);
// Turkish via English helps the small local model; a strong model translates directly (PIVOT=en|off).
const pivot = env.PIVOT ?? (llmLayer.useTinker ? 'off' : 'en');

const cacheDir = process.env.TRANSLATE_CACHE_DIR ?? new URL('../.cache/translations', import.meta.url).pathname;
const defineCacheDir = process.env.DEFINE_CACHE_DIR ?? new URL('../.cache/definitions', import.meta.url).pathname;

// Reading mode: grammar (spaCy) and speech (Piper) from a Python venv next to the server (see README "Reading mode").
// NLP_PYTHON=off disables both.
const python = process.env.NLP_PYTHON ?? fileURLToPath(new URL('../pyenv/bin/python', import.meta.url));
const nlpOn = python !== 'off' && existsSync(python);
const nlpScript = fileURLToPath(new URL('./nlp.py', import.meta.url));
const nlpEnv = { VOICES_DIR: process.env.VOICES_DIR ?? fileURLToPath(new URL('../voices', import.meta.url)) };
const parseWorker = nlpOn ? pyWorker({ python, script: nlpScript, args: ['parse'], env: { ...nlpEnv, NLP_PRELOAD: process.env.NLP_PRELOAD ?? 'nl' } }) : null;
const ttsWorker = nlpOn ? pyWorker({ python, script: nlpScript, args: ['tts'], env: { ...nlpEnv, NLP_PRELOAD: process.env.NLP_PRELOAD ?? 'nl' } }) : null;
const info = parseWorker ? nlpInfo(parseWorker) : null;
if (info) void info().then((i) => console.log(`reading mode: grammar ${i.parse.join(',') || 'none'}; voices ${i.tts.join(',') || 'none'}`));
else console.log('reading mode: grammar and voices off (no Python venv at ../pyenv)');
const ttsCacheDir = process.env.TTS_CACHE_DIR ?? fileURLToPath(new URL('../.cache/tts', import.meta.url));

// YouTube: permanent cache, a shared budget and a circuit breaker (youtube.mjs).
const ytLimits = Object.fromEntries(Object.entries({
  perMin: process.env.YT_MAX_PER_MIN, perHour: process.env.YT_MAX_PER_HOUR, perDay: process.env.YT_MAX_PER_DAY,
  newVideosPerDay: process.env.YT_NEW_VIDEOS_PER_USER_DAY,
}).filter(([, v]) => v).map(([k, v]) => [k, Number(v)]));
const youtube = createYouTube({ run, cacheDir: process.env.YT_CACHE_DIR ?? fileURLToPath(new URL('../.cache/yt', import.meta.url)), limits: ytLimits });

// Accounts (AUTH=on): every route but health needs a signed-in user. The database lives next to server/ (not in it:
// deploys replace server/). Off by default, so turning it on is a decision.
const db = openDb(env.BALONCA_DB ?? fileURLToPath(new URL('../data/balonca.db', import.meta.url)));
// Sign in with Google: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (in /etc/balonca.env), Google sends people back to
// PUBLIC_ORIGIN/api/auth/google/callback (register that address with the client).
const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_ORIGIN
  ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${env.PUBLIC_ORIGIN}/api/auth/google/callback` } : null;
const accounts = env.AUTH === 'on' ? createAuth({ db, secure: env.COOKIE_SECURE !== '0', google }) : null;
console.log(`accounts: ${accounts ? `on (sign-in required; Google ${google ? 'on' : 'off'})` : 'off'}`);

const handler = createHandler({
  auth: accounts,
  sync: accounts ? createSync({ db }) : null,
  youtube,
  parse: parseWorker ? createParseHandler({ worker: parseWorker, info }) : null,
  // TTS_ENABLED=0 switches speech off (404; the site then reads with the device's own voice).
  tts: ttsWorker && process.env.TTS_ENABLED !== '0' ? createTtsHandler({ worker: ttsWorker, info, cacheDir: ttsCacheDir, limits: {
    ...(process.env.TTS_NEW_PER_10MIN ? { newPer10Min: Number(process.env.TTS_NEW_PER_10MIN) } : {}),
    ...(process.env.TTS_CHARS_PER_DAY ? { charsPerDay: Number(process.env.TTS_CHARS_PER_DAY) } : {}),
    ...(process.env.TTS_CACHED_PER_MIN ? { cachedPerMin: Number(process.env.TTS_CACHED_PER_MIN) } : {}),
  } }) : null,
  // The site's own address: POST requests must come from it (empty: the request's own Host is taken).
  publicOrigin: process.env.PUBLIC_ORIGIN ?? '',
  parsePerMinute: Number(process.env.PARSE_PER_MINUTE ?? 60),
  nlpStatus: info,
  translate: llmOn ? createTranslateHandler({ ...named, cacheDir, chat, jobsPerHour: Number(process.env.TRANSLATE_JOBS_PER_HOUR ?? 12),
    ...(llmLayer.useTinker ? { jobs: 8, parallel: 4 } : {}) }) : null,
  define: llmOn ? createDefineHandler({ llm: named, cacheDir: defineCacheDir, chat,
    dictionary: (lang, form) => db.dict(lang, form), dictionaryFirst: () => !llmLayer.status().provider.startsWith('tinker') }) : null,
  sentence: llmOn ? createSentenceHandler({ llm: named, cacheDir: defineCacheDir, chat }) : null,
  llmStatus: llmOn ? async () => { const local = await ollamaStatus(llm); return { ok: llmLayer.useTinker || local.ok, ...llmLayer.status(), local }; } : null,
  appConfig: { pivot },
  run,
  ytdlpInstalled: Boolean(version),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
  ratePerMinute: Number(process.env.RATE_PER_MINUTE ?? 30),
});
http.createServer(handler).listen(port, host, () => console.log(`balonca subtitle service on http://${host}:${port}`));
