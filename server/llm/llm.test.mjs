import { describe, expect, it } from 'vitest';
import { createLlm, toAnthropic, fromAnthropic, tokens } from './index.mjs';

const answer = (input, usage = { input_tokens: 100, output_tokens: 50 }) =>
  ({ status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'submit', input }], usage }) });
const status = (n) => ({ status: n, json: async () => ({ error: { type: 'x' } }) });

function setup(responses, cfg = {}) {
  const seen = [], local = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body), headers: init.headers }); const r = responses.shift(); return typeof r === 'function' ? r() : r; };
  const llm = createLlm({
    provider: 'tinker', fallback: 'ollama', concurrency: 4, priceIn: 2, priceOut: 4, dailyBudgetUsd: 0,
    tinker: { url: 'https://tinker.example/api', key: 'tml-test', model: 'org/Big' },
    ollama: { model: 'gemma3', chat: async (url, body) => { local.push(body); return { status: 200, content: '{"1":"local"}' }; } },
    ...cfg,
  }, { fetchImpl, sleep: async () => {}, random: () => 0.5 });
  return { llm, seen, local };
}
const body = { model: 'org/Big', format: { type: 'object', properties: { 1: { type: 'string' } }, required: ['1'] },
  options: { temperature: 0.1, num_predict: 100 }, messages: [{ role: 'system', content: 'Translate.' }, { role: 'user', content: '{"1":"Hoi"}' }] };

describe('Tinker provider', () => {
  it('turns the schema into a forced tool and the tool input back into JSON text', async () => {
    const { llm, seen } = setup([answer({ 1: 'Merhaba' })]);
    const r = await llm.chat('ignored', body);
    expect(JSON.parse(r.content)).toEqual({ 1: 'Merhaba' });
    const req = seen[0].body;
    expect(seen[0].url).toBe('https://tinker.example/api/v1/messages');
    expect(seen[0].headers['x-api-key']).toBe('tml-test');
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'submit' });
    expect(req.tools[0].input_schema).toEqual(body.format);
    expect(req.system).toContain('Translate.');
    expect(req.messages).toEqual([{ role: 'user', content: '{"1":"Hoi"}' }]);
    expect(req.thinking).toEqual({ type: 'disabled' });
  });
  it('retries a 429 and then succeeds', async () => {
    const { llm, local } = setup([status(429), answer({ 1: 'ok' })]);
    expect(JSON.parse((await llm.chat('', body)).content)).toEqual({ 1: 'ok' });
    expect(local).toHaveLength(0);
  });
  it('after three failures the local model answers', async () => {
    const { llm, local } = setup([status(429), status(500), status(503)]);
    expect((await llm.chat('', body)).content).toBe('{"1":"local"}');
    expect(local[0].model).toBe('gemma3');
    expect(llm.status().today.fallbacks).toBe(1);
  });
  it('when the credit is gone it stops asking Tinker for an hour', async () => {
    const { llm, seen, local } = setup([status(402)]);
    await llm.chat('', body);
    await llm.chat('', body);
    expect(seen).toHaveLength(1);
    expect(local).toHaveLength(2);
    expect(llm.status().provider).toMatch(/ollama/);
  });
  it('counts the cost and falls back once the daily budget is spent', async () => {
    // 1000 input + 500 output tokens at 2 $ / 4 $ per million = 0.004 $
    const { llm, seen, local } = setup([answer({ 1: 'a' }, { input_tokens: 400, cache_creation_input_tokens: 600, output_tokens: 500 }), answer({ 1: 'b' })], { dailyBudgetUsd: 0.004 });
    await llm.chat('', body);
    expect(llm.status().today.usd).toBeCloseTo(0.004, 6);
    await llm.chat('', body);
    expect(seen).toHaveLength(1);
    expect(local).toHaveLength(1);
  });
  it('without a key it is the local model', async () => {
    const { llm, local } = setup([], { tinker: { url: 'x', key: '', model: 'org/Big' } });
    await llm.chat('', body);
    expect(local).toHaveLength(1);
    expect(llm.status().provider).toBe('ollama');
  });
  it('plain text answers and token counting', () => {
    expect(fromAnthropic({ content: [{ type: 'text', text: 'Hallo' }] })).toBe('Hallo');
    expect(tokens({ input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 })).toEqual({ input: 6, output: 4 });
    expect(toAnthropic({ messages: [{ role: 'user', content: 'x' }], options: {} }, 'm').tools).toBeUndefined();
  });
});

describe('when the model skips the tool', () => {
  const noTool = { status: 422, json: async () => ({ error: { type: 'invalid_request_error', message: 'model returned no tool call when tool_choice required one' } }) };
  it('asks again, then without the tool', async () => {
    const text = { status: 200, json: async () => ({ content: [{ type: 'text', text: '{"1":"Merhaba"}' }], usage: {} }) };
    const { llm, seen, local } = setup([noTool, noTool, text]);
    expect((await llm.chat('', body)).content).toBe('{"1":"Merhaba"}');
    expect(seen).toHaveLength(3);
    expect(seen[2].body.tools).toBeUndefined();
    expect(seen[2].body.system).toContain('JSON schema');
    expect(local).toHaveLength(0);
  });
  it('marks the request when the local model had to answer, so it is not cached', async () => {
    const { llmContext, fellBack } = await import('./index.mjs');
    const { llm } = setup([status(500), status(500), status(500)]);
    const seenFallback = await llmContext.run({}, async () => { await llm.chat('', body); return fellBack(); });
    expect(seenFallback).toBe(true);
    const { llm: ok } = setup([answer({ 1: 'a' })]);
    expect(await llmContext.run({}, async () => { await ok.chat('', body); return fellBack(); })).toBe(false);
  });
});

describe('calls that must not reach the local model', () => {
  it('noFallback: a failing or unusable Tinker throws instead of asking Ollama', async () => {
    const { llm, local } = setup([status(500), status(500), status(500)]);
    await expect(llm.chat('', body, { noFallback: true }, 'grammar')).rejects.toMatchObject({ code: 'llm-failed' });
    expect(local).toHaveLength(0);
    const off = setup([], { provider: 'ollama' });
    await expect(off.llm.chat('', body, { noFallback: true }, 'grammar')).rejects.toMatchObject({ code: 'llm-local' });
    expect(off.local).toHaveLength(0);
  });
  it('counts spending per purpose for the day', async () => {
    const { llm } = setup([answer({ 1: 'a' }), answer({ 1: 'b' })]);
    await llm.chat('', body, {}, 'grammar');
    await llm.chat('', body, {}, 'translate');
    expect(await llm.spentToday('grammar')).toBeCloseTo((100 * 2 + 50 * 4) / 1e6);
    expect(await llm.spentToday('define')).toBe(0);
  });
});
