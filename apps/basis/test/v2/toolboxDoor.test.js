/**
 * `/toolbox` at the household bot's door (ledger L1035; Fable's (4)).
 *
 * @guard a toolbox is switched on only after the admin's yes in their own private chat, never from a group chat, and no line of the door carries the toolbox's key
 *
 * The door command over the real toolbox ops: the list, the card with Ja/Nee, the yes from the private chat only, off.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { makeToolboxOps } from '../../src/v2/toolboxes.js';
import { renderReply } from '../../src/renderer.js';

const KEY = 'geheime-sleutel-123';
const CARD = { name: 'Boodschappen', supportedInterfaces: [{ url: 'http://boodschappen:3000/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  skills: [{ id: 'products.choices', name: 'Products Choices' }] };
const PLACED = { name: 'boodschappen', url: 'http://boodschappen:3000', words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }] };
const t = (k, p) => `${k}${p ? ` ${JSON.stringify(p)}` : ''}`;

function door(placed = PLACED) {
  const vault = new Map();
  const tools = makeToolboxOps({
    store: { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } },
    placedOf: async () => [placed], keyOf: async () => KEY,
    fetch: async () => ({ ok: true, status: 200, json: async () => CARD }),
  });
  const callSkill = async (app, op, args) => (app === 'tools' ? tools[op](args) : null);
  const threads = { langOf: () => 'nl', modeOf: () => 'short', remindersOn: () => true, viewOf: () => 'buttons', quietOf: () => null };
  const call = withAssistantOps({
    callSkill, threads, t,
    admin: { users: async () => [{ id: 'telegram:1', channel: 'telegram', uid: '1', role: 'admin' }] },
  });
  const say = (spec, chatId = '1') => call('assistant', 'assistant-toolbox', { spec }, { caller: 'telegram:1', threadId: 'telegram:1', chatId });
  return { say, tools };
}

describe('/toolbox at the door', () => {
  it('the card shows a word\'s slots (the parameter and the phrases per value), so the yes covers what is shown', async () => {
    const placed = { ...PLACED, words: [{ ...PLACED.words[0], slots: [{ param: 'stores', list: true, values: { ah: ['bij albert heijn', 'bij ah'], jumbo: ['bij jumbo'] } }] }] };
    const { say, tools } = door(placed); await tools.load();
    const ask = await say('boodschappen aan');
    expect(ask.message).toContain('circle.bot.toolbox_card_slot');
    // (the test's t() writes a key with its params as JSON; the slot line sits inside the card's params)
    expect(ask.message).toMatch(/toolbox_card_slot.*zoek.*stores.*ah: bij albert heijn \/ bij ah; jumbo: bij jumbo/);
    // a word without slots adds no line
    const plain = door(); await plain.tools.load();
    expect((await plain.say('boodschappen aan')).message).not.toContain('toolbox_card_slot');
  });

  it('no argument: the placed toolboxes, each with its words and on/off', async () => {
    const { say, tools } = door(); await tools.load();
    const r = await say('');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('circle.bot.toolbox_list_head');
    expect(r.message).toContain('"state":"circle.bot.toolbox_state_off"');
    expect(r.message).toContain('zoek <…>');
  });

  it('"<naam> aan" in the private chat: the card with Ja/Nee, nothing switched; the Ja switches it on', async () => {
    const { say, tools } = door(); await tools.load();
    const ask = await say('boodschappen aan');
    expect(ask.message).toContain('circle.bot.toolbox_card');
    expect(ask.message).toContain('http://boodschappen:3000');
    expect(ask.message).toContain('circle.bot.toolbox_receives_question');
    // what reaches a person: the reply as the door's painter renders it (its quick replies are the buttons Telegram and
    // the bot's thread in Basis show); an op field the renderer does not read would be dropped on the way
    const painted = renderReply({ shape: 'text', payload: ask }, { t });
    expect(painted.quickReplies.map((q) => q.slash)).toEqual(['/toolbox boodschappen aan ja', '/toolbox boodschappen aan nee']);
    expect(tools.wordsNow()).toEqual([]);
    const yes = await say('boodschappen aan ja');
    expect(yes.message).toContain('circle.bot.toolbox_on');
    expect(tools.wordsNow().map((w) => w.word)).toEqual(['zoek']);
    expect(JSON.stringify([ask, yes])).not.toContain(KEY);
  });

  it('from a group chat the switch is refused, the yes too', async () => {
    const { say, tools } = door(); await tools.load();
    expect((await say('boodschappen aan', '-100')).error?.code).toBe('not-private');
    expect((await say('boodschappen aan ja', '-100')).error?.code).toBe('not-private');
    expect(tools.wordsNow()).toEqual([]);
  });

  it('"<naam> uit" switches it off; a name the operator did not place is told plainly', async () => {
    const { say, tools } = door(); await tools.load();
    await say('boodschappen aan ja');
    expect((await say('boodschappen uit')).message).toContain('circle.bot.toolbox_off');
    expect(tools.wordsNow()).toEqual([]);
    expect((await say('elders aan')).error?.message).toContain('circle.bot.toolbox_not_placed');
    expect((await say('boodschappen misschien')).error?.message).toContain('circle.bot.toolbox_usage');
  });
});
