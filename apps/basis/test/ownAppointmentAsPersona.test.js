/**
 * An appointment made with "+" while a persona is ticked is that persona's: the own calendar writes it as the self the
 * call is made AS (the waist's `actAs`), as an own note does, so it rides that persona's own lane and Vandaag's row
 * names that persona as its maker.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { materializeScreen } from '../src/v2/userScreenBlocks.js';
import { plusOp, plusEditFor, plusSaveOp } from '../src/v2/vandaagPlus.js';

describe("an own appointment made AS a persona (the waist's actAs)", () => {
  it('carries the persona as its maker; a call as nobody in particular stays the default\'s', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(made.id).chatId.pubKey;
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const asWerk = plusOp('calendar.calendar-event', { title: 'overleg', when });
    const asDefault = plusOp('calendar.calendar-event', { title: 'tandarts', when });
    expect((await a.callSkill(asWerk.app, asWerk.opId, asWerk.args, { actAs: werk }))?.ok).not.toBe(false);
    expect((await a.callSkill(asDefault.app, asDefault.opId, asDefault.args))?.ok).not.toBe(false);

    const events = await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event');
    expect(events.find((e) => e.title === 'overleg')?.createdBy, 'made as Werk').toBe(werk);

    const held = [{ id: 'default', webid: a.identity?.chat?.pubKey ?? 'me' }, { id: made.id, webid: werk }];
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'g', type: 'items', config: { noun: 'calendar-event' } }] },
      hostOps: { callSkill: (app, o, g) => a.callSkill(app, o, g), circles: [], selfSet: { on: ['default', made.id], held } },
    });
    const makerOf = (title) => block.content.items.find((r) => (r.title ?? r.label) === title)?.maker;
    expect(makerOf('overleg'), 'Vandaag names Werk as its maker').toBe(made.id);
    expect(makerOf('tandarts')).toBe('default');
    // …and changed again as its maker (the row's sheet passes the maker as actAs, both shells)
    const row = block.content.items.find((r) => (r.title ?? r.label) === 'overleg');
    const edit = plusEditFor(row, 'calendar-event');
    expect(edit?.asSelf).toBe(made.id);
    const save = plusSaveOp(edit.act.id, { title: 'overleg verzet', when }, { id: edit.id });
    expect((await a.callSkill(save.app, save.opId, save.args, { actAs: werk }))?.ok).not.toBe(false);
    const after = (await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event')).find((e) => e.id === row.id);
    expect(after?.title).toBe('overleg verzet');
    expect(after?.createdBy, 'still Werk\'s').toBe(werk);
  });
  it('the writer comes only from the checked self: an actor the caller names in the args is not taken', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const op = plusOp('calendar.calendar-event', { title: 'naamloos', when });
    expect((await a.callSkill(op.app, op.opId, { ...op.args, actor: 'anyone-at-all' }))?.ok).not.toBe(false);
    const ev = (await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event')).find((e) => e.title === 'naamloos');
    expect(ev?.createdBy, 'a named actor in the args is ignored on the own calendar').toBe('me');
  });
  it('an answer keeps the actor it names (the peer it came from), even when the call is made as a persona', async () => {
    const { VaultMemory } = await import('@onderling/vault');
    const ds = memoryDataSource();
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }) });
    const made = await a.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = a.persona(made.id).chatId.pubKey;
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const op = plusOp('calendar.calendar-event', { title: 'koffie', when });
    const added = await a.callSkill(op.app, op.opId, op.args, { actAs: werk });
    const id = added?.itemId ?? (await createOwnDevicesStore({ dataSource: ds }).listByType('calendar-event')).find((e) => e.title === 'koffie')?.id;
    expect((await a.callSkill('calendar', 'rsvpAccept', { id, actor: 'peer-address-x' }, { actAs: werk }))?.ok).not.toBe(false);
    const rsvps = await createOwnDevicesStore({ dataSource: ds }).listByType('rsvp');
    expect(rsvps.map((r) => r.by), 'the answer is the peer\'s, not my persona\'s').toContain('peer-address-x');
  });
});
