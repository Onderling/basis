/**
 * A2 — fetch-resource skill registration on Stoop bundles + groupCheck.
 *
 * attachSubstrateMirror registers `fetch-resource` so peers can pull
 * a resource bound by this device's pseudoPod. groupCheck only admits
 * pubKeys that are in this group's substrate-mirror peer set
 * (`mirror.getPeers()`). Verified through the skill's handler.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';
import { attachSubstrateMirror }   from '../src/substrateMirror.js';

const ANNE  = 'https://id.example/anne';
const GROUP = 'oosterpoort';

async function makeBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function invokeFetch(agent, uri, from) {
  const def = agent.skills.get('fetch-resource');
  if (!def) throw new Error('fetch-resource not registered');
  return def.handler({
    parts:    [DataPart({ uri })],
    from,
    agent,
    envelope: null,
  });
}

describe('A2 — fetch-resource registered with groupCheck', () => {
  it('registers the skill on bundle.agent after attachSubstrateMirror', async () => {
    const bundle = await makeBundle();
    expect(bundle.agent.skills.get('fetch-resource')).toBeNull();
    await attachSubstrateMirror(bundle, { group: GROUP });
    expect(bundle.agent.skills.get('fetch-resource')).not.toBeNull();
  });

  it('serves a request when caller is in mirror.getPeers()', async () => {
    const bundle = await makeBundle();
    const mirror = await attachSubstrateMirror(bundle, { group: GROUP });
    const peer = 'pubkey:bob';
    await mirror.addPeer(peer);

    const deviceId = bundle.substrateDeviceId;
    const uri = `pseudo-pod://${deviceId}/stoop/${GROUP}/requests/abc`;
    await bundle.pseudoPod.write(uri, { text: 'hello', requestId: 'abc' });

    const parts = await invokeFetch(bundle.agent, uri, peer);
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0].type).toBe('DataPart');
    expect(parts[0].data.bytes).toEqual({ text: 'hello', requestId: 'abc' });
  });

  it('denies a non-peer caller with FORBIDDEN', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const deviceId = bundle.substrateDeviceId;
    const uri = `pseudo-pod://${deviceId}/stoop/${GROUP}/requests/abc`;
    await bundle.pseudoPod.write(uri, { text: 'private', requestId: 'abc' });

    await expect(invokeFetch(bundle.agent, uri, 'pubkey:stranger'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies an ex-peer (was added then never removed but kicked out via different flow)', async () => {
    // Substrate-mirror's getPeers is currently monotonic — peer that
    // was added stays there. This test pins the contract: the gate
    // is "in the current peer set", whatever the set's policy is. If
    // a future eviction substrate explicitly removes the peer from
    // the mirror, the deny works automatically.
    const bundle = await makeBundle();
    const mirror = await attachSubstrateMirror(bundle, { group: GROUP });
    // Never add this peer.
    const deviceId = bundle.substrateDeviceId;
    const uri = `pseudo-pod://${deviceId}/stoop/${GROUP}/requests/abc`;
    await bundle.pseudoPod.write(uri, { text: 'private', requestId: 'abc' });
    await expect(invokeFetch(bundle.agent, uri, 'pubkey:never-added'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mirror.getPeers()).toEqual([]);
  });

  it('denies when caller is anonymous (ctx.from missing)', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const deviceId = bundle.substrateDeviceId;
    const uri = `pseudo-pod://${deviceId}/stoop/${GROUP}/requests/abc`;
    await bundle.pseudoPod.write(uri, { text: 'x', requestId: 'abc' });
    const def = bundle.agent.skills.get('fetch-resource');
    await expect(def.handler({
      parts:    [DataPart({ uri })],
      // no `from`
      agent:    bundle.agent,
      envelope: null,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('NOT_FOUND when peer asks for a URI we have no bytes for', async () => {
    const bundle = await makeBundle();
    const mirror = await attachSubstrateMirror(bundle, { group: GROUP });
    const peer = 'pubkey:bob';
    await mirror.addPeer(peer);
    const deviceId = bundle.substrateDeviceId;
    const uri = `pseudo-pod://${deviceId}/stoop/${GROUP}/requests/missing`;
    await expect(invokeFetch(bundle.agent, uri, peer))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
