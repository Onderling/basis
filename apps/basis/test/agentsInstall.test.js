/**
 * agents — INSTALL through the REAL composition.
 *
 * Proves realAgent.js wires the install surface end-to-end:
 *   - `callSkill('agents', 'listCatalogue')` returns the default stub
 *     catalogue source's installable cards (the pluggable source is wired).
 *   - `callSkill('agents', 'installAgent', { catalogueId, grants })` installs
 *     a curated card into the user's registry with a REAL token-backed
 *     grant — and ONLY the granted skill (capability-security through the
 *     live composition, not just the unit cores).
 *   - the power-user override installs a NON-catalogue card (pasted JSON).
 *   - an undeclared grant is REJECTED (never issued a token).
 *   uninstall reuses purge (the installed agent is gone).
 *
 * Op SEMANTICS + the PolicyEngine anti-virus proof live in the apps/agents
 * unit suite (install.test.js); this stays at the composition level.
 */
import { describe, it, expect } from 'vitest';

import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const OVERRIDE_CARD = {
  name: 'Sideloaded', url: 'https://third-party.invalid/agent', version: '1.0',
  skills: [{ id: 'sideload.run' }],
  'x-onderling': { id: 'override:sideloaded', pubKey: 'pub-override-sideloaded', role: 'service' },
};

describe('agents P3 — install through the real composition', () => {
  it('listCatalogue returns the wired default (stub) catalogue source', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });
    const cat = await a.callSkill('agents', 'listCatalogue', {});
    expect(cat.ok).toBe(true);
    expect(cat.count).toBeGreaterThanOrEqual(1);
    expect(cat.items.every((i) => typeof i.id === 'string')).toBe(true);
  });

  it('installs a curated card token-backed, granting ONLY the requested skill', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });
    const cat = await a.callSkill('agents', 'listCatalogue', {});
    const entry = cat.catalogue[0];
    // Grant only the FIRST declared skill of the chosen card.
    const grantSkill = entry.skills[0];

    const res = await a.callSkill('agents', 'installAgent', {
      catalogueId: entry.id,
      grants:    JSON.stringify([grantSkill]),
    });
    expect(res.ok).toBe(true);
    expect(res.installed).toBe(true);
    expect(res.source).toBe('catalogue');
    expect(res.tokenBacked).toBe(true);                       // real issuer-side token
    expect(res.granted.map((g) => g.skill)).toEqual([grantSkill]);
    expect(res.granted[0].tokenId.startsWith('local-')).toBe(false);

    // It is now in the roster, with ONLY the granted skill (default-deny).
    const view = await a.callSkill('agents', 'viewAgent', { agentId: entry.id });
    expect(view.skills).toEqual([grantSkill]);
    // The issuer-side TokenRegistry holds the live grant token.
    expect(await a.agentsTokenRegistry.isRevoked(res.granted[0].tokenId)).toBe(false);
  });

  it('power-user override installs a non-catalogue card; undeclared grants are rejected', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });

    const res = await a.callSkill('agents', 'installAgent', {
      card:   JSON.stringify(OVERRIDE_CARD),
      grants: JSON.stringify(['sideload.run', 'evil.exfiltrate']),   // 2nd undeclared
    });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('override');
    expect(res.granted.map((g) => g.skill)).toEqual(['sideload.run']);
    expect(res.rejected).toEqual([{ skill: 'evil.exfiltrate', reason: 'not-declared' }]);

    // Uninstall reuses purge — the installed agent is gone.
    const purged = await a.callSkill('agents', 'purgeAgent', { agentId: 'override:sideloaded' });
    expect(purged.purged).toBe(true);
    const view = await a.callSkill('agents', 'viewAgent', { agentId: 'override:sideloaded' });
    expect(view.ok).toBe(false);   // soft miss (no such agent)
  });
});
