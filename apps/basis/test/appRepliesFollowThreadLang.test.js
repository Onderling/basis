/**
 * An app's own reply (a list, a chore, an appointment) is worded in the language of the call — the person's `/taal`,
 * carried on the call by the door — not only in the bot's own language. The model's replies and the runner's own lines
 * already followed it (the per-reply translator); the apps' ops were built once with the bot's translator.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

// a translator that says which language it was asked in (the bot's own is Dutch)
const t = (k, p, lang) => `${lang ?? 'nl'}|${k}`;
const boot = () => createRealHouseholdAgent({ seedHousehold: false, t, ...HOUSEHOLD_BOT_STORE_OPTS });
const when = () => { const d = new Date(Date.now() + 86_400_000); d.setHours(10, 0, 0, 0); return d.toISOString(); };

describe('an app\'s reply in the call\'s language', () => {
  it('an appointment, a list entry and a chore: English for a call in English, Dutch without one', async () => {
    const a = await boot();
    const cal = await a.callSkill('calendar', 'addEvent', { circleId: 'huis', title: 'Tandarts', when: when() }, { lang: 'en' });
    expect(cal?.message, JSON.stringify(cal)).toMatch(/^en\|circle\.calendar\./);
    const cal2 = await a.callSkill('calendar', 'addEvent', { circleId: 'huis', title: 'Kapper', when: when() });
    expect(cal2?.message).toMatch(/^nl\|circle\.calendar\./);
    // a language the shell does not speak is the bot's own (and builds no table of its own)
    expect((await a.callSkill('calendar', 'addEvent', { circleId: 'huis', title: 'Bakker', when: when() }, { lang: 'xx-free' }))?.message).toMatch(/^nl\|circle\.calendar\./);
    const list = await a.callSkill('lists', 'listLists', { circleId: 'huis' }, { lang: 'en' });
    expect(JSON.stringify(list)).toContain('en|');
    expect(JSON.stringify(list)).not.toContain('"nl|');
    // a chore: done on one that is not there answers in the call's language
    const miss = await a.callSkill('household', 'markComplete', { circleId: 'huis', match: 'nergens' }, { lang: 'en' });
    expect(miss?.error, JSON.stringify(miss)).toMatch(/^en\|circle\.household\./);
    const brief = await (await a.callSkill('household', 'addItem', { circleId: 'huis', type: 'errand', text: 'Afwassen' }, { lang: 'en' }), a.callSkill('household', 'household_briefSummary', { circleId: 'huis' }, { lang: 'en' }));
    expect(brief?.message, JSON.stringify(brief)).toMatch(/^en\|circle\.household\.brief/);
  });
});

describe('the door carries the thread\'s language on its calls', () => {
  it('a slash op from a thread fixed to English reaches the agent with lang: en', async () => {
    const { initLocalisation, t: realT } = await import('../src/localisation.js');
    await initLocalisation({ lng: 'nl' });
    const { createTelegramRunner } = await import('../src/telegram/runner.js');
    const { InMemoryBridge } = await import('@onderling/chat-agent');
    const { EventLog } = await import('../src/eventLog.js');
    const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setLang('telegram:31', 'en');
    const seen = [];
    const callSkill = async (app, op, args, ctx) => { seen.push({ op, lang: ctx?.lang ?? null }); return { ok: true, message: 'x' }; };
    const { createDoorCatalogue } = await import('../src/telegram/assistantCatalogue.js');
    const { mockHouseholdManifest } = await import('../src/core/agent/mockAgent.js');
    const door = createDoorCatalogue({ getApps: () => ['lists'], householdManifest: mockHouseholdManifest });
    // any op the door offers as a slash command with no argument (a read)
    const opOf = (v) => v?.op ?? v;
    const pick = [...door.catalogue().opsById.values()].map(opOf).find((o) => o?.appOrigin !== 'assistant' && o?.surfaces?.slash?.command && o?.surfaces?.slash?.match?.body === 'none' && !(o.params ?? []).some((p) => p.required));
    expect(pick, 'the door offers an argument-free read').toBeTruthy();
    const cmd = pick.surfaces.slash.command;
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({ bridge, catalogue: door.catalogue, manifestsByOrigin: door.manifestsByOrigin, t: realT, allowedChatIds: '*', collectMs: 0, callSkill,
      admit: async (who) => `${who.channel}:${who.uid}`, threads });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '31', text: cmd, sender: { bridgeUid: '31' } });
    await runner.idle();
    expect(seen.find((c) => c.op === pick.id)?.lang).toBe('en');
  });
});
