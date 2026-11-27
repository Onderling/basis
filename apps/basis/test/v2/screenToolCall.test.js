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
import { makeToolboxOps, toolPicturesFor } from '../../src/v2/toolboxes.js';

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
  it('pictures are left out, the last first, until the answer fits; the output itself is never cut', () => {
    const third = Math.floor(MAX_ENVELOPE_BYTES * 0.3);
    const pic = (c) => ({ mime: 'image/jpeg', data: c.repeat(third) });
    const answer = { ok: true, output: { a: 1 }, thumbs: { 'ah:1': pic('a'), 'ah:2': pic('b'), 'ah:3': pic('c') } };
    const r = screenAnswerFits(answer);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ a: 1 });
    // three pictures of 30% each do not fit under 70%, two do: the LAST is left out, the first (the cards') stay
    expect(Object.keys(r.thumbs)).toEqual(['ah:1', 'ah:2']);
    expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThanOrEqual(Math.floor(MAX_ENVELOPE_BYTES * 0.7));
    // identifiers that look like whole numbers: an object lists them ascending ('12' before '900') whatever order they
    // were put in, so the drop order comes from the answer's own list, never from the map's keys
    const row = (id, seller) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name: id, offers: { seller: { name: seller } } } });
    const list = { '@type': 'ItemList', itemListElement: [row('900', 'AH'), row('901', 'AH'), row('902', 'AH'), row('12', 'AH')] };
    const big2 = Math.floor(MAX_ENVELOPE_BYTES * 0.4);
    const numbered = { ok: true, output: list, thumbs: { 900: { mime: 'image/jpeg', data: 'a'.repeat(big2) }, 12: { mime: 'image/jpeg', data: 'b'.repeat(big2) } } };
    expect(Object.keys(numbered.thumbs)).toEqual(['12', '900']);
    // '900' is a card (the first three of its shop), '12' is behind "meer": '12' goes, '900' stays
    expect(Object.keys(screenAnswerFits(numbered).thumbs)).toEqual(['900']);
    // an output too large on its own is still refused, pictures or not
    const big = { ok: true, output: { blob: 'x'.repeat(MAX_ENVELOPE_BYTES) }, thumbs: { 'ah:1': pic('a') } };
    expect(screenAnswerFits(big)).toMatchObject({ ok: false, code: 'answer-too-large' });
  });
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
function opsWithPictures(answer) {
  const vault = new Map();
  const store = { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } };
  const fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/.well-known/agent-card.json')) return { ok: true, status: 200, json: async () => CARD };
    if (u.includes('/img/')) return { ok: true, status: 200, arrayBuffer: async () => JPEG.buffer.slice(0) };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { message: { parts: [{ data: answer }] } } }) };
  };
  return makeToolboxOps({ store, placedOf: async () => [PLACED], keyOf: async () => KEY, fetch });
}

describe('pictures for a screen (a toolbox page cannot load the toolbox\'s own image address itself)', () => {
  const thing = (id, seller) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name: id, image: `http://boodschappen:3000/img/${id}.jpg`, offers: { price: '1.00', seller: { name: seller } } } });
  const output = { '@type': 'ItemList', itemListElement: [thing('ah:1', 'AH'), thing('ah:2', 'AH'), thing('jumbo:1', 'Jumbo')] };
  it('a screen that asks for pictures gets `thumbs` by identifier beside the unchanged output; the rows carry none', async () => {
    const o = opsWithPictures({ operation: 'products.choices', output }); await o.load(); await o.addToolbox({ name: 'boodschappen', confirm: true });
    const r = await o.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, { pictures: true, forScreen: true });
    expect(r.output).toEqual(output);
    expect(Object.keys(r.thumbs)).toEqual(['ah:1', 'ah:2', 'jumbo:1']);
    expect(r.thumbs['ah:1']).toEqual({ mime: 'image/jpeg', data: Buffer.from(JPEG).toString('base64') });
    // the bytes ride once: in the map, not again on the rows
    expect(r.items.some((x) => x.thumb)).toBe(false);
  });
  it('a screen that does not ask gets no pictures; a chat door keeps them on its rows, with no map', async () => {
    const o = opsWithPictures({ operation: 'products.choices', output }); await o.load(); await o.addToolbox({ name: 'boodschappen', confirm: true });
    const plain = await o.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, { pictures: false, forScreen: true });
    expect(plain.thumbs).toBeUndefined();
    const chat = await o.useTool({ toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, { pictures: true });
    expect(chat.thumbs).toBeUndefined();
    expect(chat.items.every((x) => x.thumb?.mime === 'image/jpeg')).toBe(true);
  });
  it('the door decides: a screen\'s own `pictures` ask, a chat door\'s ability to show a photo', () => {
    expect(toolPicturesFor({ pictures: true }, { via: 'screen' }, () => false)).toBe(true);
    expect(toolPicturesFor({}, { via: 'screen' }, () => true)).toBe(false);
    expect(toolPicturesFor({ pictures: true }, { chatId: 'c' }, () => false)).toBe(false);
    expect(toolPicturesFor({}, { chatId: 'c' }, (id) => id === 'c')).toBe(true);
  });
  it('useTool declares the optional `pictures` ask, so a screen\'s call passes the door', () => {
    const op = toolsManifest.operations.find((x) => x.id === 'useTool');
    expect(op.params.find((p) => p.name === 'pictures')).toMatchObject({ kind: 'boolean', required: false });
  });
});
