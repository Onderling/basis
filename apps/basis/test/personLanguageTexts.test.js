/**
 * A person's `/taal` reaches what the bot SAYS itself, not only the model's replies (ledger L173): the welcome, the
 * help, the "I can't read sentences now" list, the confirm buttons, the reminders — in their language, on a bot whose
 * own language is another. A person who fixed nothing hears the bot's language.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initLocalisation, t } from '../src/localisation.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { InMemoryBridge } from '@onderling/chat-agent';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createReminderTick } from '../src/v2/botReminderTick.js';

beforeAll(async () => { await initLocalisation({ lng: 'nl' }); });

describe('the bot\'s own words follow the person\'s /taal', () => {
  it('the welcome and the no-model list in English for a person who chose English; Dutch for the rest', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setLang('tg:21', 'en');
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({ bridge, t, collectMs: 0, threads, catalogue: { opsById: new Map() }, callSkill: async () => ({ ok: true }),
      basicHelpFor: async ({ threadId }) => [threadId], roleFor: () => 'member', scopeToRole: (c) => c });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '21', text: 'something', sender: { bridgeUid: '21' } });
    await runner.idle();
    const en = bridge.outbox.map((m) => m.text).join('\n');
    expect(en).toContain(t('circle.bot.welcome', {}, 'en'));
    expect(en).toContain(t('circle.bot.basic_head', {}, 'en'));
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '22', text: 'iets', sender: { bridgeUid: '22' } });
    await runner.idle();
    const nl = bridge.outbox.map((m) => m.text).join('\n');
    expect(nl).toContain(t('circle.bot.welcome', {}, 'nl'));
    expect(t('circle.bot.welcome', {}, 'en')).not.toBe(t('circle.bot.welcome', {}, 'nl'));
  });

  it('a reminder in the person\'s language', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setLang('telegram:1', 'en');
    const sent = [];
    const tick = createReminderTick({
      sources: async () => ({ chores: [{ id: 'c1', type: 'task', text: 'bins', dueAt: '2026-10-01T22:00:00.000Z', assignees: ['telegram:1'] }], events: [] }),
      users: { list: async () => [{ id: 'telegram:1', channel: 'telegram', uid: '1', role: 'member' }] }, threads, t, tz: 'Europe/Amsterdam',
      reach: { sendToPerson: async (id, m) => { sent.push(m); return { ok: true }; } },
      settings: () => ({ reminders: 'on', quiet: '21:00-08:00' }), now: () => new Date('2026-10-02T09:00:00.000Z').getTime(),
    });
    await tick.pass();
    expect(sent[0].text).toContain(t('circle.bot.reminder_chore', { text: 'bins' }, 'en'));
  });
});

describe('the assistant\'s own replies to a person', () => {
  it('a switch answers in the person\'s language; setting the language answers in the NEW one', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const call = withAssistantOps({ callSkill: async () => ({ ok: false }), threads, t, admin: {} });
    expect((await call('assistant', 'assistant-language', { lang: 'en' }, { threadId: 'tg:31' })).message).toBe(t('circle.bot.lang_set', { lang: t('circle.bot.value_en', {}, 'en') }, 'en'));
    expect((await call('assistant', 'assistant-reminders', { mode: 'off' }, { threadId: 'tg:31' })).message).toBe(t('circle.bot.reminders_off', {}, 'en'));
    expect((await call('assistant', 'assistant-reminders', { mode: 'off' }, { threadId: 'tg:32' })).message).toBe(t('circle.bot.reminders_off', {}, 'nl'));
  });
});
