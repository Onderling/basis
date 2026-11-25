/**
 * THE OUTBOX AND THE INBOUND RECORD NEVER SAVE OVER A COPY THEY COULD NOT READ.
 *
 * Both are one versioned document in a store row. A copy this build could not read — a newer build's `v`, bytes that
 * do not parse, a shape it does not know — read as an empty queue / an empty record, and the next hold (or the next
 * taken message) wrote that empty state over it: messages waiting for an offline peer, gone. Now such a copy is left
 * exactly as it is: nothing is saved over it, the store says so through `onStoreNotReadable` (the device's one
 * notice, kind `messages`), and the run goes on in memory.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { createSeenInboundRing } from '../src/seenInbound.js';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

function memoryStore(map = new Map()) {
  return {
    map,
    async read(uri) { return map.has(uri) ? map.get(uri) : null; },
    async write(uri, body) { map.set(uri, String(body)); },
  };
}
const OUTBOX = 'mem://secure-agent/outbox.json';
const SEEN = 'mem://secure-agent/seen-inbound.json';
const NEWER_OUTBOX = JSON.stringify({ v: 2, peers: [['peer-x', [['k', { payload: { msgId: 'kept' } }]]]] });
const TORN = '{"v":1,"peers":[["peer-x"';

describe('the outbox keeps a copy it could not read', () => {
  for (const [what, raw, reason] of [['a newer build\'s outbox', NEWER_OUTBOX, 'version'], ['a torn outbox', TORN, 'unparseable']]) {
    it(`${what}: a new hold does not write over it, and it is said`, async () => {
      const store = memoryStore(new Map([[OUTBOX, raw]]));
      const said = [];
      const identity = await AgentIdentity.generate(new VaultMemory());
      const agent = await createSecureAgent({ identity, holdStore: store, holdStoreUri: OUTBOX, onStoreNotReadable: (r) => said.push(r) });
      await agent.outboxRestored();
      const res = await agent.peer.sendTo('peer-y', { msgId: 'm-new', text: 'x' }, { guarantee: 'hold-forward' });
      expect(res.held).toBe(true);   // held in memory for this run
      await agent.outboxFlushed();
      expect(store.map.get(OUTBOX), 'the unreadable outbox was written over').toBe(raw);
      expect(said).toEqual([{ name: OUTBOX, kind: 'messages', reason }]);
    });
  }
});

describe('the inbound record keeps a copy it could not read', () => {
  it('a newer build\'s record: a taken message does not write over it, and it is said', async () => {
    const raw = JSON.stringify({ v: 2, rows: [['aaaa', 1]] });
    const store = memoryStore(new Map([[SEEN, raw]]));
    const said = [];
    const ring = createSeenInboundRing({ store, uri: SEEN, saveDelayMs: 1, onNotReadable: (r) => said.push(r) });
    await ring.ready;
    await ring.add('sender|m-1');
    await ring.flush();
    expect(store.map.get(SEEN)).toBe(raw);
    expect(said).toEqual([{ name: SEEN, kind: 'messages', reason: 'version' }]);
    expect(await ring.has('sender|m-1'), 'still known in memory for this run').toBe(true);
  });

  it('a readable record saves as before', async () => {
    const store = memoryStore();
    const ring = createSeenInboundRing({ store, uri: SEEN, saveDelayMs: 1 });
    await ring.ready;
    await ring.add('sender|m-1');
    await ring.flush();
    expect(JSON.parse(store.map.get(SEEN)).v).toBe(1);
  });
});
