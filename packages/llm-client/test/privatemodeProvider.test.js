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
    expect(body.chat_template_kwargs).toEqual({ thinking: false });   // Kimi's switch
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools?.[0]?.function?.name).toBe('addItem');
    expect(r.toolCall).toMatchObject({ id: 'addItem', args: { type: 'shopping', text: 'kaas' } });
  });
  it('each family gets its own switch (gpt-oss low, GLM nothing, thinking on sends nothing); an SDK error surfaces with its status', async () => {
    expect(reasoningBodyFor('gpt-oss-120b')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningBodyFor('glm-5.3')).toBeNull();
    expect(reasoningBodyFor('kimi-k2.6', 'on')).toBeNull();
    const client = fakeClient({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    const p = await privatemodeProvider({ client, model: 'glm-5.3' });
    await p.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }] });
    expect(client.calls[0].body.reasoning_effort).toBeUndefined();
    expect(client.calls[0].body.chat_template_kwargs).toBeUndefined();
    const bad = await privatemodeProvider({ client: fakeClient(Object.assign(new Error('unauthorized'), { status: 401 })) });
    await expect(bad.invoke({ system: 's', messages: [{ role: 'user', content: 'hoi' }] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR', status: 401 });
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

describe('privatemodeProvider — LIVE (skipped without a key)', () => {
  const key = readPrivatemodeKey();
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
