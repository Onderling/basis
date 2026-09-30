/**
 * A new person's first message says what THIS bot does for THEM: one line per thing their tools reach (the template's
 * lists by name, the chores, the Agenda, the week), then the reminders as they stand (on or off, the quiet hours) and
 * how to change them — the admin also hears where the household's settings are. Derived from the door's catalogue as
 * scoped to the person's role and from the settings, so a bot without the Agenda never offers it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initLocalisation, t } from '../src/localisation.js';
import { welcomeLines } from '../src/v2/botWelcome.js';
import { templateLists } from '../src/v2/householdTemplate.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { InMemoryBridge } from '@onderling/chat-agent';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

let lists;
beforeAll(async () => { await initLocalisation({ lng: 'nl' }); lists = templateLists(t); });
const all = new Set(['addToList', 'listEntries', 'claimTask', 'completeTask', 'addEvent', 'listEvents', 'weekOverview', 'assistant-reminders', 'assistant-overview']);

describe('the welcome, derived', () => {
  it('a member: the lists by name, chores, the Agenda, the week, and reminders on with the quiet hours and the switches', () => {
    const text = welcomeLines({ ops: all, lists, role: 'member', settings: { reminders: 'on', quiet: '21:00-08:00' }, t }).join('\n');
    expect(text).toContain('Boodschappen');
    expect(text).toContain('Klusjes');
    expect(text).toContain('Agenda');
    expect(text).toContain('/week');
    expect(text).toContain('21:00');
    expect(text).toContain('/herinneringen uit');
    expect(text).toContain('/overzicht aan');
    expect(text).not.toContain('/instellingen');
    expect(text).not.toMatch(/circle\.bot\./);   // every key has its words
  });

  it('the admin also hears where the household\'s settings are; reminders off says so', () => {
    const text = welcomeLines({ ops: all, lists, role: 'admin', settings: { reminders: 'off', quiet: '21:00-08:00' }, t }).join('\n');
    expect(text).toContain('/instellingen');
    expect(text).not.toContain('21:00');
    expect(text).not.toContain('/herinneringen uit');
  });

  it('only what the tools reach: no Agenda without addEvent, an observer reads along and gets no reminders', () => {
    const noAgenda = welcomeLines({ ops: new Set([...all].filter((o) => o !== 'addEvent' && o !== 'listEvents')), lists, role: 'member', settings: { reminders: 'on' }, t }).join('\n');
    expect(noAgenda).not.toContain('Agenda');
    const observer = welcomeLines({ ops: new Set(['listEntries', 'listEvents', 'weekOverview']), lists, role: 'observer', settings: { reminders: 'on' }, t }).join('\n');
    expect(observer).toContain(t('circle.bot.welcome_reader'));
    expect(observer).not.toContain('/herinneringen');
  });

  it('the runner sends it once, after the first line, when the door hands a welcome', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const runner = createTelegramRunner({
      bridge, t, collectMs: 0, threads, catalogue: { opsById: new Map() },
      callSkill: async () => ({ ok: true }),
      welcomeFor: async ({ role }) => [`derived for ${role}`],
      roleFor: () => 'member', scopeToRole: (c) => c,
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '7', text: 'hoi', sender: { bridgeUid: '7' } });
    await runner.idle();
    const first = bridge.outbox.map((m) => m.text).join('\n');
    expect(first).toContain(t('circle.bot.welcome'));
    expect(first).toContain('derived for member');
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '7', text: 'hoi', sender: { bridgeUid: '7' } });
    await runner.idle();
    expect(bridge.outbox.map((m) => m.text).join('\n')).not.toContain('derived for');
  });

  it('/help lists the commands this person reaches — the menu as scoped to their role', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const catalogue = {
      opsById: new Map([['a', { op: { id: 'a', description: 'for all' } }], ['b', { op: { id: 'b', description: 'admin only' } }]]),
      commandMenu: [{ command: '/a', opId: 'a' }, { command: '/b', opId: 'b' }],
    };
    const runner = createTelegramRunner({
      bridge, t, collectMs: 0, catalogue, callSkill: async () => ({ ok: true }),
      roleFor: () => 'member',
      scopeToRole: (c, role) => ({ ...c, commandMenu: c.commandMenu.filter((e) => role === 'admin' || e.opId !== 'b') }),
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '8', text: '/help', sender: { bridgeUid: '8' } });
    await runner.idle();
    const help = bridge.outbox.map((m) => m.text).join('\n');
    expect(help).toContain('/a');
    expect(help).not.toContain('/b');
  });
});
