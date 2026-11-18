/**
 * A circle's toolboxes: added by the admin, used by a member, the key never seen (ledger L1035, slice 3).
 *
 * @guard a toolbox's key never appears in a reply, a refusal, a log line or the list of tools, and a toolbox with no key on the box is refused before any call leaves
 *
 * The key comes from the box's operator config (an env value or a key file per toolbox, Fable 2026-11-18); the
 * record (address, command words) lives in the box's vault. `addToolbox` takes the name, the address and the words.
 */
import { describe, it, expect } from 'vitest';
import { makeToolboxOps } from '../../src/v2/toolboxes.js';

const KEY = 'geheime-sleutel-123';
const CARD = { name: 'Boodschappen', supportedInterfaces: [{ url: 'http://boodschappen:3000/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  skills: [{ id: 'products.choices', name: 'Products Choices', description: 'Products to choose from.' }] };
const LIST = { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Product', identifier: 'ah:33693', name: 'Halfvolle melk 1 L', offers: { price: '1.19' } } }] };

function harness({ keys = { boodschappen: KEY }, answer = { operation: 'products.choices', output: LIST } } = {}) {
  const vault = new Map();
  const store = { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } };
  const calls = []; const logs = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/.well-known/agent-card.json')) return { ok: true, status: 200, json: async () => CARD };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { message: { parts: [{ data: answer }] } } }) };
  };
  const ops = makeToolboxOps({ store, keyOf: async (name) => keys[name] ?? null, fetch, log: (...a) => logs.push(JSON.stringify(a)) });
  return { ops, calls, logs, vault };
}
const WORDS = [{ word: 'zoek', tool: 'products.choices', field: 'query' }];
const all = (...xs) => JSON.stringify(xs);

describe('a circle\'s toolboxes', () => {
  it('the admin adds one by its name, address and words; the card is read; nothing of the key is stored or said', async () => {
    const h = harness();
    const r = await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    expect(r).toMatchObject({ ok: true, name: 'boodschappen', tools: ['products.choices'] });
    const list = await h.ops.listTools({});
    expect(list).toMatchObject({ ok: true, toolboxes: [{ name: 'boodschappen', words: WORDS, tools: [{ id: 'products.choices' }] }] });
    expect(all(r, list, [...h.vault.values()], h.logs)).not.toContain(KEY);
  });

  it('adding one whose key is not on the box is refused in a plain code, and nothing is stored', async () => {
    const h = harness({ keys: {} });
    const r = await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    expect(r).toEqual({ ok: false, code: 'toolbox-no-key', name: 'boodschappen' });
    expect((await h.ops.listTools({})).toolboxes).toEqual([]);
  });

  it('a member uses a tool: the key goes in the header only; a list of things comes back as choices', async () => {
    const h = harness();
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'halfvolle melk' } });
    expect(r).toMatchObject({ ok: true, items: [{ label: 'Halfvolle melk 1 L', price: '1.19', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } }] });
    const sent = h.calls.at(-1);
    expect(sent.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(sent.init.body).not.toContain(KEY);
    expect(all(r, h.logs)).not.toContain(KEY);
  });

  it('a toolbox whose key is gone is refused BEFORE any call leaves', async () => {
    const keys = { boodschappen: KEY };
    const h = harness({ keys });
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    const before = h.calls.length;
    delete keys.boodschappen;
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } });
    expect(r).toEqual({ ok: false, code: 'toolbox-no-key', name: 'boodschappen' });
    expect(h.calls.length, 'nothing left the box').toBe(before);
  });

  it('a toolbox not added, or a tool it does not offer, is refused before any call leaves', async () => {
    const h = harness();
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    const before = h.calls.length;
    expect(await h.ops.useTool({ toolbox: 'elders', tool: 'x', input: {} })).toEqual({ ok: false, code: 'toolbox-not-added', name: 'elders' });
    expect(await h.ops.useTool({ toolbox: 'boodschappen', tool: 'lists.create', input: {} })).toEqual({ ok: false, code: 'tool-not-offered', name: 'boodschappen', tool: 'lists.create' });
    expect(h.calls.length).toBe(before);
  });

  it('a tool\'s own error and an answer that is no list come back as codes; the key is in none of them', async () => {
    const h = harness({ answer: { operation: 'products.choices', error: { code: 'invalid_input', params: {} } } });
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    const r = await h.ops.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: {} });
    expect(r).toEqual({ ok: false, code: 'tool-error', toolCode: 'invalid_input', name: 'boodschappen' });
    expect(all(r, h.logs)).not.toContain(KEY);
  });

  it('the words of a command are well formed or refused; removing a toolbox drops it', async () => {
    const h = harness();
    expect((await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: [{ word: '', tool: 'x' }] })).code).toBe('toolbox-bad-words');
    expect((await h.ops.addToolbox({ name: 'Bood schappen!', url: 'http://x', words: WORDS })).code).toBe('toolbox-bad-name');
    expect((await h.ops.addToolbox({ name: 'boodschappen', url: 'ftp://x', words: WORDS })).code).toBe('toolbox-bad-address');
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    expect(await h.ops.removeToolbox({ name: 'boodschappen' })).toEqual({ ok: true, name: 'boodschappen' });
    expect((await h.ops.listTools({})).toolboxes).toEqual([]);
  });
});

describe('a toolbox\'s words reach its tool through the deterministic gate', () => {
  it('"zoek halfvolle melk" and "/zoek halfvolle melk" become useTool with the rest of the line in the named field', async () => {
    const { toolboxGateRule } = await import('../../src/v2/toolboxes.js');
    const h = harness();
    await h.ops.addToolbox({ name: 'boodschappen', url: 'http://boodschappen:3000', words: WORDS });
    const rule = toolboxGateRule(() => h.ops.wordsNow());
    for (const line of ['zoek halfvolle melk', '/zoek halfvolle melk', 'Zoek  halfvolle melk ']) {
      expect(rule.test(line), line).toBe(true);
      expect(rule.command(line)).toEqual({ opId: 'useTool', appOrigin: 'tools', args: { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'halfvolle melk' } } });
    }
    expect(rule.test('zoek')).toBe(false);                 // a word with nothing to ask is not a call
    expect(rule.test('zoekt iemand de sleutel')).toBe(false);
    await h.ops.removeToolbox({ name: 'boodschappen' });
    expect(rule.test('zoek melk'), 'a removed toolbox\'s word reaches nothing').toBe(false);
  });
});
