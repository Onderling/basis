/**
 * agents — token-backed control ops through the REAL composition.
 *
 * Proves the realAgent.js binding of the agents-app `tokens` collaborator
 * to the LIVE token machinery (2026-07-09):
 *   - grantAgent through `callSkill('agents', …)` (chatAgent.invoke →
 *     hostAgent wireSkill handler) returns `tokenBacked: true` with a REAL
 *     CapabilityToken id (no `local-` synthetic prefix) — the token is
 *     issued by hostAgent.issueCapabilityToken and stored in the factory's
 *     issuer-side TokenRegistry (exposed as `agentsTokenRegistry`).
 *   - revokeAgent / revokeGrant flip `tokenRegistry.isRevoked(tokenId)`.
 *
 * Op SEMANTICS (mirror ordering, degraded mode, purge) are covered by the
 * apps/agents unit suite — this test stays at the composition level.
 */
import { describe, it, expect } from 'vitest';

import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

/** Boot the real composition and return { a, selfId } (the self-registered device entry). */
async function boot() {
  const a = await createRealHouseholdAgent({ seedHousehold: false });
  const list = await a.callSkill('agents', 'listAgents', {});
  expect(list.items.length).toBeGreaterThanOrEqual(1);
  return { a, selfId: list.items[0].id };
}

describe('agents P2 — token-backed grant/revoke through the real composition', () => {
  it('exposes a live issuer-side TokenRegistry on the handle (no degraded fallback)', async () => {
    const { a } = await boot();
    expect(a.agentsTokenRegistry).toBeTruthy();
    expect(typeof a.agentsTokenRegistry.isRevoked).toBe('function');
  });

  it('grantAgent is tokenBacked with a REAL stored token; revokeAgent flips isRevoked', async () => {
    const { a, selfId } = await boot();

    const granted = await a.callSkill('agents', 'grantAgent', {
      agentId: selfId, skill: 'household.listOpenItems',
    });
    expect(granted.granted).toBe(true);
    expect(granted.tokenBacked).toBe(true);                    // ← the point of the binding
    expect(typeof granted.tokenId).toBe('string');
    expect(granted.tokenId.startsWith('local-')).toBe(false);  // real CapabilityToken id, not synthetic
    // expiresAt is the ISO mirror shape (resource.js nulls non-strings).
    expect(typeof granted.expiresAt).toBe('string');
    expect(Number.isNaN(Date.parse(granted.expiresAt))).toBe(false);
    // Mirror carries the SAME tokenId (token-first, then registry — decision 2).
    expect(granted.agent.grantSummary.tokens.map((t) => t.tokenId)).toContain(granted.tokenId);

    // The stored token is live until revoked…
    expect(await a.agentsTokenRegistry.isRevoked(granted.tokenId)).toBe(false);

    // …and revokeAgent revokes it on the token side (not just the mirror).
    const revoked = await a.callSkill('agents', 'revokeAgent', { agentId: selfId });
    expect(revoked.revoked).toBe(true);
    expect(revoked.tokenBacked).toBe(true);
    expect(revoked.tokensRevoked).toBeGreaterThanOrEqual(1);
    expect(await a.agentsTokenRegistry.isRevoked(granted.tokenId)).toBe(true);
  });

  it('revokeGrant (single-token adjust) flips isRevoked for THAT token only', async () => {
    const { a, selfId } = await boot();

    const g1 = await a.callSkill('agents', 'grantAgent', { agentId: selfId, skill: 'household.listOpenItems' });
    const g2 = await a.callSkill('agents', 'grantAgent', { agentId: selfId, skill: 'household.addItem' });
    expect(g1.tokenBacked).toBe(true);
    expect(g2.tokenBacked).toBe(true);

    const r = await a.callSkill('agents', 'revokeGrant', { agentId: selfId, tokenId: g1.tokenId });
    expect(r.revoked).toBe(true);
    expect(r.tokenBacked).toBe(true);

    expect(await a.agentsTokenRegistry.isRevoked(g1.tokenId)).toBe(true);
    expect(await a.agentsTokenRegistry.isRevoked(g2.tokenId)).toBe(false);
  });
});
