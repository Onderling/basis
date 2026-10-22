/**
 * The bridge watches its own long-poll. Telegraf's loop ends on any error it does not retry (and `launch()` is not
 * awaited), and a fetch with no socket timeout can hang for ever after a sleep or a network change: either way the bot
 * runs on and hears nothing (the tablet's bot, 2026-10-02: four and a half hours of silence, then the waiting message
 * the moment the process restarted). The bridge says so — `onPollingDown({reason})`, once — so the host can restart.
 */
import { describe, it, expect } from 'vitest';
import { TelegramBridge, telegramErrorCodes } from '../src/bridges/TelegramBridge.js';

function fakeBot({ launch }) {
  const bot = {
    on: () => {}, stop: () => {}, botInfo: { username: 't' },
    launch,
    telegram: {
      getMe: async () => ({ username: 't', id: 1 }),
      callApi: async () => [],
    },
  };
  return bot;
}

describe('the bridge watches its long-poll', () => {
  it('the loop ends with an error: the host hears it once', async () => {
    const down = [];
    let reject;
    const bot = fakeBot({ launch: () => new Promise((_, r) => { reject = r; }) });
    const bridge = new TelegramBridge({ botToken: 'x', mode: 'long-polling', telegrafFactory: () => bot, onPollingDown: (e) => down.push(e.reason), watchdog: { everyMs: 1e9 } });
    await bridge.start();
    reject(Object.assign(new Error('409: Conflict'), { code: 409 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(down).toEqual(['stopped']);
  });

  it('the host hears the error as CODES, never its message: a fetch error carries the bot URL and so the token', async () => {
    const down = [];
    let reject;
    const bot = fakeBot({ launch: () => new Promise((_, r) => { reject = r; }) });
    const bridge = new TelegramBridge({ botToken: 'x', mode: 'long-polling', telegrafFactory: () => bot, onPollingDown: (e) => down.push(e), watchdog: { everyMs: 1e9 } });
    await bridge.start();
    const conflict = Object.assign(new Error('409: Conflict: terminated by other getUpdates request'), { name: 'TelegramError', response: { error_code: 409 } });
    reject(conflict);
    await new Promise((r) => setTimeout(r, 0));
    expect(down[0].codes).toEqual({ name: 'TelegramError', status: 409 });
    const fetchErr = Object.assign(new Error('request to https://api.telegram.org/bot123456:SECRET/getUpdates failed, reason: timeout'), { name: 'FetchError', code: 'ETIMEDOUT' });
    expect(telegramErrorCodes(fetchErr)).toEqual({ name: 'FetchError', code: 'ETIMEDOUT' });
    expect(JSON.stringify(telegramErrorCodes(fetchErr))).not.toContain('SECRET');
    // a code that is not a short code is dropped, not passed on
    expect(telegramErrorCodes({ name: 'X', code: 'https://api.telegram.org/bot123:SECRET' })).toEqual({ name: 'X' });
    expect(telegramErrorCodes(undefined)).toBeNull();
  });

  it('no poll completes for too long: stalled, said once; a poll that completes keeps it quiet', async () => {
    const down = [];
    let now = 0;
    let tick = null;
    const bot = fakeBot({ launch: () => new Promise(() => {}) });
    const bridge = new TelegramBridge({
      botToken: 'x', mode: 'long-polling', telegrafFactory: () => bot, onPollingDown: (e) => down.push(e.reason),
      watchdog: { stallMs: 180_000, now: () => now, setInterval: (fn) => { tick = fn; return 1; } },
    });
    await bridge.start();
    now = 120_000; await bot.telegram.callApi('getUpdates', {});   // a poll completed at 2 min
    now = 250_000; tick();
    expect(down).toEqual([]);
    now = 400_000; tick(); tick();
    expect(down).toEqual(['stalled']);
  });
});
