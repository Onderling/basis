/**
 * A person's OWN appointments and OWN notes are read PER SELF, default-deny, as their own lists are (`ownStoreAsSelf`):
 * the own agenda's and the own notes' routes answer only the rows of the self the call is made as, or of the SET of
 * selves it names (`selves`: Today's blocks read every ticked self). A summary over the own agenda (`briefSummary`) says
 * only that set's appointments. Measured before: a persona's appointment came back to the general self.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

const OWN = OWN_DEVICES_SCOPE;
const NOTE_ADD = encodeGenericOpId('household', 'add', 'note');
const NOTE_LIST = encodeGenericOpId('household', 'list', 'note');
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const words = (r) => JSON.stringify(r ?? null);

async function setup() {
  const { VaultMemory } = await import('@onderling/vault');
  const a = await createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: memoryDataSource() }), ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
  const p = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
  const werk = a.persona(p.id).chatId.pubKey;
  await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'klantoverleg', when: `${tomorrow()}T09:00:00.000Z` }, { actAs: werk });
  await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'het wachtwoord van de printer' }, { actAs: werk });
  await a.callSkill('calendar', 'addEvent', { circleId: OWN, title: 'tandarts', when: `${tomorrow()}T10:00:00.000Z` });
  await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'de sleutel ligt bij de buren' });
  return { a, werk, werkId: p.id };
}

describe('the own agenda and the own notes, read per self (default-deny)', () => {
  it('as Werk: Werk\'s appointment and note only; as the general self: its own only', async () => {
    const { a, werk } = await setup();
    const asWerk = (app, op, args) => a.callSkill(app, op, args, { actAs: werk });
    expect(words(await asWerk('calendar', 'listEvents', { circleId: OWN, days: 7 }))).toContain('klantoverleg');
    expect(words(await asWerk('calendar', 'listEvents', { circleId: OWN, days: 7 })), 'the general self\'s appointment').not.toContain('tandarts');
    expect(words(await asWerk('household', NOTE_LIST, { circleId: OWN })), 'the general self\'s note').not.toContain('sleutel');
    expect(words(await asWerk('household', NOTE_LIST, { circleId: OWN }))).toContain('printer');
    expect(words(await asWerk('calendar', 'briefSummary', { circleId: OWN })), 'a summary as Werk').not.toContain('tandarts');
    const general = (app, op, args) => a.callSkill(app, op, args);
    expect(words(await general('calendar', 'listEvents', { circleId: OWN, days: 7 })), 'Werk\'s appointment').not.toContain('klantoverleg');
    expect(words(await general('calendar', 'listEvents', { circleId: OWN, days: 7 }))).toContain('tandarts');
    expect(words(await general('household', NOTE_LIST, { circleId: OWN })), 'Werk\'s note').not.toContain('printer');
    expect(words(await general('calendar', 'briefSummary', { circleId: OWN })), 'a summary as the general self').not.toContain('klantoverleg');
  });
  it('a read whose CALL names the set of selves (Today\'s block, both ticked) answers both, and only those', async () => {
    const { a, werkId } = await setup();
    const both = words(await a.callSkill('calendar', 'listEvents', { circleId: OWN, days: 7 }, { selves: ['default', werkId] }));
    expect(both).toContain('klantoverleg');
    expect(both).toContain('tandarts');
    const notes = words(await a.callSkill('household', NOTE_LIST, { circleId: OWN }, { selves: ['default', werkId] }));
    expect(notes).toContain('printer');
    expect(notes).toContain('sleutel');
    const onlyWerk = words(await a.callSkill('calendar', 'listEvents', { circleId: OWN, days: 7 }, { selves: [werkId] }));
    expect(onlyWerk).not.toContain('tandarts');
  });
  // Fable's review: a set in the ARGS can come from anyone (a model's pick, a typed line, a door) and is never followed
  it('a set named in the args is ignored: as the general self, args naming Werk read nothing of Werk\'s', async () => {
    const { a, werkId } = await setup();
    expect(words(await a.callSkill('calendar', 'listEvents', { circleId: OWN, days: 7, selves: [werkId] }))).not.toContain('klantoverleg');
    expect(words(await a.callSkill('household', NOTE_LIST, { circleId: OWN, selves: [werkId] }))).not.toContain('printer');
    expect(words(await a.callSkill('calendar', 'briefSummary', { circleId: OWN, selves: [werkId] }))).not.toContain('klantoverleg');
  });
  it('the general self cannot change or cancel Werk\'s appointment, even by its id', async () => {
    const { a, werk } = await setup();
    const listed = await a.callSkill('calendar', 'listEvents', { circleId: OWN, days: 7 }, { actAs: werk });
    const id = listed?.items?.find((e) => /klantoverleg/.test(JSON.stringify(e)))?.id;
    expect(id, 'Werk\'s appointment id').toBeTruthy();
    expect((await a.callSkill('calendar', 'cancelEvent', { circleId: OWN, id }))?.ok, 'cancel as the general self').not.toBe(true);
    expect((await a.callSkill('calendar', 'updateEvent', { circleId: OWN, id, title: 'weg' }))?.ok, 'update as the general self').not.toBe(true);
    expect(words(await a.callSkill('calendar', 'listEvents', { circleId: OWN, days: 7 }, { actAs: werk }))).toContain('klantoverleg');
  });
});
