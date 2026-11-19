/**
 * A list of things from a toolbox, with a button each; the tap puts the thing on a list (ledger L1035).
 *
 * @guard a toolbox's list of things gets one /kies button per thing, and the tap adds THAT thing (its reference, quantity 1) to the seller's list, else the shopping list, else asks, as the person who tapped and only from the thread it was shown in
 *
 * A button's id comes back to the door as a typed line (`layoutButtons`, Telegram's `callback_data`, at most 64 bytes),
 * so a button carries only an index; the box keeps the last list per thread. The tap is the answer to "which one", an
 * op whose argument is that index, so a flow's choice step can later give the same answer (L1039).
 */
import { describe, it, expect } from 'vitest';
import { makeChoiceKeeper, toolChoicesReply, makePickThing } from '../../src/v2/toolboxes.js';
import { toolsManifest } from '../../src/v2/toolsManifest.js';
import { renderReply } from '../../src/renderer.js';

const t = (k, p) => `${k}${p ? ` ${JSON.stringify(p)}` : ''}`;
const ITEMS = [
  { label: 'Halfvolle melk 1 L', detail: 'AH', price: '1.19', seller: 'Albert Heijn', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } },
  { label: 'Jumbo halfvolle melk 1 L', price: '1.05', seller: 'Jumbo', ref: { type: 'Product', ref: 'jumbo:753536PAK', source: 'boodschappen' } },
  { label: 'Biologische melk', seller: 'Ekoplaza', ref: { type: 'Product', ref: 'eko:1', source: 'boodschappen' } },
];

describe('the reply: a line and a button per thing', () => {
  it('each thing is a row with its detail and one button that answers "this one" (pickThing:<n>, under Telegram\'s 64 bytes), as the painter renders it', () => {
    const keeper = makeChoiceKeeper();
    const r = toolChoicesReply({ ok: true, name: 'boodschappen', title: 'Boodschappen', items: ITEMS }, { threadId: 'telegram:1', keeper, t });
    expect(r.ok).toBe(true);
    // what reaches a person: the list as the door's renderer paints it (useTool's reply is a list)
    // the buttons are the tools manifest's own row button (the shared row buttons), not built by the reply
    const painted = renderReply({ shape: 'list', payload: r }, { t, appOrigin: 'tools', manifestsByOrigin: { tools: toolsManifest } });
    expect(painted.kind).toBe('list');
    expect(painted.title).toBe('Boodschappen');
    expect(painted.items[0].label).toContain('Halfvolle melk 1 L');
    expect(painted.items[0].label).toContain('€ 1,19');
    expect(painted.items.map((i) => i.buttons.map((b) => b.callbackData))).toEqual([['pickThing:1'], ['pickThing:2'], ['pickThing:3']]);
    expect(painted.items[0].buttons[0].label).toBe('circle.bot.toolbox_pick_button');
    for (const i of painted.items) for (const b of i.buttons) expect(Buffer.byteLength(b.callbackData)).toBeLessThanOrEqual(64);
    // what goes on the list is the thing's own name, not the row's detail
    expect(keeper.take('telegram:1', 2)?.label).toBe('Jumbo halfvolle melk 1 L');
  });
  it('a reply with no things, or a refusal, passes unchanged and keeps nothing', () => {
    const keeper = makeChoiceKeeper();
    const none = { ok: true, items: [], message: 'niets' };
    expect(toolChoicesReply(none, { threadId: 'x', keeper, t })).toBe(none);
    const no = { ok: false, code: 'toolbox-off' };
    expect(toolChoicesReply(no, { threadId: 'x', keeper, t })).toBe(no);
    expect(keeper.take('x', 1)).toBeNull();
  });
  it('the next list replaces the last; another thread has its own; an old list is gone', () => {
    let now = 1_000;
    const keeper = makeChoiceKeeper({ now: () => now, keepMs: 60_000 });
    keeper.keep('a', ITEMS); keeper.keep('b', [ITEMS[2]]);
    expect(keeper.take('a', 3)?.label).toBe('Biologische melk');
    expect(keeper.take('b', 1)?.label).toBe('Biologische melk');
    keeper.keep('a', [ITEMS[1]]);
    expect(keeper.take('a', 2)).toBeNull();
    now += 60_001;
    expect(keeper.take('a', 1)).toBeNull();
  });
});

function door({ lists = [{ id: 'L1', label: 'Boodschappen', type: 'list' }, { id: 'L2', label: 'Albert Heijn', type: 'list' }], shopping = 'Boodschappen' } = {}) {
  const calls = [];
  const keeper = makeChoiceKeeper();
  const callSkill = async (app, op, args, ctx) => {
    calls.push({ app, op, args, ctx });
    if (app === 'lists' && op === 'listLists') return { ok: true, items: lists };
    if (app === 'lists' && op === 'addToList') return calls.filter((c) => c.op === 'addToList').length > 1 ? { ok: true, duplicate: true, quantity: 2 } : { ok: true };
    return { ok: true };
  };
  const op = makePickThing({ keeper, callSkill, shoppingList: () => shopping });
  const pick = (n, threadId = 'telegram:1', caller = 'telegram:1') => op({ spec: String(n) }, { caller, threadId, door: 'slash' }, t);
  return { keeper, calls, pick };
}

describe('the tap: the answer to "which one"', () => {
  it('a thing whose seller has its own list goes on that list, with its reference and quantity 1, as the person who tapped', async () => {
    const d = door();
    d.keeper.keep('telegram:1', ITEMS);
    const r = await d.pick(1);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const add = d.calls.find((c) => c.op === 'addToList');
    expect(add.args).toMatchObject({ list: 'Albert Heijn', text: 'Halfvolle melk 1 L', ref: { type: 'Product', ref: 'ah:33693' }, quantity: 1 });
    expect(add.ctx).toMatchObject({ caller: 'telegram:1' });
    expect(r.message).toContain('circle.bot.toolbox_pick_added');
    expect(r.message).toContain('Albert Heijn');
  });
  it('the same thing tapped again raises its quantity, and the reply says so', async () => {
    const d = door();
    d.keeper.keep('telegram:1', ITEMS);
    await d.pick(1);
    const again = await d.pick(1);
    expect(again.message).toContain('circle.lists.quantity_raised');
    expect(again.message).toContain('"quantity":2');
  });

  it('no list of its seller: the shopping list', async () => {
    const d = door();
    d.keeper.keep('telegram:1', ITEMS);
    await d.pick(2);
    expect(d.calls.find((c) => c.op === 'addToList').args.list).toBe('Boodschappen');
  });
  it('no seller list and no shopping list: the reply asks which list, a button per list, and that answer adds it', async () => {
    const d = door({ lists: [{ id: 'L7', label: 'Klussen', type: 'list' }, { id: 'L8', label: 'Feest', type: 'list' }], shopping: null });
    d.keeper.keep('telegram:1', ITEMS);
    const ask = await d.pick(3);
    expect(d.calls.some((c) => c.op === 'addToList')).toBe(false);
    expect(ask.message).toContain('circle.bot.toolbox_pick_which_list');
    const painted = renderReply({ shape: 'text', payload: ask }, { t });
    expect(painted.quickReplies.map((q) => q.slash)).toEqual(['/kies 3 1', '/kies 3 2']);
    for (const q of painted.quickReplies) expect(Buffer.byteLength(q.slash)).toBeLessThanOrEqual(64);
    await d.pick('3 2');
    expect(d.calls.find((c) => c.op === 'addToList').args).toMatchObject({ list: 'Feest', text: 'Biologische melk' });
  });
  it('in another thread, after the list was replaced, or with a number not shown: it says the list is gone, and adds nothing', async () => {
    const d = door();
    d.keeper.keep('telegram:1', ITEMS);
    for (const [n, thread] of [[1, 'telegram:2'], [9, 'telegram:1'], ['x', 'telegram:1']]) {
      const r = await d.pick(n, thread, thread);
      expect(r.ok).toBe(false);
      expect(r.error?.message).toContain('circle.bot.toolbox_pick_gone');
    }
    expect(d.calls.some((c) => c.op === 'addToList')).toBe(false);
  });
});
