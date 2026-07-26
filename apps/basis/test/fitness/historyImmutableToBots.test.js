/**
 * Fitness — HARD INVARIANT 4b: **history is immutable to bots.**
 *
 * `plans/PLAN-agent-management-surface.md` §4b states it as a hard invariant: *"No delegation may EVER grant
 * write/delete on the version-history / edit-log layer. Agents append + merge data; they can never
 * rewrite/erase history. This is what makes recovery trustworthy (a compromised bot can't cover its
 * tracks)."*
 *
 * Audited 2026-07-26. The invariant HOLDS today — but only EMERGENTLY, as a by-product of two facts that
 * nothing was checking:
 *   1. the destructive history op (`restoreDataVersion`) is registered at `visibility: 'trusted'`, and
 *   2. `PolicyEngine.checkInbound` runs the TIER gate BEFORE any token logic, so a capability token never
 *      elevates a caller — not even a wildcard `'*'` one (and `TaskGrantManager` defaults an unspecified
 *      grant to exactly that: `skill: t.skill ?? '*'`).
 * Demote the op to 'authenticated', or reorder the gate so a token can satisfy visibility, and the
 * invariant silently dies with no test failing. This file is that missing failure.
 *
 * Test-only: reads the registration source + drives the real `PolicyEngine`. Changes no code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AgentIdentity, PolicyEngine, TrustRegistry, CapabilityToken, TaskGrantManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

/**
 * The ops that mutate or erase the version-history / edit-log layer. A grant may NEVER cover these.
 * `listDataVersions` is deliberately NOT here — READING history is fine (and is what makes an audit view
 * possible); only rewriting/erasing is forbidden.
 */
const HISTORY_DESTRUCTIVE_OPS = ['restoreDataVersion'];

const realAgentSrc = () => readFileSync(new URL('../../src/core/agent/realAgent.js', import.meta.url), 'utf8');

describe('4b — the history layer is not reachable by delegation', () => {
  it('every destructive history op is registered as OWNER-ONLY (trusted)', () => {
    const src = realAgentSrc();
    const m = src.match(/const TRUSTED_AGENT_OPS = new Set\(\[([^\]]*)\]\)/);
    expect(m, 'TRUSTED_AGENT_OPS set not found — the guard has drifted from the source').toBeTruthy();
    const trusted = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    for (const op of HISTORY_DESTRUCTIVE_OPS) {
      expect(trusted, `${op} must stay owner-only or bots can erase history`).toContain(op);
    }
  });

  it('READING history stays available — the invariant forbids rewriting, not auditing', () => {
    const src = realAgentSrc();
    const m = src.match(/const TRUSTED_AGENT_OPS = new Set\(\[([^\]]*)\]\)/);
    const trusted = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(trusted).not.toContain('listDataVersions');
  });

  it('a WILDCARD capability token does not let a delegated caller reach a trusted op', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const bot = await AgentIdentity.generate(new VaultMemory());
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(bot.pubKey, 'authenticated');     // a delegated bot is NOT 'trusted'

    const engine = new PolicyEngine({
      trustRegistry: trust,
      agentPubKey: owner.pubKey,
      skillRegistry: new Map([['restoreDataVersion', { enabled: true, visibility: 'trusted', policy: 'on-request' }]]),
    });

    // The broadest grant anyone could hand a bot — `TaskGrantManager` mints exactly this when a task
    // grant leaves `skill` unspecified (`t.skill ?? '*'`).
    const wildcard = await CapabilityToken.issue(owner, {
      subject: bot.pubKey, agentId: owner.pubKey, skill: '*',
    });

    // Assert the SPECIFIC denial. A bare `.toThrow()` would also pass on a broken harness — which is
    // exactly how this test first went green while `skillRegistry` was undefined.
    await expect(engine.checkInbound({
      peerPubKey: bot.pubKey, skillId: 'restoreDataVersion', token: wildcard,
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('…and the same bot IS allowed a normal authenticated op, so the refusal is the tier, not the setup', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const bot = await AgentIdentity.generate(new VaultMemory());
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(bot.pubKey, 'authenticated');

    const engine = new PolicyEngine({
      trustRegistry: trust,
      agentPubKey: owner.pubKey,
      skillRegistry: new Map([['listDataVersions', { enabled: true, visibility: 'authenticated', policy: 'on-request' }]]),
    });
    const res = await engine.checkInbound({ peerPubKey: bot.pubKey, skillId: 'listDataVersions' });
    expect(res.allowed).toBe(true);
  });

  it('a pod-only task grant mints a WILDCARD skill — which is why the tier gate has to be load-bearing', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const bot = await AgentIdentity.generate(new VaultMemory());
    const mgr = new TaskGrantManager({ identity: owner, agentId: owner.pubKey });
    // A wholly empty grant is refused outright (good) — but a grant that names only a POD still defaults
    // its SKILL scope to '*', so the wildcard is reachable in normal use.
    await expect(mgr.attachGrant({ taskId: 't0', memberPubKey: bot.pubKey, grant: {} }))
      .rejects.toThrow(/at least one of/);
    const token = await mgr.attachGrant({
      taskId: 't1', memberPubKey: bot.pubKey, grant: { pod: 'https://pod.example/x/' },
    });
    expect(token.skill).toBe('*');
  });
});
