/**
 * A `/scherm` link never appears in a group. Whoever holds the link within ten minutes can connect a screen as the
 * person, so it goes ONLY to their private door (their own chat); the chat it was asked in — a Telegram group is a
 * chat too — hears that it was sent privately; and the person's thread remembers that a link was sent, not the link. Through the real Telegram runner and the bot's own door call.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createBotScreens } from '../src/v2/botScreens.js';
import { createPersonReach } from '../src/v2/doorReach.js';
import { EventLog } from '../src/eventLog.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ANN = 'telegram:42';
const GROUP = '-100777';

describe('the /scherm link and a group', () => {
  it('asked in a group: the group sees no link; Ann\'s private chat gets it', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const users = { list: async () => [{ id: ANN, channel: 'telegram', uid: '42', role: 'member' }] };
    const reach = createPersonReach({ bridges: { telegram: bridge }, users, threads });
    const screens = createBotScreens({
      threads, isAdmitted: async () => true, columnOf: async () => ['lists.addToList'],
      grant: async () => ({ ok: true }), revokeView: async () => true, listGrants: async () => [],
      sendPrivately: (person, text, rememberAs) => reach.sendToPerson(person, { text, rememberAs }),
      where: () => ({ appUrl: 'https://basis.example/app', botAddress: 'BOT', relayUrl: null }),
    });
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['lists'], slim: true });
    const doorCall = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t, refusal: async () => null, admin: { screens } });
    const runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, callSkill: doorCall, allowedChatIds: '*', threads,
      llm: { invoke: async () => null }, interpret: async () => null, admit: async () => ANN,
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: GROUP, text: '/scherm', sender: { bridgeUid: '42', displayName: 'Ann' } });
    await runner.idle(GROUP);
    const inGroup = bridge.outbox.filter((m) => String(m.chatId) === GROUP).map((m) => m.text).join('\n');
    const inPrivate = bridge.outbox.filter((m) => String(m.chatId) === '42').map((m) => m.text).join('\n');
    expect(inGroup).toContain('screen_sent_privately');
    expect(inGroup, 'the group must never see the link').not.toContain('#scherm=');
    expect(inPrivate).toContain('#scherm=');
    // the link is a secret: the person's thread remembers that it was sent, never the link (it would ride to the model)
    const memory = JSON.stringify(threads.memory.recent(ANN));
    expect(memory).not.toContain('#scherm=');
    expect(memory).toContain('screen_link_remembered');
  });
});
