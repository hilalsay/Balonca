// Which model answers: Tinker (Anthropic-compatible API) first, the local Ollama as fallback.
//
// The rest of the server talks to models through one function with the shape of Ollama's /api/chat
// (`chat(url, body, {headers, signal}) -> {status, content}`), so prompts, schemas, retries and checks stay where they
// are. For Tinker the Ollama-style body is turned into an Anthropic Messages request: the JSON schema becomes a single
// forced tool ("submit"), so the answer can only be JSON of that shape. Usage is counted and priced; over the daily
// budget, after three failed tries, or once the credit is gone (402/403), calls go to Ollama instead.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, semaphore } from '../lib.mjs';
import { logError } from '../redact.mjs';

/**
 * Per request: did any model call fall back to the local model? Handlers run their work inside
 * `llmContext.run({}, …)` and do not cache an answer the fallback wrote (it would be kept under the better model's name).
 */
export const llmContext = new AsyncLocalStorage();
export const fellBack = () => !!llmContext.getStore()?.fallback;

export const TINKER_DEFAULT_URL = 'https://tinker.thinkingmachines.dev/services/tinker-prod/anthropic/api';

/** Ollama-style chat body -> Anthropic Messages request. */
export function toAnthropic(body, model) {
  const msgs = body.messages ?? [];
  const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = msgs.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  const schema = body.format && typeof body.format === 'object' ? body.format : null;
  const out = {
    model, max_tokens: Math.max(16, Math.min(8192, Math.round((body.options?.num_predict ?? 1024) * 1.5))),
    temperature: body.options?.temperature ?? 0.2, thinking: { type: 'disabled' },
    system: system + (schema ? '\nGive your answer only through the "submit" tool.' : ''), messages,
  };
  if (schema) {
    out.tools = [{ name: 'submit', description: 'Submit the answer.', input_schema: schema }];
    out.tool_choice = { type: 'tool', name: 'submit' };
  }
  return out;
}

/** Anthropic answer -> the text the callers expect (JSON text for schema calls). */
export function fromAnthropic(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const tool = blocks.find((b) => b.type === 'tool_use');
  if (tool) return JSON.stringify(tool.input ?? {});
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

/** Tokens billed for one answer (cache writes and reads count as input). */
export const tokens = (u = {}) => ({
  input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
  output: u.output_tokens ?? 0,
});

/**
 * cfg: { provider: 'tinker'|'ollama', fallback: 'ollama'|'off', tinker: {url, key, model, models}, ollama: {chat, model},
 *        concurrency, dailyBudgetUsd, priceIn, priceOut, usageDir }
 * Returns { chat, model(to), status() }. `fetchImpl`, `now`, `sleep` are injectable for tests.
 */
export function createLlm(cfg, { fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  const useTinker = cfg.provider === 'tinker' && !!cfg.tinker?.key;
  const slot = semaphore(useTinker ? (cfg.concurrency ?? 16) : 1000, 2000);
  const spent = { day: dayOf(now()), usd: 0, calls: 0, fallbacks: 0, input: 0, output: 0 };
  const thinkers = new Set(); // models that cannot switch thinking off
  let creditGoneUntil = 0; // after 402/403: Tinker is not asked again for an hour
  let lastError = '';
  const loaded = loadSpent(cfg.usageDir, spent);

  function dayOf(t) { return new Date(t).toISOString().slice(0, 10); }
  function rollDay() { const d = dayOf(now()); if (d !== spent.day) Object.assign(spent, { day: d, usd: 0, calls: 0, fallbacks: 0, input: 0, output: 0 }); }
  const overBudget = () => cfg.dailyBudgetUsd > 0 && spent.usd >= cfg.dailyBudgetUsd;

  /** The model that writes `to` (Tinker: TINKER_MODEL_<LANG> or TINKER_MODEL; Ollama: its own setting). */
  function model(to) {
    if (!useTinker) return cfg.ollama.models?.[to] ?? cfg.ollama.model;
    return cfg.tinker.models?.[to] ?? cfg.tinker.model;
  }

  async function tinker(body, signal, purpose) {
    // Callers name the model (TINKER_MODEL or TINKER_MODEL_<LANG>, see index.mjs); anything else gets the default.
    let req = toAnthropic(body, String(body.model ?? '').includes('/') ? body.model : cfg.tinker.model);
    if (thinkers.has(req.model)) { // known to think: ask the way it accepts straight away
      const { thinking, tools, tool_choice, ...rest } = req;
      req = { ...rest, max_tokens: rest.max_tokens + 6000,
        ...(tools ? { system: `${rest.system.replace(/\nGive your answer only through the "submit" tool\.$/, '')}\nReply with JSON only, no other text, matching this JSON schema: ${JSON.stringify(tools[0].input_schema)}` } : {}) };
    }
    let noTool = 0;
    for (let attempt = 0; ; attempt++) {
      let res, data;
      try {
        res = await fetchImpl(`${cfg.tinker.url.replace(/\/+$/, '')}/v1/messages`, {
          method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
          headers: { 'x-api-key': cfg.tinker.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify(req),
        });
        data = await res.json().catch(() => null);
      } catch (e) {
        if (signal?.aborted) throw new ApiError(499, 'cancelled');
        res = { status: 0 }; data = null; lastError = e?.name ?? 'network';
      }
      if (res.status === 200 && data) {
        const t = tokens(data.usage);
        const usd = (t.input * (cfg.priceIn ?? 0) + t.output * (cfg.priceOut ?? 0)) / 1e6;
        rollDay(); spent.usd += usd; spent.calls++; spent.input += t.input; spent.output += t.output;
        void record(cfg.usageDir, { at: now(), provider: 'tinker', model: req.model, purpose, input: t.input, output: t.output, usd });
        return { status: 200, content: fromAnthropic(data) };
      }
      if (res.status === 402 || res.status === 403 || res.status === 401) {
        creditGoneUntil = now() + 3_600_000;
        lastError = `tinker ${res.status}`;
        logError(`tinker refused (${res.status}): using the local model for an hour`);
        throw new ApiError(503, 'llm-credit');
      }
      // Some models always think first and refuse the switch: drop it and leave room for the thinking. A forced tool
      // does not go together with thinking either: those models get the schema in the instructions instead.
      if (res.status === 400 && /reasoning_effort is not supported/i.test(JSON.stringify(data?.error ?? '')) && req.thinking) {
        const { thinking, tools, tool_choice, ...rest } = req;
        req = { ...rest, max_tokens: rest.max_tokens + 6000,
          ...(tools ? { system: `${rest.system.replace(/\nGive your answer only through the "submit" tool\.$/, '')}\nReply with JSON only, no other text, matching this JSON schema: ${JSON.stringify(tools[0].input_schema)}` } : {}) };
        thinkers.add(req.model);
        attempt--;
        continue;
      }
      // Now and then the model answers in prose although the tool is required: ask again; the second time without the
      // tool, with the schema in the instructions (callers parse and check the JSON anyway).
      if (res.status === 422 && /no tool call/i.test(JSON.stringify(data?.error ?? '')) && req.tools && noTool < 2) {
        noTool++;
        if (noTool === 2) {
          const { tools, tool_choice, ...rest } = req;
          req = { ...rest, system: `${rest.system.replace(/\nGive your answer only through the "submit" tool\.$/, '')}\nReply with JSON only, no other text, matching this JSON schema: ${JSON.stringify(tools[0].input_schema)}` };
        }
        attempt--;
        continue;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        lastError = `tinker ${res.status}`;
        logError(`tinker ${res.status}: ${JSON.stringify(data?.error ?? '').slice(0, 200)}`);
        throw new ApiError(502, 'llm-failed', String(res.status));
      }
      lastError = `tinker ${res.status || 'network'}`;
      if (attempt >= 2) throw new ApiError(502, 'llm-failed', lastError);
      const base = 500 * 2 ** attempt;
      await sleep(base * (0.8 + random() * 0.4)); // 0.5 s, 1 s (+-20 %)
    }
  }

  async function chat(url, body, opts = {}, purpose = 'chat') {
    rollDay();
    await loaded;
    const tinkerUsable = useTinker && now() >= creditGoneUntil && !overBudget();
    if (tinkerUsable) {
      try { return await slot(() => tinker(body, opts.signal, purpose)); }
      catch (e) {
        if (e instanceof ApiError && e.code === 'cancelled') throw e;
        if (cfg.fallback === 'off') throw e;
        spent.fallbacks++;
        const store = llmContext.getStore();
        if (store) store.fallback = true;
        logError(`tinker failed (${e.code ?? e.message}): this call goes to the local model`);
      }
    } else if (useTinker && cfg.fallback === 'off') {
      throw new ApiError(503, overBudget() ? 'budget' : 'llm-credit');
    } else if (useTinker) {
      const store = llmContext.getStore();
      if (store) store.fallback = true;
    }
    // Ollama: the same body, with the local model's name.
    const local = { ...body, model: useTinker ? cfg.ollama.model : body.model ?? cfg.ollama.model };
    return cfg.ollama.chat(cfg.ollama.url ?? url, local, { ...opts, headers: cfg.ollama.headers ?? opts.headers });
  }

  function status() {
    rollDay();
    return {
      provider: useTinker ? (now() < creditGoneUntil ? 'ollama (tinker paused)' : overBudget() ? 'ollama (budget)' : 'tinker') : 'ollama',
      model: useTinker ? cfg.tinker.model : cfg.ollama.model,
      today: { usd: Math.round(spent.usd * 1000) / 1000, budgetUsd: cfg.dailyBudgetUsd ?? 0, calls: spent.calls, fallbacks: spent.fallbacks },
      ...(lastError ? { lastError } : {}),
    };
  }

  return { chat, model, status, useTinker };
}

// Usage log: one JSON line per paid call (until the database of phase 1 takes over). No text, only counts.
async function record(dir, row) {
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, `llm-usage-${new Date(row.at).toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify(row)}\n`);
  } catch {}
}
async function loadSpent(dir, spent) {
  if (!dir) return;
  try {
    const text = await readFile(path.join(dir, `llm-usage-${spent.day.slice(0, 7)}.jsonl`), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (new Date(r.at).toISOString().slice(0, 10) === spent.day) { spent.usd += r.usd ?? 0; spent.calls++; spent.input += r.input ?? 0; spent.output += r.output ?? 0; }
    }
  } catch {}
}

/** Total spent per day / model from the usage log (for reports and the admin page later). */
export async function usageSummary(dir, month) {
  const out = {};
  try {
    for (const line of (await readFile(path.join(dir, `llm-usage-${month}.jsonl`), 'utf8')).split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line), d = new Date(r.at).toISOString().slice(0, 10);
      out[d] ??= { usd: 0, calls: 0 };
      out[d].usd += r.usd ?? 0; out[d].calls++;
    }
  } catch {}
  return out;
}
