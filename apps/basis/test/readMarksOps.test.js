/**
 * The read marks through the waist, on the real agent: `markRead` writes the self's own row in the own-devices store
 * (a persona's circle under that persona, so it rides that persona's own lane), `listReadMarks` reads every self's.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const device = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });

describe('markRead / listReadMarks on the real agent', () => {
  it('marks are kept per self and group, grow, and read back; a persona\'s circle is that persona\'s row', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ...device(), deviceLog: new EventLog({ initial: [], muted: [] }) });
    const now = Date.now();
    expect(await phone.callSkill('household', 'markRead', { group: 'c1', read: [{ id: 'm1', at: now - 10 }] })).toMatchObject({ ok: true, changed: true });
    expect(await phone.callSkill('household', 'markRead', { group: 'c1', read: [{ id: 'm1', at: now - 10 }] })).toMatchObject({ ok: true, changed: false });
    await phone.callSkill('household', 'markRead', { group: 'c1', read: [{ id: 'm2', at: now - 5 }] });

    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    await phone.callSkill('agents', 'setProfileCircleMembership', { id: w, circleId: 'werkoverleg', handle: 'w', address: phone.persona(w).circleAddressFor('werkoverleg') });
    await phone.callSkill('household', 'markRead', { group: 'werkoverleg', read: [{ id: 'x1', at: now }] });

    const { rows } = await phone.callSkill('household', 'listReadMarks', {});
    const byGroup = Object.fromEntries(rows.map((r) => [r.group, r]));
    expect(byGroup.c1.read.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(byGroup.c1.id).toBe('read-marks:default:c1');
    expect(byGroup.werkoverleg.id).toBe(`read-marks:${w}:werkoverleg`);
    expect(byGroup.werkoverleg.createdBy, 'written as Werk, so it rides Werk\'s own lane').toBe(phone.persona(w).chatId.pubKey);
    await phone.shutdown?.();
  });

  it('the news window is the person\'s: a shorter one moves the floor, and an older mark is not kept', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ...device(), deviceLog: new EventLog({ initial: [], muted: [] }) });
    const fiveDaysAgo = Date.now() - 5 * 86_400_000;
    await phone.callSkill('household', 'markRead', { group: 'c1', read: [{ id: 'kept', at: fiveDaysAgo }] });
    let row = (await phone.callSkill('household', 'listReadMarks', {})).rows.find((r) => r.group === 'c1');
    expect(row.read.map((m) => m.id), 'the default window (7 days, marks kept for 14) keeps it').toEqual(['kept']);
    const before = row.prunedBefore;

    expect((await phone.callSkill('params', 'set-param', { key: 'notify.windowDays', value: 1 }))?.ok).not.toBe(false);
    await phone.callSkill('household', 'markRead', { group: 'c1', read: [{ id: 'new', at: Date.now() }] });
    row = (await phone.callSkill('household', 'listReadMarks', {})).rows.find((r) => r.group === 'c1');
    expect(row.prunedBefore, 'a one-day window raises the floor').toBeGreaterThan(before);
    expect(row.read.map((m) => m.id), 'a five-day-old mark falls below a two-day horizon').toEqual(['new']);
    await phone.shutdown?.();
  });
});
