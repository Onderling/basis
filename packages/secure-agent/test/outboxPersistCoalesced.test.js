/**
 * THE OUTBOX IS WRITTEN ONCE PER BURST, NOT ONCE PER HOLD (ledger L619, the seeded Samsung 2026-11-22).
 *
 * Every hold serialised the WHOLE outbox and queued a write of it. A start that re-fans to many members who are not
 * there holds hundreds of messages in a few seconds; on the phone the outbox was ~200 kB, so each hold paid a 200 kB
 * JSON.stringify (31% of the JS thread between 8 and 12 s). Now a write still waiting takes the newest state when it
 * runs: holds made while it waits share it. What a caller was told is held is still in the durable copy once
 * `outboxFlushed()` resolves.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

/** A store whose writes are slow (as a sealed AsyncStorage write is) and counted. */
function slowStore() {
  const s = { map: new Map(), writes: 0 };
  s.read = async (uri) => (s.map.has(uri) ? s.map.get(uri) : null);
  s.write = async (uri, body) => { s.writes += 1; await new Promise((r) => setTimeout(r, 20)); s.map.set(uri, String(body)); };
  return s;
}
const URI = 'mem://secure-agent/outbox.json';

describe('the outbox write is shared by the holds of one burst', () => {
  it('50 holds in a burst: far fewer than 50 writes, and every one of them in the durable copy', async () => {
    const store = slowStore();
    const identity = await AgentIdentity.generate(new VaultMemory());
    const A = await createSecureAgent({ identity, holdStore: store, holdStoreUri: URI });
    await A.outboxRestored();
    const before = store.writes;
    const sends = [];
    for (let i = 0; i < 50; i += 1) sends.push(A.peer.sendTo(`peer-${i % 5}`, { msgId: `m-${i}`, text: `t${i}` }, { guarantee: 'hold-forward' }));
    await Promise.all(sends);
    await A.outboxFlushed();
    const writes = store.writes - before;
    expect(writes, `${writes} writes for 50 holds`).toBeLessThanOrEqual(5);
    const stored = store.map.get(URI);
    for (let i = 0; i < 50; i += 1) expect(stored).toContain(`"m-${i}"`);
  }, 30_000);
});
