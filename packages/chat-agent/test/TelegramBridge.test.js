import { describe, it, expect } from 'vitest';
import { layoutButtons, TelegramBridge } from '../src/bridges/TelegramBridge.js';

// A minimal Telegraf-like fake (the `telegrafFactory` test seam): captures `on` handlers
// so a test can `emit` an update synchronously.
function makeFakeBot() {
  const handlers = {};
  return {
    on: (event, h) => { handlers[event] = h; },
    launch: async () => {}, stop: () => {},
    botInfo: { username: 'testbot' },
    telegram: { getMe: async () => ({ username: 'testbot', id: 1 }), sendMessage: async () => ({ message_id: 1 }), setWebhook: async () => {} },
    emit: (event, ctx) => handlers[event]?.(ctx),
  };
}

describe('TelegramBridge — edited_message handling', () => {
  const mk = () => {
    const bot = makeFakeBot();
    const bridge = new TelegramBridge({ botToken: 'x', mode: 'long-polling', botUsername: 'testbot', telegrafFactory: () => bot });
    let got;
    bridge.onMessage((m) => { got = m; return null; });
    return { bot, get: () => got };
  };

  it('delivers a TG-client message edit (previously silently dropped) and flags it edited', async () => {
    const { bot, get } = mk();
    // an edit rides on ctx.editedMessage, not ctx.message
    await bot.emit('edited_message', { chat: { id: 42, type: 'private' }, editedMessage: { message_id: 7, text: 'corrected text' }, from: { id: 5, first_name: 'U' } });
    expect(get()).toBeTruthy();
    expect(get().edited).toBe(true);
    expect(get().text).toBe('corrected text');
    expect(get().chatId).toBe('42');
  });

  it('a fresh message carries no edited flag', async () => {
    const { bot, get } = mk();
    await bot.emit('text', { chat: { id: 42, type: 'private' }, message: { message_id: 8, text: 'fresh' }, from: { id: 5, first_name: 'U' } });
    expect(get().text).toBe('fresh');
    expect(get().edited).toBeUndefined();
  });
});

describe('layoutButtons', () => {
  it('default: each button on its own row (so long lists stay readable)', () => {
    const out = layoutButtons([
      { label: '✓ kaas',   id: 'ik heb kaas van boodschappen'   },
      { label: '✓ eieren', id: 'ik heb eieren van boodschappen' },
      { label: '✓ melk',   id: 'ik heb melk van boodschappen'   },
    ]);
    expect(out).toEqual([
      [{ text: '✓ kaas',   callback_data: 'ik heb kaas van boodschappen'   }],
      [{ text: '✓ eieren', callback_data: 'ik heb eieren van boodschappen' }],
      [{ text: '✓ melk',   callback_data: 'ik heb melk van boodschappen'   }],
    ]);
  });

  it('honours an explicit 2D shape from the caller', () => {
    const out = layoutButtons([
      [{ label: 'Yes', id: 'yes' }, { label: 'No', id: 'no' }],
      [{ label: 'Cancel', id: 'cancel' }],
    ]);
    expect(out).toEqual([
      [{ text: 'Yes',    callback_data: 'yes'    }, { text: 'No', callback_data: 'no' }],
      [{ text: 'Cancel', callback_data: 'cancel' }],
    ]);
  });

  it('groups by `row` field when present', () => {
    const out = layoutButtons([
      { label: 'A', id: 'a', row: 0 },
      { label: 'B', id: 'b', row: 0 },
      { label: 'C', id: 'c', row: 1 },
    ]);
    expect(out).toEqual([
      [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
      [{ text: 'C', callback_data: 'c' }],
    ]);
  });
});

describe('layoutButtons — a web-app button', () => {
  it('a button with `webApp` opens that page inside Telegram, beside ordinary ones', () => {
    expect(layoutButtons([{ label: 'Open het scherm', webApp: 'https://onderling.org/basis/?scherm-tg=x' }, { label: 'Ja', id: '/ja' }])).toEqual([
      [{ text: 'Open het scherm', web_app: { url: 'https://onderling.org/basis/?scherm-tg=x' } }],
      [{ text: 'Ja', callback_data: '/ja' }],
    ]);
  });
});
