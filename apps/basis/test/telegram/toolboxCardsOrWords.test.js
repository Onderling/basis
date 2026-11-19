/**
 * One build, a painter per door (ledger L1035, Frits 2026-11-19): a toolbox's things with a picture the box fetched
 * become photo cards where the door can show a picture of its own (Telegram's `sendPhoto`); a door that cannot (the
 * in-app bot thread) gets the same things in words, under the same shop heads, and the picture's bytes never leak into
 * the words.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../../src/manifestMerge.js';
import { toolsManifest } from '../../src/v2/toolsManifest.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { toolboxGateRule, toolChoicesReply, makeChoiceKeeper, makeMoreThings } from '../../src/v2/toolboxes.js';

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
  it('a door with pictures: a photo card per thing, the shop heads as lines before them', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const photos = [];
    bridge.sendPhoto = async (o) => { photos.push(o); };
    await run(bridge);
    expect(photos.map((p) => p.caption)).toEqual([expect.stringMatching(/^1\. Halfvolle melk/), expect.stringMatching(/^2\. Jumbo halfvolle melk/)]);
    expect(photos.every((p) => Buffer.from(p.photo).length > 0 && p.buttons.length === 1)).toBe(true);
    expect(bridge.outbox.map((m) => m.text)).toEqual(['Boodschappen:', 'Albert Heijn:', 'Jumbo:']);
  });

  it('more than 3 from one shop: 3 cards and ONE "meer" button; its tap shows the next ones with their own numbers (Frits)', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const photos = [];
    bridge.sendPhoto = async (o) => { photos.push(o); };
    const five = [1, 2, 3, 4, 5].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB }));
    const keeper = makeChoiceKeeper();
    const moreThings = makeMoreThings({ keeper, t });
    const callSkill = async (_app, op, args, ctx) => {
      if (op === 'useTool') return toolChoicesReply({ ok: true, title: 'Boodschappen', items: five }, { threadId: ctx?.threadId ?? 'x', keeper, t });
      if (op === 'moreThings') return moreThings(args, ctx);
      return { ok: false };
    };
    const gateRules = [toolboxGateRule(() => [{ word: 'zoek', toolbox: 'boodschappen', tool: 'products.choices', field: 'query' }])];
    const runner = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: toolsManifest }]), manifestsByOrigin: { tools: toolsManifest }, callSkill, gateRules });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '9', text: 'zoek melk', sender: { bridgeUid: '9' } });
    await runner.idle();
    expect(photos.map((p) => p.caption)).toEqual(['1. Melk 1', '2. Melk 2', '3. Melk 3']);
    const meer = bridge.outbox.flatMap((m) => m.buttons ?? []).filter((b) => String(b.id).startsWith('/meer '));
    expect(meer).toHaveLength(1);
    expect(meer[0].label).toContain('circle.telegram.more_of');
    expect(Buffer.byteLength(meer[0].id)).toBeLessThanOrEqual(64);
    // the words of the rest are not painted any more: the button stands for them
    expect(bridge.outbox.map((m) => m.text).join('\n')).not.toMatch(/4\. Melk 4/);
    photos.length = 0; bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '9', text: meer[0].id, sender: { bridgeUid: '9' } });
    await runner.idle();
    expect(photos.map((p) => p.caption)).toEqual(['4. Melk 4', '5. Melk 5']);
    expect(bridge.outbox.flatMap((m) => m.buttons ?? []).filter((b) => String(b.id).startsWith('/meer '))).toHaveLength(0);
    // and a card's own button still picks THAT thing (its number in the kept list)
    expect(photos[0].buttons[0].id).toMatch(/\.4$/);
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

  it('two shops: "meer" of the SECOND shop gives the second shop\'s things, with their own numbers', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const photos = []; bridge.sendPhoto = async (o) => { photos.push(o); };
    const items = [...[1, 2, 3, 4].map((i) => ({ label: `AH ${i}`, seller: 'Albert Heijn', thumb: THUMB })), ...[1, 2, 3, 4, 5].map((i) => ({ label: `Jumbo ${i}`, seller: 'Jumbo', thumb: THUMB }))];
    const { say } = await runner2(bridge, items);
    await say('zoek melk');
    const meer = bridge.outbox.flatMap((m) => m.buttons ?? []).filter((b) => String(b.id).startsWith('/meer '));
    expect(meer).toHaveLength(2);
    photos.length = 0; bridge.clearOutbox();
    await say(meer[1].id);
    expect(photos.map((p) => p.caption)).toEqual(['8. Jumbo 4', '9. Jumbo 5']);
  });

  it('"meer" for a list no longer kept answers in words, and shows nothing old', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const photos = []; bridge.sendPhoto = async (o) => { photos.push(o); };
    const { say } = await runner2(bridge, [1, 2, 3, 4].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB })));
    await say('zoek melk');
    const meer = bridge.outbox.flatMap((m) => m.buttons ?? []).find((b) => String(b.id).startsWith('/meer '));
    await say('zoek melk');   // a newer list is kept: the older button names a list that is gone
    photos.length = 0; bridge.clearOutbox();
    await say(meer.id);
    expect(photos).toHaveLength(0);
    expect(bridge.outbox.map((m) => m.text).join('\n')).toContain('circle.bot.toolbox_more_gone');
  });

  it('a photo that cannot be sent becomes that thing\'s words line with its button; the rest still comes', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const photos = [];
    bridge.sendPhoto = async (o) => { if (o.caption.startsWith('1.')) throw new Error('too big'); photos.push(o); };
    const { say } = await runner2(bridge, [1, 2, 3].map((i) => ({ label: `Melk ${i}`, seller: 'Jumbo', thumb: THUMB })));
    await say('zoek melk');
    expect(photos.map((p) => p.caption)).toEqual(['2. Melk 2', '3. Melk 3']);
    const line = bridge.outbox.find((m) => /^1\. Melk 1/.test(m.text ?? ''));
    expect(line, 'the first thing in words').toBeTruthy();
    expect((line.buttons ?? []).length).toBe(1);
  });
});
