/**
 * Reaching a person first: the bot writes to someone who did not just write to it (a reminder). The contact row's
 * channel picks the door (their Telegram private chat, or a contact turn on the inbox); a revoked person gets nothing;
 * Telegram refusing ("the bot can't initiate a conversation") is kept on the thread row and not tried again until the
 * person next writes; the message is remembered in their thread (unless their memory is off), so "gedaan" right after
 * it lands. And a person switches their own reminders and weekly overview (`/herinneringen`, `/overzicht`).
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createPersonReach } from '../src/v2/doorReach.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { weekOverviewOn } from '../src/v2/weekOverviewRows.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const people = [
  { id: 'telegram:111', channel: 'telegram', uid: '111', role: 'member' },
  { id: 'webid:bert', channel: 'web', uid: 'webid:bert', role: 'member' },
  { id: 'telegram:222', channel: 'telegram', uid: '222', role: 'member', hidden: true },
];
function doors({ telegramFails = null } = {}) {
  const sent = { telegram: [], web: [] };
  const telegram = { id: 'telegram', sendReply: async (m) => { if (telegramFails) throw telegramFails; sent.telegram.push(m); } };
  const web = { id: 'web', sendReply: async (m) => { sent.web.push(m); } };
  return { sent, bridges: { telegram, web } };
}
async function setup(opts) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const { sent, bridges } = doors(opts);
  const reach = createPersonReach({ bridges, users: { list: async () => people }, threads });
  return { threads, sent, reach };
}

describe('reaching a person first', () => {
  it('each person on their own door; a revoked person gets nothing', async () => {
    const { sent, reach } = await setup();
    expect(await reach.sendToPerson('telegram:111', { text: 'Morgen: tandarts, 10:00.' })).toEqual({ ok: true });
    expect(sent.telegram).toEqual([expect.objectContaining({ chatId: '111', text: 'Morgen: tandarts, 10:00.' })]);
    expect((await reach.sendToPerson('webid:bert', { text: 'Vandaag: vuilnis.' })).ok).toBe(true);
    expect(sent.web).toEqual([expect.objectContaining({ chatId: 'webid:bert', text: 'Vandaag: vuilnis.' })]);
    expect(await reach.sendToPerson('telegram:222', { text: 'x' })).toEqual({ ok: false, reason: 'revoked' });
    expect(await reach.sendToPerson('telegram:999', { text: 'x' })).toEqual({ ok: false, reason: 'no-door' });
  });

  it('a Telegram refusal is kept, and not tried again until the person writes', async () => {
    const refusal = Object.assign(new Error("403: Forbidden: bot can't initiate conversation with a user"), { code: 403 });
    const { threads, sent, reach } = await setup({ telegramFails: refusal });
    expect(await reach.sendToPerson('telegram:111', { text: 'a' })).toEqual({ ok: false, reason: 'no-private-chat' });
    expect(threads.unreachableOf('telegram:111')).toBe('no-private-chat');
    expect(await reach.sendToPerson('telegram:111', { text: 'b' })).toEqual({ ok: false, reason: 'no-private-chat' });
    expect(sent.telegram).toEqual([]);
    threads.clearUnreachable('telegram:111');   // they wrote
    expect(threads.unreachableOf('telegram:111')).toBeNull();
  });

  it('the message is remembered in their thread — not when their memory is off', async () => {
    const { threads, reach } = await setup();
    await reach.sendToPerson('telegram:111', { text: 'Vandaag: vuilnis.' });
    expect(threads.memory.recent('telegram:111').join('\n')).toContain('Vandaag: vuilnis.');
    threads.setMode('webid:bert', 'off');
    await reach.sendToPerson('webid:bert', { text: 'Vandaag: ramen.' });
    expect(threads.memory.recent('webid:bert')).toEqual([]);
  });

  it('a person switches their own reminders and overview; the admin switches the household\'s', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const stored = new Map();
    const inner = async (app, op, args) => {
      if (app === 'params' && op === 'set-param') { stored.set(args.key, args.value); return { ok: true }; }
      if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...stored].map(([key, value]) => ({ key, value })) };
      return { ok: false };
    };
    // the overview is a planned row in the host's own-devices store
    const book = createIntentionBook({ store: createOwnDevicesStore(), actor: 'bot' });
    const call = withAssistantOps({ callSkill: inner, threads, t, admin: {}, intentions: { book } });
    expect(threads.remindersOn('telegram:111')).toBe(true);    // on by default
    expect(weekOverviewOn(book, 'telegram:111')).toBe(false);    // off until the person switches it on
    await call('assistant', 'assistant-reminders', { mode: 'off' }, { threadId: 'telegram:111' });
    await call('assistant', 'assistant-overview', { mode: 'on' }, { threadId: 'telegram:111' });
    expect(threads.remindersOn('telegram:111')).toBe(false);
    expect(threads.remindersOn('webid:bert')).toBe(true);      // theirs only
    expect(weekOverviewOn(book, 'telegram:111')).toBe(true);
    // the door's own words switch too — "uit" is off, never "not off, so on"; a word it does not know changes nothing
    await call('assistant', 'assistant-reminders', { mode: 'aan' }, { threadId: 'webid:bert' });
    await call('assistant', 'assistant-reminders', { mode: 'uit' }, { threadId: 'webid:bert' });
    expect(threads.remindersOn('webid:bert')).toBe(false);
    expect((await call('assistant', 'assistant-reminders', { mode: 'misschien' }, { threadId: 'webid:bert' })).ok).toBe(false);
    expect(threads.remindersOn('webid:bert')).toBe(false);
    await call('assistant', 'assistant-overview', { mode: 'uit' }, { threadId: 'telegram:111' });
    expect(weekOverviewOn(book, 'telegram:111')).toBe(false);
    const off = await call('assistant', 'assistant-settings', { change: 'reminders off' });
    expect(off.message).toContain('"reminders":"off"');
    await call('assistant', 'assistant-settings', { change: 'quiet 22:00-07:30' });
    expect(stored.get('assistant.quietHours')).toBe('22:00-07:30');
    expect((await call('assistant', 'assistant-settings', { change: 'quiet morgen' })).ok).toBe(false);
  });
});
