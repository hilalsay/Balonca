import http from 'node:http';
import net from 'node:net';

// Node gives each address only 250 ms when it races IPv4/IPv6 ("happy eyeballs"); from this server Wiktionary often
// needs a little longer, which made about 1 in 10 lookups fail with ETIMEDOUT. Give a connection a fair chance.
net.setDefaultAutoSelectFamilyAttemptTimeout(2500);
import { checkYtDlp, createHandler, runYtDlp } from './lib.mjs';
import { createTranslateHandler, ollamaStatus } from './translate.mjs';
import { createDefineHandler } from './define.mjs';

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
};
const llmOn = llm.baseUrl !== 'off';
if (llmOn) {
  const st = await ollamaStatus(llm);
  console.log(st.ok ? `translation: ${llm.model} at ${llm.baseUrl}` : `WARNING: Ollama model "${llm.model}" not reachable at ${llm.baseUrl}; translation requests will fail until it is.`);
}
const cacheDir = process.env.TRANSLATE_CACHE_DIR ?? new URL('../.cache/translations', import.meta.url).pathname;
const defineCacheDir = process.env.DEFINE_CACHE_DIR ?? new URL('../.cache/definitions', import.meta.url).pathname;

const handler = createHandler({
  translate: llmOn ? createTranslateHandler({ ...llm, cacheDir, jobsPerHour: Number(process.env.TRANSLATE_JOBS_PER_HOUR ?? 12) }) : null,
  define: llmOn ? createDefineHandler({ llm, cacheDir: defineCacheDir }) : null,
  llmStatus: llmOn ? () => ollamaStatus(llm) : null,
  run,
  ytdlpInstalled: Boolean(version),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
  ratePerMinute: Number(process.env.RATE_PER_MINUTE ?? 30),
});
http.createServer(handler).listen(port, host, () => console.log(`balonca subtitle service on http://${host}:${port}`));
