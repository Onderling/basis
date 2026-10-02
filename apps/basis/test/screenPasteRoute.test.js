/**
 * `/scherm` and `/koppel-scherm` at the door: the admin's `/scherm` (by default) sends the start address — no secret —
 * and a member's the one-time link; `/scherm link` gives anyone the link; `/koppel-scherm` takes a screen's own offer
 * and asks the question, a garbled one is answered with the usage line.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createBotScreens } from '../src/v2/botScreens.js';
import { encodePairingOffer } from '../src/v2/connectionPairing.js';
import { EventLog } from '../src/eventLog.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const users = [{ id: 'telegram:9', channel: 'telegram', uid: '9', role: 'admin' }, { id: 'telegram:1', channel: 'telegram', uid: '1', role: 'member' }];

function door() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const privately = []; const asked = [];
  const screens = createBotScreens({
    threads, isAdmitted: async () => true, columnOf: async () => ['lists.addToList'], grant: async () => ({ ok: true }), revokeView: async () => true, listGrants: async () => [],
    sendPrivately: async (person, text) => { privately.push({ person, text }); return { ok: true }; },
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    where: () => ({ appUrl: 'https://basis.example/app', botAddress: 'BOT', relayUrl: 'wss://r', botName: '@b' }),
  });
  const call = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t, refusal: async () => null, admin: { screens, users: async () => users } });
  const as = (who, op, args = {}) => call('assistant', op, args, { caller: who, threadId: who, chatId: who.split(':')[1] });
  return { as, privately, asked };
}

describe('the paste route at the door', () => {
  it('the admin\'s /scherm: the start address (no secret); a member\'s: the link; /scherm link: the link', async () => {
    const d = door();
    await d.as('telegram:9', 'assistant-screen');
    expect(d.privately.at(-1).text).toContain('#scherm-nieuw=');
    expect(d.privately.at(-1).text).not.toContain('#scherm=');
    await d.as('telegram:1', 'assistant-screen');
    expect(d.privately.at(-1).text).toContain('#scherm=');
    await d.as('telegram:9', 'assistant-screen', { how: 'link' });
    expect(d.privately.at(-1).text).toContain('#scherm=');
  });

  it('/koppel-scherm: a screen\'s own offer asks the question; a garbled one gets the usage line', async () => {
    const d = door();
    const bad = await d.as('telegram:9', 'assistant-screen-paste', { offer: 'hallo' });
    expect(bad.error.message).toContain('screen_paste_usage');
    const ok = await d.as('telegram:9', 'assistant-screen-paste', { offer: encodePairingOffer({ viewPubKey: 'VIEWKEY', nonce: 'abc', label: 'laptop' }) });
    expect(ok.message).toContain('screen_paste_asked');
    expect(d.asked).toHaveLength(1);
    expect(d.asked[0].codes).toHaveLength(3);
  });
});
