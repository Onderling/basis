/**
 * projectAgentCard — registry entry → A2A agent card projection.
 */

import { describe, it, expect } from 'vitest';
import { projectAgentCard } from '../src/agentCard.js';

const FULL_ENTRY = {
  agentId:      'proxy-anne',
  pubKey:       'pub-anne-proxy',
  webid:        'https://anne.pod/profile#me',
  agentUri:     'https://anne.pod/profile#me/agent/proxy',
  role:         'service',
  name:         'my LLM proxy',
  deviceId:     'laptop-anne',
  capabilities: ['tasks'],
  grants: [
    { tokenId: 'tok-1', skill: 'summarize',    expiresAt: '2027-01-01T00:00:00Z', subject: 's-1', capability: 'llm' },
    { tokenId: 'tok-2', skill: 'tasks.create', expiresAt: null,                   subject: 's-2', capability: 'tasks' },
  ],
  signedAt:  '2026-07-01T10:00:00Z',
  revokedAt: null,
};

describe('projectAgentCard — full entry', () => {
  it('maps the A2A standard fields from the entry', () => {
    const card = projectAgentCard(FULL_ENTRY);
    expect(card.name).toBe('my LLM proxy');
    expect(card.url).toBe('https://anne.pod/profile#me/agent/proxy');
    expect(card.version).toBe('1.0');
    expect(card.capabilities).toEqual({
      streaming:              false,
      pushNotifications:      false,
      stateTransitionHistory: false,
    });
    expect(card.authentication).toEqual({ schemes: ['Bearer'] });
    expect(Object.isFrozen(card)).toBe(true);
  });

  it('maps the x-onderling extension (owner defaults to webid; subject not exposed)', () => {
    const card = projectAgentCard(FULL_ENTRY);
    expect(card['x-onderling']).toEqual({
      id:       'proxy-anne',
      pubKey:   'pub-anne-proxy',
      owner:    'https://anne.pod/profile#me',
      role:     'service',
      deviceId: 'laptop-anne',
      grants: [
        { tokenId: 'tok-1', skill: 'summarize',    capability: 'llm',   expiresAt: '2027-01-01T00:00:00Z' },
        { tokenId: 'tok-2', skill: 'tasks.create', capability: 'tasks', expiresAt: null },
      ],
      status:   'active',
      lastSeen: '2026-07-01T10:00:00Z',
      created:  '2026-07-01T10:00:00Z',
    });
  });

  it('an explicit owner option wins over entry.webid', () => {
    const card = projectAgentCard(FULL_ENTRY, { owner: 'did:key:root' });
    expect(card['x-onderling'].owner).toBe('did:key:root');
  });
});

describe('projectAgentCard — skills', () => {
  it('skills = dedup union of grants[].skill + capabilities[], sorted', () => {
    const card = projectAgentCard({
      ...FULL_ENTRY,
      capabilities: ['tasks', 'summarize'],   // 'summarize' also a grant skill → dedup
    });
    expect(card.skills).toEqual([
      { id: 'summarize' },
      { id: 'tasks' },
      { id: 'tasks.create' },
    ]);
  });

  it('skill cards carry no description (valid without — registry has none)', () => {
    const card = projectAgentCard(FULL_ENTRY);
    for (const skill of card.skills) {
      expect(Object.keys(skill)).toEqual(['id']);
    }
  });

  it('ignores grants without a skill (coarse capability still surfaces)', () => {
    const card = projectAgentCard({
      ...FULL_ENTRY,
      capabilities: ['llm'],
      grants: [{ tokenId: 'tok-3', skill: null, expiresAt: null, subject: null, capability: 'llm' }],
    });
    expect(card.skills).toEqual([{ id: 'llm' }]);
  });
});

describe('projectAgentCard — lifecycle + minimal entries', () => {
  it('a revoked entry projects status: revoked', () => {
    const card = projectAgentCard({ ...FULL_ENTRY, revokedAt: '2026-07-08T09:00:00Z' });
    expect(card['x-onderling'].status).toBe('revoked');
  });

  it('a minimal entry projects gracefully (skills: [], name falls back to agentId)', () => {
    const card = projectAgentCard({
      agentId:  'bare-agent',
      pubKey:   'pub-bare',
      agentUri: 'https://anne.pod/profile#me/agent/bare',
    });
    expect(card.name).toBe('bare-agent');
    expect(card.skills).toEqual([]);
    expect(card['x-onderling']).toMatchObject({
      id:     'bare-agent',
      owner:  null,
      grants: [],
      status: 'active',
    });
  });
});

describe('projectAgentCard — invalid input', () => {
  it('throws INVALID_ARGUMENT on a missing / non-object entry', () => {
    for (const bad of [undefined, null, 'not-an-object']) {
      let err;
      try { projectAgentCard(bad); } catch (e) { err = e; }
      expect(err?.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('throws INVALID_ARGUMENT when agentId is missing or empty', () => {
    for (const bad of [{}, { agentId: '' }, { agentId: 42 }]) {
      let err;
      try { projectAgentCard(bad); } catch (e) { err = e; }
      expect(err?.code).toBe('INVALID_ARGUMENT');
    }
  });
});
