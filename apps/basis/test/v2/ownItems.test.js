/**
 * What the person's own assistant may READ for a line: their own notes, their own appointments and their own lists'
 * entries, each with its words, read AS the self ticked in the "+" (so a persona's things never reach another self's
 * model). Shaped for the retriever: `{id, type, text}`.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { loadOwnItems } from '../../src/assistant/ownItems.js';

const OWN = OWN_DEVICES_SCOPE;
const NOTE_ADD = encodeGenericOpId('household', 'add', 'note');
const boot = async (ds, extra = {}) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }), ...extra });
const as = (a, actAs = null) => (app, opId, args) => a.callSkill(app, opId, args, actAs ? { actAs } : undefined);
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe('the own items the "+" assistant may read', () => {
  it('a note, an appointment and a list entry, each with its words', async () => {
    const a = await boot(memoryDataSource());
    expect((await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'de sleutel ligt bij de buren' }))?.ok).toBe(true);
    expect((await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'tandarts', when: `${tomorrow()}T10:00:00.000Z` }))?.ok).toBe(true);
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    expect((await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'Boodschappen', text: 'melk' }))?.ok).toBe(true);
    const items = await loadOwnItems({ call: as(a), self: { key: a.identity?.chat?.pubKey ?? null, isDefault: true } })();
    const text = items.map((i) => `${i.type}|${i.text}`).join('\n');
    expect(text).toMatch(/note\|.*sleutel ligt bij de buren/);
    expect(text).toMatch(/calendar-event\|.*tandarts/);
    expect(text).toMatch(/list-item\|.*Boodschappen.*melk/);
    for (const i of items) expect(typeof i.id).toBe('string');
  });

  it('read as the ticked self: a persona\'s note, appointment and list entry never reach the general self, and the other way round', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const a = await boot(memoryDataSource(), { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const p = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(p.id).chatId.pubKey;
    await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'het wachtwoord van de printer' }, { actAs: werk });
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Projecten' }, { actAs: werk });
    await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'Projecten', text: 'offerte' }, { actAs: werk });
    await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'klantoverleg', when: `${tomorrow()}T09:00:00.000Z` }, { actAs: werk });
    await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'de sleutel ligt bij de buren' });
    await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'tandarts', when: `${tomorrow()}T10:00:00.000Z` });
    await a.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    await a.callSkill('lists', 'addToList', { circleId: OWN, list: 'Boodschappen', text: 'melk' });
    const general = (await loadOwnItems({ call: as(a), self: { key: a.identity?.chat?.pubKey ?? null, isDefault: true } })()).map((i) => i.text).join('\n');
    expect(general).toContain('sleutel');
    expect(general, 'Werk\'s note').not.toContain('printer');
    expect(general, 'Werk\'s list').not.toContain('offerte');
    expect(general, 'Werk\'s appointment').not.toContain('klantoverleg');
    expect(general).toContain('tandarts');
    expect(general).toContain('melk');
    const asWerk = (await loadOwnItems({ call: as(a, werk), self: { key: werk, isDefault: false } })()).map((i) => i.text).join('\n');
    expect(asWerk).toContain('printer');
    expect(asWerk).toContain('offerte');
    expect(asWerk, 'the general self\'s note').not.toContain('sleutel');
    expect(asWerk).toContain('klantoverleg');
    expect(asWerk, 'the general self\'s appointment').not.toContain('tandarts');
    expect(asWerk, 'the general self\'s list entry').not.toContain('melk');
  });
});

describe('a read the MODEL picks is cut to the ticked self too (the same rule as the reader)', () => {
  it('with Werk ticked, the agenda and the note list the model reads never hold the general self\'s rows', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const { createPlusDoor } = await import('../../src/assistant/plusDoor.js');
    const { EventLog } = await import('../../src/eventLog.js');
    const { createBotThreads, memoryThreadStore } = await import('../../src/v2/botThreads.js');
    const a = await boot(memoryDataSource(), { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    const p = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(p.id).chatId.pubKey;
    const me = a.identity?.chat?.pubKey ?? null;
    await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'tandarts', when: `${tomorrow()}T10:00:00.000Z` });
    await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'de sleutel ligt bij de buren' });
    await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'klantoverleg', when: `${tomorrow()}T09:00:00.000Z` }, { actAs: werk });
    const selfKeyOf = (id) => (id === p.id ? werk : me);
    const readAs = (id) => as(a, id === p.id ? werk : null);
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    for (const opId of ['listEvents', encodeGenericOpId('household', 'list', 'note')]) {
      // everything the model is handed (its context on every call: the retrieval and the read handed back) and what
      // the "+" answers
      const handed = [];
      const d = createPlusDoor({ llm: { invoke: async () => null }, threads, selfKeyOf, readAs, t: (k) => k, lang: 'nl',
        interpret: async (_text, o) => { handed.push(JSON.stringify(o.context ?? [])); return { opId, args: {} }; } });
      const r = await d.read('wat staat er morgen, en wat weet je nog?', { asSelf: p.id });
      expect(handed.length, `${opId}: the read was handed back to the model`).toBeGreaterThan(1);
      const said = JSON.stringify(r) + handed.join(' ');
      expect(said, `${opId}: the general self's appointment`).not.toContain('tandarts');
      expect(said, `${opId}: the general self's note`).not.toContain('sleutel');
    }
  });
});
