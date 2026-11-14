/**
 * Two writers of one circle's group-key resource (two devices of the founder, or a join and a device enrolment on one).
 * Every change is computed on the STORED resource and written only if it is still the one that was read; a lost race
 * recomputes on what the winner wrote. Held here:
 *   1. a join racing the removal of the same member ends with the member OUT, in both orders (the roster re-check);
 *   2. retries are bounded, and running out writes nothing and throws (the caller reports it, never silent);
 *   3. a device enrolment racing a join keeps both;
 *   4. a roster that cannot answer stops the join: nothing written, no pod access granted;
 * and the pod key store's compare-and-swap over a real pseudo-pod (the ETag of the read that produced the base).
 */
import { describe, it, expect, vi } from 'vitest';
import { createControlAgent } from '../src/sealing/controlAgent.js';
import { createPodKeyStore } from '../src/sealing/podKeyStore.js';
import { generateKeypair, unwrapGroupKey } from '../src/sealing/index.js';
import { PodClient } from '../src/PodClient.js';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';

const opens = (res, priv) => { try { unwrapGroupKey(res, priv); return true; } catch { return false; } };

/** One stored resource behind a compare-and-swap; each DEVICE gets its own store view over it (as each device has
 *  its own pod client), stamped with the version each read saw. `interleave` runs once before the next write. */
function casBacking() {
  const b = { stored: null, version: 0, interleave: null };
  b.view = () => {
    const seen = new WeakMap();
    return {
      async read() { if (!b.stored) return null; const copy = JSON.parse(JSON.stringify(b.stored)); seen.set(copy, b.version); return copy; },
      async write(r) { b.stored = r; b.version += 1; },
      async writeIfUnchanged(next, cur) {
        const go = b.interleave; b.interleave = null;
        if (go) await go();
        if (cur == null ? b.stored != null : seen.get(cur) !== b.version) return false;
        b.stored = next; b.version += 1; return true;
      },
    };
  };
  b.current = () => b.stored;
  return b;
}

function agentOver(keyStore, controllerKey, roster = []) {
  const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
  return { agent: createControlAgent({ sharing, containerUri: 'https://pod/c/', keyStore, controllerKey, roster }), sharing };
}

describe('the group-key resource under two writers', () => {
  it('a join racing the removal of the same member ends with the member out: the removal lands first', async () => {
    const store = casBacking(); const ck = generateKeypair();
    const founder = generateKeypair(); const x = generateKeypair();
    const one = agentOver(store.view(), ck).agent;
    await one.addMember({ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' });
    // device two joins X from an event; between its read and its write, device one adds X and removes X again
    const two = agentOver(store.view(), ck).agent;
    let member = true;
    store.interleave = async () => {
      await one.addMember({ webId: 'ref:x', publicKey: x.publicKey });
      await one.removeMember({ webId: 'ref:x' });
      member = false;
    };
    const out = await two.addMember({ webId: 'ref:x', publicKey: x.publicKey, isMember: async () => member });
    expect(out.dropped, 'the recomputed add saw the removal and dropped its change').toBe(true);
    expect(opens(store.current(), x.privateKey), 'X cannot open the current key').toBe(false);
    expect(opens(store.current(), founder.privateKey)).toBe(true);
  });

  it('a join racing the removal of the same member ends with the member out: the join lands first', async () => {
    const store = casBacking(); const ck = generateKeypair();
    const founder = generateKeypair(); const x = generateKeypair();
    const one = agentOver(store.view(), ck).agent;
    await one.addMember({ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' });
    const two = agentOver(store.view(), ck).agent;
    await two.addMember({ webId: 'ref:x', publicKey: x.publicKey, isMember: async () => true });
    // the removal comes from device one, whose in-memory roster never saw X: it removes by the stored holders
    const three = agentOver(store.view(), ck, [{ webId: 'ref:x', publicKey: x.publicKey }]).agent;
    await three.removeMember({ webId: 'ref:x' });
    expect(opens(store.current(), x.privateKey)).toBe(false);
    expect(opens(store.current(), founder.privateKey)).toBe(true);
  });

  it('retries are bounded: a store that always loses writes nothing and throws', async () => {
    const ck = generateKeypair(); const founder = generateKeypair();
    const store = { read: async () => null, write: vi.fn(async () => {}), writeIfUnchanged: vi.fn(async () => false) };
    const { agent, sharing } = agentOver(store, ck);
    await expect(agent.addMember({ webId: 'ref:f', publicKey: founder.publicKey })).rejects.toMatchObject({ code: 'KEY_WRITE_CONTENDED' });
    expect(store.writeIfUnchanged).toHaveBeenCalledTimes(4);
    expect(store.write).not.toHaveBeenCalled();
    expect(sharing.grant, 'no pod access for a join that was not written').not.toHaveBeenCalled();
  });

  it('a device enrolment racing a join keeps both', async () => {
    const store = casBacking(); const ck = generateKeypair();
    const founder = generateKeypair(); const device = generateKeypair(); const bea = generateKeypair();
    const one = agentOver(store.view(), ck).agent;
    await one.addMember({ webId: 'ref:founder', publicKey: founder.publicKey, role: 'admin' });
    const two = agentOver(store.view(), ck).agent;
    store.interleave = async () => { await two.addMember({ webId: 'ref:bea', publicKey: bea.publicKey }); };
    await one.grantRecipient({ publicKey: device.publicKey });
    expect(opens(store.current(), device.privateKey), 'the enrolled device').toBe(true);
    expect(opens(store.current(), bea.privateKey), 'the joiner').toBe(true);
  });

  it('a roster that cannot answer stops the join: nothing written, no pod access', async () => {
    const store = casBacking(); const ck = generateKeypair(); const bea = generateKeypair();
    const { agent, sharing } = agentOver(store.view(), ck);
    await expect(agent.addMember({ webId: 'ref:bea', publicKey: bea.publicKey, isMember: async () => null }))
      .rejects.toMatchObject({ code: 'MEMBER_UNKNOWN' });
    expect(store.current()).toBeNull();
    expect(sharing.grant).not.toHaveBeenCalled();
  });
});

describe('podKeyStore.writeIfUnchanged over a pseudo-pod', () => {
  const URI = 'pseudo-pod://kp/circles/c/.keys/group.json';
  const client = () => {
    const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'kp' });
    return new PodClient({ podRoot: 'pseudo-pod://kp/', auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
  };

  it('writes on the base it read, refuses once another writer changed it, and only creates where nothing is', async () => {
    const pod = client();
    const a = createPodKeyStore({ podClient: pod, uri: URI });
    const b = createPodKeyStore({ podClient: pod, uri: URI });
    expect(await a.writeIfUnchanged({ version: 1 }, null)).toBe(true);
    expect(await b.writeIfUnchanged({ version: 1, other: true }, null), 'something is there now').toBe(false);
    const curA = await a.read(); const curB = await b.read();
    expect(await b.writeIfUnchanged({ version: 1, by: 'b' }, curB)).toBe(true);
    expect(await a.writeIfUnchanged({ version: 1, by: 'a' }, curA), 'a built on a base b replaced').toBe(false);
    const fresh = await a.read();
    expect(fresh.by).toBe('b');
    expect(await a.writeIfUnchanged({ version: 2, by: 'a' }, fresh)).toBe(true);
    expect((await b.read()).by).toBe('a');
  });
});
