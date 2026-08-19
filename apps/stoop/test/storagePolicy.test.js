/**
 * A3 / A5 (substrate-adoption) — storage-policy skills.
 *
 * V2 web functional design §4a/§4c. Four §II.2 policies on the
 * circle level: `no-pod` (V1 parity default) / `centralised` /
 * `decentralised` / `hybrid`.
 *
 * Covers:
 *   - createGroupV2 accepts `storagePolicy`; default is `no-pod`.
 *   - centralised + hybrid require `groupPodUri`.
 *   - getCircleStoragePolicy reads from pod-routing → rules-item → default.
 *   - setCircleStoragePolicy is admin-only and one-way (no downgrade).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';
import { attachSubstrateMirror }   from '../src/substrateMirror.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';

async function makeBundle(actor = ANNE, memberSeed = [{ webid: ANNE, role: 'admin' }]) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: GROUP, localActor: actor, peers: [] },
    members:    memberSeed,
  });
  await bundle.offeringMatch.start();
  await attachSubstrateMirror(bundle, { group: GROUP });
  return bundle;
}

async function callSkill(agent, skillId, args, asWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     asWebid,
    agent,
    envelope: null,
  });
}

describe('A3 — createGroupV2 storage policy', () => {
  it('defaults to no-pod when storagePolicy is omitted', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId: 'g-1',
      name:    'Test',
      rules:   {},
    });
    expect(r.storage).toEqual({ policy: 'no-pod' });
    const rulesItem = (await bundle.itemStore.listOpen({ type: 'group-rules' }))
      .find(i => i.source?.groupId === 'g-1');
    expect(rulesItem?.source?.rules?.storage).toEqual({ policy: 'no-pod' });
  });

  it('accepts centralised with groupPodUri', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-2',
      name:          'Test',
      rules:         {},
      storagePolicy: 'centralised',
      groupPodUri:   'https://circle.pod/',
    });
    expect(r.storage).toEqual({ policy: 'centralised', groupPodUri: 'https://circle.pod/' });
  });

  it('rejects centralised without groupPodUri', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-3',
      name:          'Test',
      rules:         {},
      storagePolicy: 'centralised',
    });
    expect(r?.error).toMatch(/storage-policy-needs-groupPodUri:centralised/);
  });

  it('rejects hybrid without groupPodUri', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-4',
      name:          'Test',
      rules:         {},
      storagePolicy: 'hybrid',
    });
    expect(r?.error).toMatch(/storage-policy-needs-groupPodUri:hybrid/);
  });

  it('decentralised + no-pod ignore groupPodUri', async () => {
    const bundle = await makeBundle();
    const r1 = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-5',
      name:          'Test',
      rules:         {},
      storagePolicy: 'decentralised',
      groupPodUri:   'https://ignored.pod/',
    });
    expect(r1.storage).toEqual({ policy: 'decentralised' });
    const r2 = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-6',
      name:          'Test',
      rules:         {},
      storagePolicy: 'no-pod',
    });
    expect(r2.storage).toEqual({ policy: 'no-pod' });
  });

  it('rejects unknown policy', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-7',
      name:          'Test',
      rules:         {},
      storagePolicy: 'fancy-new-thing',
    });
    expect(r?.error).toMatch(/storage-policy-unknown:fancy-new-thing/);
  });

  it('pushes the policy into pod-routing on success', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-8',
      name:          'Test',
      rules:         {},
      storagePolicy: 'decentralised',
    });
    const policy = bundle.podRouting.circlePolicy('g-8');
    expect(policy.policy).toBe('decentralised');
  });
});

describe('A3 — getCircleStoragePolicy', () => {
  it('returns no-pod default when nothing is configured', async () => {
    const bundle = await makeBundle();
    const r = await callSkill(bundle.agent, 'getCircleStoragePolicy', { groupId: 'never-created' });
    expect(r).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('returns the live pod-routing policy after createGroupV2', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-live',
      name:          'Test',
      rules:         {},
      storagePolicy: 'centralised',
      groupPodUri:   'https://circle.pod/',
    });
    const r = await callSkill(bundle.agent, 'getCircleStoragePolicy', { groupId: 'g-live' });
    expect(r).toEqual({ policy: 'centralised', groupPodUri: 'https://circle.pod/' });
  });
});

describe('A5 — setCircleStoragePolicy', () => {
  it('upgrades no-pod → centralised', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: 'g-upgrade',
      name:    'Test',
      rules:   {},
    });
    const r = await callSkill(bundle.agent, 'setCircleStoragePolicy', {
      groupId:       'g-upgrade',
      storagePolicy: 'centralised',
      groupPodUri:   'https://anne.pod/',
    });
    expect(r.storage).toEqual({ policy: 'centralised', groupPodUri: 'https://anne.pod/' });
    expect(bundle.podRouting.circlePolicy('g-upgrade').policy).toBe('centralised');
  });

  it('rejects downgrade to no-pod', async () => {
    const bundle = await makeBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId:       'g-locked',
      name:          'Test',
      rules:         {},
      storagePolicy: 'centralised',
      groupPodUri:   'https://anne.pod/',
    });
    const r = await callSkill(bundle.agent, 'setCircleStoragePolicy', {
      groupId:       'g-locked',
      storagePolicy: 'no-pod',
    });
    expect(r?.error).toBe('storage-policy-downgrade-not-supported');
  });

  it('non-admin cannot change policy', async () => {
    const bundle = await makeBundle(ANNE, [
      { webid: ANNE, role: 'admin' },
      { webid: BOB,  role: 'member' },
    ]);
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: 'g-perm',
      name:    'Test',
      rules:   {},
    });
    const r = await callSkill(bundle.agent, 'setCircleStoragePolicy', {
      groupId:       'g-perm',
      storagePolicy: 'centralised',
      groupPodUri:   'https://anne.pod/',
    }, BOB);
    expect(r?.error).toBe('admin-only');
  });
});
