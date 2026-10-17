/**
 * createAgentRegistry — register / lookup / revoke / updateCapabilities / list.
 *
 * Backed by a real in-memory pseudo-pod.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { makeActorResolver }   from '../src/makeActorResolver.js';

const PUB_A = 'pub-anne-laptop';
const PUB_B = 'pub-anne-phone';

const ANNE_LAPTOP = {
  agentId:      'laptop-anne',
  pubKey:       PUB_A,
  webid:        'https://anne.pod/profile#me',
  agentUri:     'https://anne.pod/profile#me/agent/laptop',
  role:         'device',
  name:         'Anne (laptop)',
  deviceId:     'laptop-anne',
  capabilities: ['pinboard', 'tasks'],
};
const ANNE_PHONE = {
  agentId:      'phone-anne',
  pubKey:       PUB_B,
  webid:        'https://anne.pod/profile#me',
  agentUri:     'https://anne.pod/profile#me/agent/phone',
  role:         'device',
  name:         'Anne (phone)',
  deviceId:     'phone-anne',
  capabilities: ['tasks'],
};

function mkPod(deviceId = 'laptop-anne') {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
}

describe('createAgentRegistry — construction', () => {
  it('throws when pseudoPod is missing', () => {
    expect(() => createAgentRegistry({})).toThrow(/pseudoPod/);
  });

  it('defaults to pseudo-pod path when deviceId is supplied (V0)', () => {
    const reg = createAgentRegistry({
      pseudoPod:    mkPod('laptop-anne'),
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
    });
    expect(reg.resourceUri).toBe('pseudo-pod://laptop-anne/private/agent-registry');
  });

  it('falls back to anchorPodUri when only anchorPodUri is supplied', () => {
    const reg = createAgentRegistry({
      pseudoPod:    mkPod(),
      anchorPodUri: 'https://anne.pod',
    });
    expect(reg.resourceUri).toBe('https://anne.pod/private/agent-registry');
  });

  it('preferPodUri forces the https:// path', () => {
    const reg = createAgentRegistry({
      pseudoPod:    mkPod('laptop-anne'),
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
      preferPodUri: true,
    });
    expect(reg.resourceUri).toBe('https://anne.pod/private/agent-registry');
  });
});

describe('register + list', () => {
  let pseudoPod; let reg;
  beforeEach(() => {
    pseudoPod = mkPod('laptop-anne');
    reg = createAgentRegistry({ pseudoPod, deviceId: 'laptop-anne' });
  });

  it('first register seeds the resource + lists it back', async () => {
    await reg.register(ANNE_LAPTOP);
    const all = await reg.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      agentId:      'laptop-anne',
      pubKey:       PUB_A,
      capabilities: ['pinboard', 'tasks'],
    });
  });

  it('rejects missing required fields', async () => {
    await expect(reg.register({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(reg.register({ agentId: 'a' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(reg.register({ agentId: 'a', pubKey: 'p' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('register on existing agentId updates the entry', async () => {
    await reg.register(ANNE_LAPTOP);
    await reg.register({ ...ANNE_LAPTOP, name: 'Anne (renamed)' });
    const all = await reg.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Anne (renamed)');
  });

  it('register a second distinct agent', async () => {
    await reg.register(ANNE_LAPTOP);
    await reg.register(ANNE_PHONE);
    const all = await reg.list();
    expect(all.map(a => a.agentId).sort()).toEqual(['laptop-anne', 'phone-anne']);
  });
});

describe('lookup — by every identifier shape', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
  });

  it('by agentId', async () => {
    expect((await reg.lookup('laptop-anne'))?.pubKey).toBe(PUB_A);
  });

  it('by pubKey', async () => {
    expect((await reg.lookup(PUB_A))?.agentId).toBe('laptop-anne');
  });

  it('by webid', async () => {
    expect((await reg.lookup('https://anne.pod/profile#me'))?.agentId).toBe('laptop-anne');
  });

  it('by agentUri', async () => {
    expect((await reg.lookup('https://anne.pod/profile#me/agent/laptop'))?.agentId)
      .toBe('laptop-anne');
  });

  it('by deviceId', async () => {
    expect((await reg.lookup('laptop-anne'))?.pubKey).toBe(PUB_A);
  });

  it('returns null on miss', async () => {
    expect(await reg.lookup('does-not-exist')).toBe(null);
  });

  it('returns null on bad input', async () => {
    expect(await reg.lookup(null)).toBe(null);
    expect(await reg.lookup('')).toBe(null);
  });
});

describe('revoke', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
  });

  it('flips revokedAt; idempotent', async () => {
    await reg.revoke(PUB_A);
    const e1 = await reg.lookup(PUB_A);
    expect(e1?.revokedAt).toBeTruthy();
    // Re-revoke keeps the original timestamp.
    const ts1 = e1.revokedAt;
    await reg.revoke(PUB_A);
    const e2 = await reg.lookup(PUB_A);
    expect(e2?.revokedAt).toBe(ts1);
  });

  it('does not delete the entry', async () => {
    await reg.revoke(PUB_A);
    expect(await reg.list()).toHaveLength(1);
  });
});

describe('updateCapabilities', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
  });

  it('replaces the caps array', async () => {
    await reg.updateCapabilities(PUB_A, ['folio']);
    expect((await reg.lookup(PUB_A))?.capabilities).toEqual(['folio']);
  });

  it('rejects non-array caps', async () => {
    await expect(reg.updateCapabilities(PUB_A, 'not-an-array'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('purge — hard delete', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
    await reg.register(ANNE_PHONE);
  });

  it('removes the entry entirely (unlike revoke)', async () => {
    await reg.purge(PUB_A);
    expect(await reg.lookup(PUB_A)).toBe(null);
    const all = await reg.list();
    expect(all.map(a => a.agentId)).toEqual(['phone-anne']);
  });

  it('is idempotent — purging an absent id is a no-op', async () => {
    await reg.purge(PUB_A);
    await expect(reg.purge(PUB_A)).resolves.toBeTruthy();
    await expect(reg.purge('does-not-exist')).resolves.toBeTruthy();
    expect(await reg.list()).toHaveLength(1);
  });
});

describe('grants — signed-token authority + capability mirror', () => {
  let reg;
  beforeEach(async () => {
    reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register({ ...ANNE_LAPTOP, capabilities: [], grants: [] });
  });

  it('applyGrant sets grants[] + mirrors capabilities[] in one write', async () => {
    await reg.applyGrant(PUB_A, {
      tokenId:    'tok-1',
      skill:      'tasks.create',
      expiresAt:  '2027-01-01T00:00:00Z',
      subject:    'https://anne.pod/profile#me',
      capability: 'tasks',
    });
    const e = await reg.lookup(PUB_A);
    expect(e.grants).toHaveLength(1);
    expect(e.grants[0]).toMatchObject({ tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks' });
    expect(e.capabilities).toEqual(['tasks']);
  });

  it('applyGrant dedupes by tokenId + does not double-mirror the capability', async () => {
    await reg.applyGrant(PUB_A, { tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks' });
    await reg.applyGrant(PUB_A, { tokenId: 'tok-1', skill: 'tasks.delete', capability: 'tasks' });
    const e = await reg.lookup(PUB_A);
    expect(e.grants).toHaveLength(1);
    expect(e.grants[0].skill).toBe('tasks.delete');
    expect(e.capabilities).toEqual(['tasks']);
  });

  it('rejects a grant without tokenId', async () => {
    await expect(reg.applyGrant(PUB_A, { skill: 'tasks.create', capability: 'tasks' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('revokeGrant removes the grant + un-mirrors the orphaned capability', async () => {
    await reg.applyGrant(PUB_A, { tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks' });
    await reg.revokeGrant(PUB_A, 'tok-1');
    const e = await reg.lookup(PUB_A);
    expect(e.grants).toHaveLength(0);
    expect(e.capabilities).toEqual([]);
  });

  it('revokeGrant keeps a capability that another grant still references', async () => {
    await reg.applyGrant(PUB_A, { tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks' });
    await reg.applyGrant(PUB_A, { tokenId: 'tok-2', skill: 'tasks.delete', capability: 'tasks' });
    await reg.revokeGrant(PUB_A, 'tok-1');
    const e = await reg.lookup(PUB_A);
    expect(e.grants.map(g => g.tokenId)).toEqual(['tok-2']);
    expect(e.capabilities).toEqual(['tasks']);
  });

  it('revokeGrant is idempotent', async () => {
    await reg.applyGrant(PUB_A, { tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks' });
    await reg.revokeGrant(PUB_A, 'tok-1');
    await expect(reg.revokeGrant(PUB_A, 'tok-1')).resolves.toBeTruthy();
    await expect(reg.revokeGrant(PUB_A, 'never-existed')).resolves.toBeTruthy();
    expect((await reg.lookup(PUB_A)).grants).toHaveLength(0);
  });
});

describe('makeActorResolver', () => {
  it('bridges identifier kinds to a single ActorRecord', async () => {
    const reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
    const resolver = makeActorResolver(reg);

    const byPub = await resolver.resolve(PUB_A);
    expect(byPub?.agentUri).toBe('https://anne.pod/profile#me/agent/laptop');
    expect(byPub?.role).toBe('device');

    const byWebid = await resolver.resolve('https://anne.pod/profile#me');
    expect(byWebid?.pubKey).toBe(PUB_A);

    expect(await resolver.resolve('missing')).toBe(null);
  });

  it('register flows through to the registry', async () => {
    const reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    const resolver = makeActorResolver(reg);
    await resolver.register({
      pubKey:   PUB_A,
      webid:    'https://anne.pod/profile#me',
      agentUri: 'https://anne.pod/profile#me/agent/laptop',
      deviceId: 'laptop-anne',
      role:     'device',
    });
    expect((await reg.list())).toHaveLength(1);
  });

  it('revoke flows through', async () => {
    const reg = createAgentRegistry({
      pseudoPod: mkPod('laptop-anne'),
      deviceId:  'laptop-anne',
    });
    await reg.register(ANNE_LAPTOP);
    const resolver = makeActorResolver(reg);
    await resolver.revoke(PUB_A);
    const r = await resolver.resolve(PUB_A);
    expect(r?.revokedAt).toBeTruthy();
  });

  it('throws on bad input', () => {
    expect(() => makeActorResolver(null)).toThrow();
  });
});
