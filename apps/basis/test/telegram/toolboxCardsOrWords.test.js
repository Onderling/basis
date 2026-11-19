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
import { toolboxGateRule, toolChoicesReply, makeChoiceKeeper } from '../../src/v2/toolboxes.js';

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
});
