/**
 * A toolbox's own page (ledger L1035) calls `useTool` through the household bot's door, as a connected screen.
 * Two things that used to be one are split: "no button on the management screen" (a toolbox and an input object mean
 * nothing to a person) and "not callable by a screen" (the A2A `never`). useTool is the first: granted and callable,
 * never painted. What a screen gets back is the toolbox's own answer; an answer too large for one envelope is refused
 * with a clear code, never cut.
 */
import { describe, it, expect } from 'vitest';
import { renderA2A } from '@onderling/app-manifest';
import { MAX_ENVELOPE_BYTES } from '@onderling/core';
import { composeAssistantCatalogue } from '../../src/assistant/assistantCatalogue.js';
import { screenColumnFor, BOT_SCREEN_NEVER, SCREEN_NO_BUTTON, screenAnswerFits } from '../../src/v2/screenActing.js';
import { screenPanelsForGrant } from '../../src/v2/screenPaint.js';
import { toolsManifest } from '../../src/v2/toolsManifest.js';
import { makeToolboxOps } from '../../src/v2/toolboxes.js';

const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });

describe('useTool: callable by a screen, no button on the management screen', () => {
  it('is in a member\'s screen column and is not a `never` at the door', () => {
    expect(screenColumnFor(catalogue, 'member')).toContain('tools.useTool');
    expect(BOT_SCREEN_NEVER).not.toContain('tools.useTool');
    const skill = renderA2A([toolsManifest], { callSkill: async () => ({}) }, { never: BOT_SCREEN_NEVER }).find((s) => s.id === 'tools.useTool');
    expect(skill?.policy).not.toBe('never');
  });
  it('the management screen paints no button for it (a screen may hold it all the same)', () => {
    expect(SCREEN_NO_BUTTON).toContain('tools.useTool');
    const items = screenPanelsForGrant(['tools.useTool', 'tools.listTools', 'lists.listEntries'], (k) => k).flatMap((p) => p.items.map((i) => i.skill));
    expect(items).not.toContain('tools.useTool');
    expect(items).toContain('tools.listTools');
  });
});

const KEY = 'k';
const CARD = { name: 'Boodschappen', supportedInterfaces: [{ url: 'http://boodschappen:3000/a2a' }], skills: [{ id: 'products.search' }, { id: 'products.choices' }] };
const PLACED = { name: 'boodschappen', url: 'http://boodschappen:3000', words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }] };
function ops(answer) {
  const vault = new Map();
  const store = { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } };
  const fetch = async (url) => (url.endsWith('/.well-known/agent-card.json')
    ? { ok: true, status: 200, json: async () => CARD }
    : { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { message: { parts: [{ data: answer }] } } }) });
  return makeToolboxOps({ store, placedOf: async () => [PLACED], keyOf: async () => KEY, fetch });
}

describe('what a screen gets back from useTool', () => {
  it('a screen\'s success carries the toolbox\'s own output, unchanged; a chat door\'s does not', async () => {
    const output = { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Product', identifier: 'ah:1', name: 'Melk' } }] };
    const o = ops({ operation: 'products.choices', output }); await o.load(); await o.addToolbox({ name: 'boodschappen', confirm: true });
    const r = await o.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, { pictures: false, forScreen: true });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(output);
    // a chat door's reply carries no raw output: half the bytes, and none of the shops' image addresses the rows dropped
    const chat = await o.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, { pictures: false });
    expect(chat.output).toBeUndefined();
    expect(chat.items?.[0]?.label).toBe('Melk');
    expect(r.items?.[0]?.label).toBe('Melk');
  });
  it('a tool\'s own error keeps its code AND its params', async () => {
    const o = ops({ operation: 'products.search', error: { code: 'too-many', params: { max: 24 } } }); await o.load(); await o.addToolbox({ name: 'boodschappen', confirm: true });
    const r = await o.useTool({ toolbox: 'boodschappen', tool: 'products.search', input: {} }, { pictures: false });
    expect(r).toMatchObject({ ok: false, code: 'tool-error', toolError: { code: 'too-many', params: { max: 24 } } });
  });
});

describe('an answer too large for one envelope', () => {
  it('is refused with a clear code, never cut; a normal answer passes as it is', () => {
    const small = { ok: true, output: { a: 1 } };
    expect(screenAnswerFits(small)).toBe(small);
    const big = { ok: true, output: { blob: 'x'.repeat(MAX_ENVELOPE_BYTES) } };
    expect(screenAnswerFits(big)).toMatchObject({ ok: false, code: 'answer-too-large' });
  });
});
