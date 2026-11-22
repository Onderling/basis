/**
 * One build, a painter per door (ledger L1035, Frits 2026-11-19): a toolbox's things with a picture the box fetched
 * become cards where the door can show pictures of its own: per shop ONE album (Telegram's `sendMediaGroup`, the
 * pictures side by side) and ONE message under it with the numbered lines and the buttons (Frits 2026-11-19: single
 * photos came "loeigroot"). A door that cannot (the in-app bot thread) gets the same things in words, under the same
 * shop heads, and the picture's bytes never leak into the words.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../../src/manifestMerge.js';
import { toolsManifest } from '../../src/v2/toolsManifest.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { toolboxGateRule, toolChoicesReply, makeChoiceKeeper, makeMoreThings, makePickThing, toolChoiceGateRule, choiceThreadOf } from '../../src/v2/toolboxes.js';

const t = (k, v) => (k === 'circle.bot.toolbox_found_row' ? `${v.label} · ${v.more}` : (v ? `${k} ${JSON.stringify(v)}` : k));
const THUMB = { mime: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64') };
const ITEMS = [
  { label: 'Halfvolle melk 1 L', price: '1.19', seller: 'Albert Heijn', thumb: THUMB },
  { label: 'Jumbo halfvolle melk 1 L', price: '1.05', seller: 'Jumbo', thumb: THUMB },
];

async function run(bridge) {
  const keeper = makeChoiceKeeper();
  const callSkill = async (_app, op, _args, ctx) => (op === 'useTool' ? toolChoicesReply({ ok: true, title: 'Boodschappen', items: ITEMS }, { threadId: ctx?.threadId ?? 'x', keeper, t }) : { ok: false });
  const gateRules = [toolboxGateRule(() => [{ word: 'zoek', toolbox: 'boodschappen', tool: 'products.choices', field: 'query' }])];
  const runner = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: toolsManifest }]), manifestsByOrigin: { tools: toolsManifest }, callSkill, gateRules });
  await runner.start();
  await bridge.simulateIncoming({ chatId: '9', text: 'zoek melk', sender: { bridgeUid: '9' } });
  await runner.idle();
}

describe('a toolbox\'s things: cards where a door shows pictures, words where it does not', () => {
  it('a door without pictures: the things in words under their shop heads; no bytes in the words', async () => {
    const bridge = new InMemoryBridge({ id: 'app' });
    await run(bridge);
    const text = bridge.outbox.map((m) => m.text).join('\n');
    expect(text).toMatch(/Albert Heijn:\n1\. Halfvolle melk 1 L/);
    expect(text).toMatch(/Jumbo:\n2\. Jumbo halfvolle melk 1 L/);
    expect(text).not.toContain(THUMB.data);
  });
  it('a shop with ONE picture: no album (Telegram refuses an album of one, and one photo alone is drawn huge); its message with its button', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = [];
    bridge.sendAlbum = async (o) => { albums.push(o); };
    await run(bridge);
    expect(albums).toHaveLength(0);
    expect(bridge.outbox.map((m) => m.text)).toEqual(['Boodschappen:', 'Albert Heijn:\n1. Halfvolle melk 1 L · € 1,19', 'Jumbo:\n2. Jumbo halfvolle melk 1 L · € 1,05']);
    expect(bridge.outbox.slice(1).map((m) => (m.buttons ?? []).map((b) => b.label))).toEqual([['circle.bot.toolbox_pick_button 1'], ['circle.bot.toolbox_pick_button 2']]);
    expect(bridge.outbox.map((m) => m.text).join('\n')).not.toContain(THUMB.data);
  });

  it('per shop ONE album of its cards, a number in each caption, and ONE message under it with the lines and the buttons', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = [];
    bridge.sendAlbum = async (o) => { albums.push(o); };
    const items = [...[1, 2, 3].map((i) => ({ label: `AH ${i}`, seller: 'Albert Heijn', thumb: THUMB })), ...[1, 2, 3].map((i) => ({ label: `Jumbo ${i}`, seller: 'Jumbo', thumb: THUMB }))];
    const { say } = await runner2(bridge, items);
    await say('zoek melk');
    expect(albums.map((a) => a.pictures.map((p) => p.caption))).toEqual([['1. AH 1', '2. AH 2', '3. AH 3'], ['4. Jumbo 1', '5. Jumbo 2', '6. Jumbo 3']]);
    expect(albums.every((a) => a.pictures.every((p) => Buffer.from(p.photo).length > 0))).toBe(true);
    // an album carries no buttons; the message under it does: one per card, with its number, on one row
    expect(bridge.outbox.map((m) => m.text)).toEqual(['Boodschappen:', 'Albert Heijn:\n1. AH 1\n2. AH 2\n3. AH 3', 'Jumbo:\n4. Jumbo 1\n5. Jumbo 2\n6. Jumbo 3']);
    const ah = bridge.outbox[1].buttons;
    expect(ah.map((b) => b.label)).toEqual(['circle.bot.toolbox_pick_button 1', 'circle.bot.toolbox_pick_button 2', 'circle.bot.toolbox_pick_button 3']);
    expect(ah.every((b) => b.row === 0 && /^pickThing:[a-z0-9]+\.[123]$/.test(b.id))).toBe(true);
  });

  it('a shop where only some cards have a picture: the album holds those (two or more); every card keeps its line and button', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = []; bridge.sendAlbum = async (o) => { albums.push(o); };
    const { say } = await runner2(bridge, [{ label: 'Melk 1', seller: 'Jumbo', thumb: THUMB }, { label: 'Melk 2', seller: 'Jumbo' }, { label: 'Melk 3', seller: 'Jumbo', thumb: THUMB }]);
    await say('zoek melk');
    expect(albums.map((a) => a.pictures.map((p) => p.caption))).toEqual([['1. Melk 1', '3. Melk 3']]);
    expect(bridge.outbox.at(-1).text).toBe('Jumbo:\n1. Melk 1\n2. Melk 2\n3. Melk 3');
    expect(bridge.outbox.at(-1).buttons).toHaveLength(3);
  });

  // a runner over a callSkill that answers useTool with `items`, and moreThings from the same keeper
  async function runner2(bridge, items) {
    const keeper = makeChoiceKeeper();
    const moreThings = makeMoreThings({ keeper, t });
    const callSkill = async (_app, op, args, ctx) => {
      if (op === 'useTool') return toolChoicesReply({ ok: true, title: 'Boodschappen', items }, { threadId: ctx?.threadId ?? 'x', keeper, t });
      if (op === 'moreThings') return moreThings(args, ctx);
      return { ok: false };
    };
    const gateRules = [toolboxGateRule(() => [{ word: 'zoek', toolbox: 'boodschappen', tool: 'products.choices', field: 'query' }])];
    const r = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: toolsManifest }]), manifestsByOrigin: { tools: toolsManifest }, callSkill, gateRules });
    await r.start();
    const say = async (text) => { await bridge.simulateIncoming({ chatId: '9', text, sender: { bridgeUid: '9' } }); await r.idle(); };
    return { say, keeper };
  }
  const captions = (albums) => albums.flatMap((a) => a.pictures.map((p) => p.caption));
  const meerOf = (bridge) => bridge.outbox.flatMap((m) => m.buttons ?? []).filter((b) => String(b.id).startsWith('/meer '));

  it('more than 3 from one shop: 3 cards and ONE "meer" button in the same message; its tap shows the next ones with their own numbers (Frits)', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = []; bridge.sendAlbum = async (o) => { albums.push(o); };
    const { say } = await runner2(bridge, [1, 2, 3, 4, 5].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB })));
    await say('zoek melk');
    expect(captions(albums)).toEqual(['1. Melk 1', '2. Melk 2', '3. Melk 3']);
    const meer = meerOf(bridge);
    expect(meer).toHaveLength(1);
    expect(meer[0]).toMatchObject({ row: 1 });
    expect(meer[0].label).toContain('circle.telegram.more_of');
    expect(Buffer.byteLength(meer[0].id)).toBeLessThanOrEqual(64);
    // the cards' buttons and "meer" ride on ONE message
    const msg = bridge.outbox.at(-1);
    expect(msg.text).toBe('Jumbo:\n1. Melk 1\n2. Melk 2\n3. Melk 3');
    expect(msg.buttons.map((b) => b.id.startsWith('/meer ') ? 'meer' : 'kies')).toEqual(['kies', 'kies', 'kies', 'meer']);
    // the words of the rest are not painted: the button stands for them
    expect(bridge.outbox.map((m) => m.text).join('\n')).not.toMatch(/4\. Melk 4/);
    albums.length = 0; bridge.clearOutbox();
    await say(meer[0].id);
    expect(captions(albums)).toEqual(['4. Melk 4', '5. Melk 5']);
    expect(meerOf(bridge)).toHaveLength(0);
    // and a card's own button still picks THAT thing (its number in the kept list)
    expect(bridge.outbox.at(-1).buttons[0].id).toMatch(/\.4$/);
  });

  it('two shops: "meer" of the SECOND shop gives the second shop\'s things, with their own numbers', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = []; bridge.sendAlbum = async (o) => { albums.push(o); };
    const items = [...[1, 2, 3, 4].map((i) => ({ label: `AH ${i}`, seller: 'Albert Heijn', thumb: THUMB })), ...[1, 2, 3, 4, 5].map((i) => ({ label: `Jumbo ${i}`, seller: 'Jumbo', thumb: THUMB }))];
    const { say } = await runner2(bridge, items);
    await say('zoek melk');
    const meer = meerOf(bridge);
    expect(meer).toHaveLength(2);
    albums.length = 0; bridge.clearOutbox();
    await say(meer[1].id);
    expect(captions(albums)).toEqual(['8. Jumbo 4', '9. Jumbo 5']);
  });

  it('"meer" for a list no longer kept answers in words, and shows nothing old', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const albums = []; bridge.sendAlbum = async (o) => { albums.push(o); };
    const { say } = await runner2(bridge, [1, 2, 3, 4].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB })));
    await say('zoek melk');
    const meer = meerOf(bridge)[0];
    await say('zoek melk');   // a newer list is kept: the older button names a list that is gone
    albums.length = 0; bridge.clearOutbox();
    await say(meer.id);
    expect(albums).toHaveLength(0);
    expect(bridge.outbox.map((m) => m.text).join('\n')).toContain('circle.bot.toolbox_more_gone');
  });

  it('an album Telegram will not take: the message still comes, with every line and button', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    bridge.sendAlbum = async () => { throw new Error('too big'); };
    const { say } = await runner2(bridge, [1, 2, 3].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB })));
    await say('zoek melk');
    expect(bridge.outbox.at(-1).text).toBe('Jumbo:\n1. Melk 1\n2. Melk 2\n3. Melk 3');
    expect(bridge.outbox.at(-1).buttons).toHaveLength(3);
  });

  it('the in-app thread: a typed "2" picks the second thing, so the gate rule and the op key the kept list the same way', async () => {
    const bridge = new InMemoryBridge({ id: 'app' });
    const keeper = makeChoiceKeeper();
    const put = [];
    const pickThing = makePickThing({ keeper, callSkill: async (_a, op, args) => { put.push({ op, args }); return op === 'listLists' ? { ok: true, items: [{ id: 'L1', type: 'list', label: 'Boodschappen' }] } : { ok: true }; }, shoppingList: () => 'Boodschappen' });
    const callSkill = async (_app, op, args, ctx) => {
      if (op === 'useTool') return toolChoicesReply({ ok: true, title: 'Boodschappen', items: [{ label: 'Melk A', seller: 'AH', ref: { type: 'Product', ref: 'a' } }, { label: 'Melk B', seller: 'AH', ref: { type: 'Product', ref: 'b' } }] }, { threadId: choiceThreadOf(ctx), keeper, t });
      if (op === 'pickThing') return pickThing(args, ctx, t);
      return { ok: false };
    };
    const gateRules = [toolboxGateRule(() => [{ word: 'zoek', toolbox: 'boodschappen', tool: 'products.choices', field: 'query' }]), toolChoiceGateRule(keeper)];
    const r = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: toolsManifest }]), manifestsByOrigin: { tools: toolsManifest }, callSkill, gateRules });
    await r.start();
    await bridge.simulateIncoming({ chatId: '9', text: 'zoek melk', sender: { bridgeUid: '9' } }); await r.idle();
    await bridge.simulateIncoming({ chatId: '9', text: '2', sender: { bridgeUid: '9' } }); await r.idle();
    expect(put.find((p) => p.op === 'addToList')?.args, 'the second thing went on the list').toMatchObject({ list: 'Boodschappen', text: 'Melk B' });
  });
  it('choiceThreadOf: one key for the gate (ctx.id) and the op (ctx.threadId) of the same thread', () => {
    expect(choiceThreadOf({ threadId: 'tg:9', caller: 'telegram:9' })).toBe('tg:9');
    expect(choiceThreadOf({ id: 'tg:9' })).toBe('tg:9');
    expect(choiceThreadOf({ caller: 'telegram:9' })).toBe('telegram:9');
    expect(choiceThreadOf(null)).toBeNull();
  });
});

