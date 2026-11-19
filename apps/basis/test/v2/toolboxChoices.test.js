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
import { makeChoiceKeeper, toolChoicesReply } from '../../src/v2/toolboxes.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';

const t = (k, p) => `${k}${p ? ` ${JSON.stringify(p)}` : ''}`;
const ITEMS = [
  { label: 'Halfvolle melk 1 L', detail: 'AH', price: '1.19', seller: 'Albert Heijn', ref: { type: 'Product', ref: 'ah:33693', source: 'boodschappen' } },
  { label: 'Jumbo halfvolle melk 1 L', price: '1.05', seller: 'Jumbo', ref: { type: 'Product', ref: 'jumbo:753536PAK', source: 'boodschappen' } },
  { label: 'Biologische melk', seller: 'Ekoplaza', ref: { type: 'Product', ref: 'eko:1', source: 'boodschappen' } },
];

describe('the reply: a line and a button per thing', () => {
  it('each thing gets one button whose id is /kies <n>, well under Telegram\'s 64 bytes', () => {
    const keeper = makeChoiceKeeper();
    const r = toolChoicesReply({ ok: true, name: 'boodschappen', title: 'Boodschappen', items: ITEMS }, { threadId: 'telegram:1', keeper, t });
    expect(r.ok).toBe(true);
    expect(r.buttons.map((b) => b.id)).toEqual(['/kies 1', '/kies 2', '/kies 3']);
    expect(r.buttons[0].label).toBe('Halfvolle melk 1 L');
    for (const b of r.buttons) expect(Buffer.byteLength(b.id)).toBeLessThanOrEqual(64);
    expect(r.message).toContain('circle.bot.toolbox_found_head');
    expect(r.message).toContain('Halfvolle melk 1 L');
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
  const threads = { langOf: () => 'nl', modeOf: () => 'short', remindersOn: () => true, viewOf: () => 'buttons', quietOf: () => null };
  const call = withAssistantOps({ callSkill, threads, t, choices: { keeper, shoppingList: () => shopping } });
  const pick = (n, threadId = 'telegram:1', caller = 'telegram:1') => call('assistant', 'assistant-pick', { spec: String(n) }, { caller, threadId, door: 'slash' });
  return { keeper, calls, pick, call };
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
    expect(ask.buttons.map((b) => b.id)).toEqual(['/kies 3 1', '/kies 3 2']);
    for (const b of ask.buttons) expect(Buffer.byteLength(b.id)).toBeLessThanOrEqual(64);
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
