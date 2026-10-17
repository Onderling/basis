/**
 * AgentRegistryMemberMap — MemberMap-shaped adapter over a registry-like object.
 *
 * Uses a fake registry (lookup + list) to avoid pulling in the full
 * @onderling/agent-registry test surface.
 */

import { describe, it, expect } from 'vitest';
import { createAgentRegistryMemberMap } from '../src/AgentRegistryMemberMap.js';

const ANNE = {
  agentId:      'laptop-anne',
  pubKey:       'pub-anne',
  webid:        'https://anne.pod/profile#me',
  agentUri:     'https://anne.pod/profile#me/agent/laptop',
  role:         'device',
  name:         'Anne (laptop)',
  deviceId:     'laptop-anne',
  capabilities: ['pinboard', 'tasks'],
  revokedAt:    null,
};
const BOB = {
  agentId:      'phone-bob',
  pubKey:       'pub-bob',
  webid:        'https://bob.pod/profile#me',
  agentUri:     'https://bob.pod/profile#me/agent/phone',
  role:         'device',
  name:         'Bob',
  deviceId:     'phone-bob',
  capabilities: [],
  revokedAt:    null,
};

function fakeRegistry(entries) {
  const byIdent = new Map();
  for (const e of entries) {
    byIdent.set(e.agentId,  e);
    byIdent.set(e.pubKey,   e);
    byIdent.set(e.webid,    e);
    byIdent.set(e.agentUri, e);
    byIdent.set(e.deviceId, e);
  }
  return {
    async lookup(identifier) {
      if (typeof identifier !== 'string') return null;
      return byIdent.get(identifier) ?? null;
    },
    async list() { return entries; },
  };
}

describe('createAgentRegistryMemberMap — construction', () => {
  it('throws on missing registry', () => {
    expect(() => createAgentRegistryMemberMap(null)).toThrow();
  });

  it('throws when registry has no lookup', () => {
    expect(() => createAgentRegistryMemberMap({})).toThrow();
  });
});

describe('AgentRegistryMemberMap — resolveByWebid', () => {
  it('returns the member shape from a matching entry', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    const m = await mm.resolveByWebid('https://anne.pod/profile#me');
    expect(m).toMatchObject({
      webid:       'https://anne.pod/profile#me',
      displayName: 'Anne (laptop)',
      pubKey:      'pub-anne',
      stableId:    'laptop-anne',
      role:        'device',
      capabilities: ['pinboard', 'tasks'],
      deviceId:    'laptop-anne',
      agentUri:    'https://anne.pod/profile#me/agent/laptop',
    });
    // Fields not carried by the registry are nulled.
    expect(m.handle).toBe(null);
    expect(m.avatarUrl).toBe(null);
  });

  it('null on miss', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    expect(await mm.resolveByWebid('https://other.pod/profile#me')).toBe(null);
  });

  it('null on bad input', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    expect(await mm.resolveByWebid('')).toBe(null);
    expect(await mm.resolveByWebid(null)).toBe(null);
  });
});

describe('AgentRegistryMemberMap — resolveByPubKey', () => {
  it('returns the member by Ed25519 pubKey', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    const m = await mm.resolveByPubKey('pub-anne');
    expect(m?.webid).toBe('https://anne.pod/profile#me');
  });
});

describe('AgentRegistryMemberMap — resolveByExternalId', () => {
  it('bridges deviceId → member', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    const m = await mm.resolveByExternalId('deviceId', 'laptop-anne');
    expect(m?.pubKey).toBe('pub-anne');
  });

  it('bridges agentUri → member', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    const m = await mm.resolveByExternalId('agentUri', 'https://anne.pod/profile#me/agent/laptop');
    expect(m?.pubKey).toBe('pub-anne');
  });

  it('null for unsupported namespaces (V0)', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    // External IDs like telegramUid still need the legacy MemberMap.
    expect(await mm.resolveByExternalId('telegramUid', '12345')).toBe(null);
  });
});

describe('AgentRegistryMemberMap — listMembers', () => {
  it('returns all entries in member shape', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE, BOB]));
    const all = await mm.listMembers();
    expect(all).toHaveLength(2);
    expect(all.map(m => m.webid).sort()).toEqual([
      'https://anne.pod/profile#me',
      'https://bob.pod/profile#me',
    ]);
  });

  it('returns [] when registry has no list', async () => {
    const mm = createAgentRegistryMemberMap({ lookup: async () => null });
    expect(await mm.listMembers()).toEqual([]);
  });
});

describe('AgentRegistryMemberMap — integration with Resolver', () => {
  it('plugs into the resolve() pipeline', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    // The Resolver only needs `resolveByWebid` — verify the shape matches.
    const { resolve } = await import('../src/Resolver.js');
    const result = await resolve({ memberMap: mm, targetWebid: 'https://anne.pod/profile#me' });
    expect(result?.webid).toBe('https://anne.pod/profile#me');
    // Without a Reveals store + no handle, fallback uses the WebID tail.
    expect(typeof result?.render).toBe('string');
  });

  it('non-existent target → null from Resolver', async () => {
    const mm = createAgentRegistryMemberMap(fakeRegistry([ANNE]));
    const { resolve } = await import('../src/Resolver.js');
    const result = await resolve({ memberMap: mm, targetWebid: 'https://nobody.pod/profile#me' });
    expect(result).toBe(null);
  });
});
