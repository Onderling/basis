/**
 * The bridge hands Telegram a bot's command list — what the "Menu" button beside the typing box shows. Without a chat:
 * every private chat (per app language when one is named); with a chat: that chat alone; `clear` takes a chat's own
 * list away, so the default shows there again.
 */
import { describe, it, expect } from 'vitest';
import { TelegramBridge } from '../src/bridges/TelegramBridge.js';

function fake() {
  const calls = [];
  const bot = {
    on() {}, command() {}, start() {}, catch() {}, launch: async () => {}, stop() {}, botInfo: null,
    telegram: {
      getMe: async () => ({ username: 'testbot', id: 1 }), sendMessage: async () => ({ message_id: 1 }), setWebhook: async () => {},
      setMyCommands: async (commands, extra) => { calls.push(['set', commands, extra]); return true; },
      deleteMyCommands: async (extra) => { calls.push(['delete', extra]); return true; },
    },
  };
  return { calls, bridge: new TelegramBridge({ botToken: 'x', mode: 'long-polling', botUsername: 'testbot', telegrafFactory: () => bot }) };
}

describe('TelegramBridge.setCommands', () => {
  it('every private chat, per language; one chat; and clearing a chat', async () => {
    const { calls, bridge } = fake();
    const list = [{ command: 'lijst', description: 'Wat er op een lijst staat' }];
    await bridge.setCommands(list);
    await bridge.setCommands(list, { languageCode: 'en' });
    await bridge.setCommands(list, { chatId: '42' });
    await bridge.setCommands([], { chatId: '42', clear: true });
    expect(calls).toEqual([
      ['set', list, { scope: { type: 'all_private_chats' } }],
      ['set', list, { scope: { type: 'all_private_chats' }, language_code: 'en' }],
      ['set', list, { scope: { type: 'chat', chat_id: '42' } }],
      ['delete', { scope: { type: 'chat', chat_id: '42' } }],
    ]);
  });
});
