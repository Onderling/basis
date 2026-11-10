/**
 * The agent's half of a kept room conversation: the keep port writes to THIS device's log, a contact's thread reads
 * the visit back after their card, and the person's setting (`nearby.keepDays`) is the live window: set lower, older
 * lines drop at once; set to 0, nothing more is kept.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { EventLog } from '../src/eventLog.js';

const DAY = 24 * 60 * 60 * 1000;

describe('a kept room conversation, at the agent', () => {
  let A;
  afterAll(async () => { await A?.dispose?.(); });

  it('kept under the visit, read back for the contact, windowed by the person\'s setting', async () => {
    let now = Date.now();
    const deviceLog = new EventLog({ now: () => now });
    A = await createRealHouseholdAgent({
      seedHousehold: false, deviceLog,
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
    });
    const keep = A.nearbyKeeper(() => 'visit-1');
    keep.line({ peer: 'room-ann', who: 'them', text: 'wie heeft een ladder?' });
    keep.line({ peer: 'room-ann', who: 'me', text: 'ik' });
    expect(A.earlierInTheRoom('ANN'), 'no card yet').toEqual([]);
    keep.card({ peer: 'room-ann', address: 'ANN' });
    expect(A.earlierInTheRoom('ANN')[0].lines.map((l) => l.text)).toEqual(['wie heeft een ladder?', 'ik']);

    // outside a room there is no visit: nothing is kept
    expect(A.nearbyKeeper(() => null).line({ peer: 'room-x', who: 'them', text: 'buiten' })).toBeNull();

    // the setting is the live window: two days on, set to 1 day, the visit drops at once
    now += 2 * DAY;
    expect((await A.callSkill('params', 'set-param', { key: 'nearby.keepDays', value: 1 }))?.ok).not.toBe(false);
    expect(A.earlierInTheRoom('ANN'), 'past the person\'s window').toEqual([]);

    // set to 0: nothing more is kept
    expect((await A.callSkill('params', 'set-param', { key: 'nearby.keepDays', value: 0 }))?.ok).not.toBe(false);
    expect(A.nearbyKeeper(() => 'visit-2').line({ peer: 'room-bas', who: 'them', text: 'hoi' })).toBeNull();
  }, 120_000);
});
