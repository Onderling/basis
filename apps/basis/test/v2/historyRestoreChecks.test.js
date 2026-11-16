/**
 * THE HISTORY RESTORE IS AN ARRIVAL: every signed statement a restore brings back passes the same signature check a
 * statement from a peer passes, before it lands on the fresh device's log. A restored history with one altered
 * statement: that statement is refused, the rest lands.
 *
 * The mirror is sealed to the owner, so the altered batch here is written THROUGH the owner's own seal (what a broken
 * or compromised device of the same person could write): opening the seal is not enough to land.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { memoryDataSource } from '@onderling/item-store';
import { createHistoryPodMedium } from '../../src/v2/historyMirror.js';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { EventLog } from '../../src/eventLog.js';

function memoryPodSource(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('404'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(pre) { return [...map.keys()].filter((k) => k.startsWith(pre)); },
  };
}

const waitFor = async (fn, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!fn() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  return fn();
};

describe('the history restore checks what it restores', () => {
  it('a restored history with one altered statement: that statement is refused, the rest lands', async () => {
    const settings = memoryDataSource();
    const podMap = new Map();
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    let sealStrategy = null;
    const provisionHistoryMirror = async (strategy) => {
      sealStrategy = strategy;
      return createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy });
    };

    // Device A: the mirror on, a circle made (its founding + membership statements ride the device log).
    const logA0 = new EventLog({ initial: [], muted: [] });
    const A0 = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logA0, provisionHistoryMirror, ...vaults });
    await A0.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    const logA = new EventLog({ initial: [], muted: [] });
    const A = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logA, provisionHistoryMirror, ...vaults });
    await waitFor(() => A.historyMirrorStatus() !== null);
    const made = await A.callSkill('pinboard', 'createGroupV2', { groupId: 'thuis', name: 'Thuis', rules: { text: 'r' } });
    expect(made?.error ?? null).toBe(null);
    const signed = logA.query().filter((e) => e.type === 'membership' && e.payload?.body && e.payload?.sig);
    expect(signed.length).toBeGreaterThan(0);
    await waitFor(() => (A.historyMirrorStatus()?.mirrored ?? 0) >= logA.size);
    expect(A.historyMirrorStatus()?.mirrored ?? 0).toBeGreaterThanOrEqual(signed.length);

    // The altered statement: one of A's, its subject changed, under a new id, in a lane of its own — sealed by the owner.
    const honest = signed[0];
    const altered = {
      ...honest,
      id: `${honest.id}-altered`,
      payload: { ...honest.payload, body: { ...honest.payload.body, subject: 'iemand-anders' } },
    };
    const medium = await createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy: sealStrategy });
    await medium.write('basis/history/log/other-device/batch-1.json',
      JSON.stringify({ n: 1, firstSeq: 1, lastSeq: 1, entries: [altered] }));

    // Device B: fresh, the same person; the restore runs at boot.
    const logB = new EventLog({ initial: [], muted: [] });
    await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logB, provisionHistoryMirror, ...vaults });
    await waitFor(() => signed.every((s) => logB.query().some((e) => e.id === s.id)));
    await new Promise((r) => setTimeout(r, 200));   // the tail has its turn
    const landed = new Set(logB.query().map((e) => e.id));
    expect(signed.every((s) => landed.has(s.id))).toBe(true);   // the honest history is here
    expect(landed.has(altered.id)).toBe(false);                  // the altered statement is not
  }, 30_000);
});
