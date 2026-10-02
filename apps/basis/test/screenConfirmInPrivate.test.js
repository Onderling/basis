/**
 * A screen's offer is granted only after the person says yes in their own PRIVATE chat, to the code their screen shows.
 * Through the real Telegram runner and the bot's door call: the question arrives in Ann's private chat with the code and
 * three code buttons and "geen"; the right code typed in a group is not accepted (nothing granted, the offer still waits); the same
 * code in her private chat grants. The link that started it went out without a link preview.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createBotScreens, parseScreenLink, screenCode } from '../src/v2/botScreens.js';
import { createPersonReach } from '../src/v2/doorReach.js';
import { EventLog } from '../src/eventLog.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ANN = 'telegram:42';
const GROUP = '-100777';

describe('the screen confirm, in the private chat only', () => {
  it('the question with the code; a yes from a group is refused; the yes in private grants', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const sent = [];
    const door = { sendReply: async (m) => { sent.push(m); return bridge.sendReply(m); } };
    const users = [{ id: ANN, channel: 'telegram', uid: '42', role: 'member' }];
    const reach = createPersonReach({ bridges: { telegram: door }, users: { list: async () => users }, threads });
    const grants = [];
    const screens = createBotScreens({
      threads, isAdmitted: async () => true, columnOf: async () => ['lists.addToList'],
      grant: async (g) => { grants.push(g); return { ok: true }; }, revokeView: async () => true, listGrants: async () => [],
      sendPrivately: (person, text, rememberAs) => reach.sendToPerson(person, { text, rememberAs, noPreview: true }),
      ask: (person, { codes }) => reach.sendToPerson(person, { text: t('circle.bot.screen_confirm_question'), buttons: [...codes.map((c) => ({ id: `/koppelen ${c}`, label: c })), { id: '/koppelen geen', label: 'geen' }] }),
      where: () => ({ appUrl: 'https://basis.example/app', botAddress: 'BOT', relayUrl: null }),
    });
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['lists'], slim: true });
    const doorCall = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t, refusal: async () => null, admin: { screens, users: async () => users } });
    const runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, callSkill: doorCall, allowedChatIds: '*', threads,
      llm: { invoke: async () => null }, interpret: async () => null, admit: async () => ANN,
    });
    await runner.start();
    const say = async (chatId, text) => {
      bridge.clearOutbox();
      await bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: '42', displayName: 'Ann' } });
      await runner.idle(chatId);
      return bridge.outbox.map((m) => m.text).join('\n');
    };

    await say('42', '/scherm');
    const linkMsg = sent.find((m) => String(m.text).includes('#scherm='));
    expect(linkMsg.noPreview, 'the link goes out without a preview').toBe(true);
    const nonce = parseScreenLink(/https?:\/\/\S+/.exec(linkMsg.text)[0]).nonce;

    // the screen's offer: a question in Ann's private chat, with the code the screen shows; nothing granted yet
    const r = await screens.offer({ from: 'VIEW', viewPubKey: 'VIEW', nonce });
    expect(r).toMatchObject({ ok: true, pending: true });
    const question = sent.at(-1);
    expect(String(question.chatId)).toBe('42');
    const code = await screenCode('VIEW', nonce);
    const ids = (question.buttons ?? []).map((b) => b.id);
    expect(ids).toHaveLength(4);
    expect(ids).toContain(`/koppelen ${code}`);
    expect(ids.at(-1)).toBe('/koppelen geen');
    expect(grants).toEqual([]);

    // a yes typed in a group: not accepted, nothing granted, the offer still waits
    expect(await say(GROUP, `/koppelen ${code}`)).toContain('screen_confirm_not_private');
    expect(grants).toEqual([]);
    // the yes in her private chat: granted
    expect(await say('42', `/koppelen ${code}`)).toContain('screen_confirmed');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ viewPubKey: 'VIEW', actingAs: ANN });
  });
});
