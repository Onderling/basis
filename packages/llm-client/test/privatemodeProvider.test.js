/**
 * The Privatemode provider is the Ollama provider over the SDK: same wire, same parser, the SDK as
 * transport. Unit tests drive a fake SDK client; the live test runs only when a key is present.
 */
import { describe, it, expect } from 'vitest';
import { privatemodeProvider, privatemodeFetch, readPrivatemodeKey, reasoningBodyFor, PRIVATEMODE_DEFAULT_MODEL } from '../src/providers/privatemode.js';

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (body, opts) => { calls.push({ body, opts }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(body) : reply; } } },
  };
}
const toolReply = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'addItem', arguments: '{"type":"shopping","text":"kaas"}' } }] } }] };

describe('privatemodeProvider', () => {
  it('sends an OpenAI chat body through the SDK, never streaming, with the model family\'s thinking switch', async () => {
    const client = fakeClient(toolReply);
    const p = await privatemodeProvider({ client });
    const r = await p.invoke({ system: 'sys', messages: [{ role: 'user', content: 'zet kaas op de lijst' }], tools: [{ id: 'addItem', description: 'add', schema: { type: 'object', properties: {} } }] });
    expect(p.id).toBe('privatemode');
    expect(p.confidential).toBe(true);
    expect(client.calls).toHaveLength(1);
    const body = client.calls[0].body;
    expect(body.model).toBe(PRIVATEMODE_DEFAULT_MODEL);
    expect(body.stream).toBeUndefined();
    expect(body.reasoning_effort).toBe('low');   // the default's family switch: GLM reasons low (it cannot switch off)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools?.[0]?.function?.name).toBe('addItem');
    expect(r.toolCall).toMatchObject({ id: 'addItem', args: { type: 'shopping', text: 'kaas' } });
  });
  it('each family gets its own switch (gpt-oss low, GLM low — it cannot switch reasoning off —, thinking on sends nothing); an SDK error surfaces with its status', async () => {
    expect(reasoningBodyFor('gpt-oss-120b')).toEqual({ reasoning_effort: 'low' });
    // GLM cannot switch reasoning off; nothing sent means max
    expect(reasoningBodyFor('glm-5.3')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningBodyFor('glm-5.3-flash', 'low')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningBodyFor('glm-5.3', 'on')).toBeNull();
    expect(reasoningBodyFor('kimi-k2.6', 'on')).toBeNull();
    const client = fakeClient({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    const p = await privatemodeProvider({ client, model: 'glm-5.3' });
    await p.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }] });
    expect(client.calls[0].body.reasoning_effort).toBe('low');   // nothing sent would be max
    expect(client.calls[0].body.chat_template_kwargs).toBeUndefined();
    const bad = await privatemodeProvider({ client: fakeClient(Object.assign(new Error('unauthorized'), { status: 401 })) });
    await expect(bad.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR', status: 401 });
    // the error names the route it came from, not the transport shape it reuses
    await expect(bad.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }] })).rejects.toThrow(/^privatemode: 401/);
  });
  it('the fetch door answers 404 for anything but chat completions', async () => {
    const f = privatemodeFetch(fakeClient({}));
    const r = await f('https://api.privatemode.ai/v1/embeddings', { method: 'POST', body: '{}' });
    expect(r.status).toBe(404);
  });
  it('without a key or auth it refuses with NO_KEY', async () => {
    expect(readPrivatemodeKey({ env: {}, file: '/nonexistent/key' })).toBeNull();
    // a fake SDK + no key anywhere the provider looks (the env is shadowed, the file does not exist)
    const saved = { ...process.env };
    delete process.env.PRIVATEMODE_API_KEY; process.env.PRIVATEMODE_API_KEY_FILE = '/nonexistent/key';
    try { await expect(privatemodeProvider({ sdk: { PrivatemodeAI: class {} } })).rejects.toMatchObject({ code: 'NO_KEY' }); }
    finally { process.env.PRIVATEMODE_API_KEY_FILE = saved.PRIVATEMODE_API_KEY_FILE; if (saved.PRIVATEMODE_API_KEY) process.env.PRIVATEMODE_API_KEY = saved.PRIVATEMODE_API_KEY; if (!saved.PRIVATEMODE_API_KEY_FILE) delete process.env.PRIVATEMODE_API_KEY_FILE; }
  });
});

// A key file on the machine is not consent to spend its quota: the live call runs only with LIVE_LLM=1 (as
// apps/basis/test/live/ does). One run of this suite on a key-holding laptop once reached the enclave unasked.
describe('privatemodeProvider — LIVE (LIVE_LLM=1 and a key)', () => {
  const key = process.env.LIVE_LLM === '1' ? readPrivatemodeKey() : null;
  const maybe = key ? it : it.skip;
  maybe('attests, encrypts and answers a Dutch tool pick through the real enclave', async () => {
    const p = await privatemodeProvider({ apiKey: key, timeoutMs: 60_000 });
    const r = await p.invoke({
      system: 'Je bent de assistent van een huishouden. Kies precies één tool.',
      messages: [{ role: 'user', content: 'zet kaas op het boodschappenlijstje' }],
      tools: [{ id: 'addItem', description: 'add an item to a household list', schema: { type: 'object', properties: { type: { type: 'string', enum: ['shopping', 'errand'] }, text: { type: 'string' } }, required: ['type', 'text'] } }],
    });
    expect(r.toolCall?.id).toBe('addItem');
    expect(r.toolCall?.args?.type).toBe('shopping');
  }, 90_000);
});

describe('prompt caching: one secret per box, a salt per person', () => {
  const SECRET = 'box-secret-0123456789abcdef0123456789abcdef';
  const req = (cacheKey) => ({ system: 'sys', messages: [{ role: 'user', content: 'hoi' }], ...(cacheKey ? { cacheKey } : {}) });

  it('with a secret: every request carries a cache_salt derived per key — same person same salt, another person another', async () => {
    const client = fakeClient(toolReply);
    const p = await privatemodeProvider({ client, cacheSalt: SECRET });
    await p.invoke(req('telegram:1'));
    await p.invoke(req('telegram:1'));
    await p.invoke(req('telegram:2'));
    await p.invoke(req());
    const salts = client.calls.map((c) => c.body.cache_salt);
    expect(salts[0]).toBe(salts[1]);
    expect(salts[0]).not.toBe(salts[2]);
    expect(salts[3]).toBeTruthy();
    for (const s of salts) {
      expect(s).not.toContain(SECRET);
      expect(Buffer.from(s, 'base64').length).toBeGreaterThanOrEqual(32);   // ≥256 bits, as Privatemode asks
    }
    // the key never travels as the salt (the salt reveals neither the secret nor whose it is)
    expect(salts[0]).not.toContain('telegram');
  });

  it('without a secret: no cache_salt — caching stays off', async () => {
    const client = fakeClient(toolReply);
    const p = await privatemodeProvider({ client });
    await p.invoke(req('telegram:1'));
    expect(client.calls[0].body.cache_salt).toBeUndefined();
    expect(client.calls[0].body.cacheKey).toBeUndefined();
  });
});

describe('one call into the SDK at a time, process-wide', () => {
  // The SDK's attestation runs in one Go/Wasm program per process; two calls that both hit "secret expired" inside it
  // refresh under one mutex and can deadlock the program (the box runner died that way: a person's turn and the hourly
  // key probe, a second apart). A box builds two providers (the model and its fallback), each with its own client —
  // so the gate is the process's, not a client's.
  function refreshingClient(trace) {
    return {
      chat: { completions: { create: async (body, opts) => {
        trace.inFlight += 1; trace.max = Math.max(trace.max, trace.inFlight);
        try {
          // the SDK's refresh-and-retry: a pause inside the call, where a second caller would enter
          await new Promise((r) => { setTimeout(r, 20); });
          if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          return { choices: [{ message: { role: 'assistant', content: body.model } }] };
        } finally { trace.inFlight -= 1; }
      } } },
      models: { list: async () => { trace.listed += 1; return { data: [{ id: 'glm-5.3' }] }; } },
    };
  }
  const ask = { system: 's', messages: [{ role: 'user', content: 'hoi' }] };

  it('a turn on the model and a probe on the fallback, at once: the second waits for the first', async () => {
    const trace = { inFlight: 0, max: 0, listed: 0 };
    const primary = await privatemodeProvider({ client: refreshingClient(trace), model: 'glm-5.3' });
    const fallback = await privatemodeProvider({ client: refreshingClient(trace), model: 'glm-5.3-flash' });
    const out = await Promise.all([primary.invoke(ask), fallback.invoke({ ...ask, options: { maxTokens: 1 } }), primary.invoke(ask)]);
    expect(out.map((r) => r.replyText)).toEqual(['glm-5.3', 'glm-5.3-flash', 'glm-5.3']);
    expect(trace.max).toBe(1);
  });

  it('a caller whose time runs out while it waits never enters the SDK, and the queue moves on', async () => {
    const trace = { inFlight: 0, max: 0, listed: 0 };
    let calls = 0;
    const client = refreshingClient(trace);
    const create = client.chat.completions.create;
    client.chat.completions.create = (...a) => { calls += 1; return create(...a); };
    const door = privatemodeFetch(client);
    const url = 'https://api.privatemode.ai/v1/chat/completions';
    const ctl = new AbortController();
    const first = door(url, { method: 'POST', body: JSON.stringify({ model: 'a' }) });
    const waiting = door(url, { method: 'POST', body: JSON.stringify({ model: 'b' }), signal: ctl.signal });
    ctl.abort();
    const [r1, r2] = await Promise.all([first, waiting]);
    expect(r1.status).toBe(200);
    expect(r2.ok).toBe(false);
    expect(calls).toBe(1);   // the aborted waiter never reached the SDK
    const after = await door(url, { method: 'POST', body: JSON.stringify({ model: 'c' }) });
    expect(after.status).toBe(200);
  });

  it('the models list rides the same gate', async () => {
    const trace = { inFlight: 0, max: 0, listed: 0 };
    const client = refreshingClient(trace);
    const list = client.models.list;
    client.models.list = async () => { trace.inFlight += 1; trace.max = Math.max(trace.max, trace.inFlight); try { await new Promise((r) => { setTimeout(r, 20); }); return await list(); } finally { trace.inFlight -= 1; } };
    const p = await privatemodeProvider({ client });
    await Promise.all([p.invoke(ask), p.listModels()]);
    expect(trace.max).toBe(1);
  });
});
