/**
 * TaskGrant — task-scoped delegation ("authority travels with the task").
 *
 * Covers the primitive:
 *   1. attachGrant issues a task-STAMPED cap-token that CapabilityToken.verify
 *      accepts AND that passes PolicyEngine.checkInbound (no second gate);
 *   2. ATTENUATION — a grant WIDER than the granter's parent token is rejected
 *      (verifyChain narrower-only); a narrower grant is accepted;
 *   3. revoke-on-task-complete — revokeTaskGrants → those tokens fail
 *      checkInbound (issuer-side revocation hook);
 *   4. two tasks are revoked INDEPENDENTLY;
 *   5. OFF BY DEFAULT — nothing is granted without an explicit attachGrant.
 */
import { describe, it, expect } from 'vitest';

import { TaskGrantManager } from '../../src/permissions/TaskGrant.js';
import { CapabilityToken }  from '../../src/permissions/CapabilityToken.js';
import { PolicyEngine }     from '../../src/permissions/PolicyEngine.js';
import { TrustRegistry }    from '../../src/permissions/TrustRegistry.js';
import { SkillRegistry }    from '../../src/skills/SkillRegistry.js';
import { defineSkill }      from '../../src/skills/defineSkill.js';
import { AgentIdentity }    from '../../src/identity/AgentIdentity.js';
import { VaultMemory }      from '@onderling/vault';

const HOUR = 60 * 60 * 1000;

/** The granter (token issuer) — their identity is the authority floor. */
async function makeGranter() {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  return { vault, identity };
}

/**
 * A PolicyEngine wired to verify tokens whose `agentId` == `agentPubKey`, with
 * the issuer marked 'trusted' so a presented token clears the issuer-trust gate.
 */
async function setupPolicy(agentPubKey, issuerPubKey, isRevoked = null) {
  const tr = new TrustRegistry(new VaultMemory());
  const sr = new SkillRegistry();
  // The revocation resolver is CONSTRUCTED in — a PolicyEngine has no setter, so a manager reaches
  // the gate by being read from here, exactly as it does in production.
  const pe = new PolicyEngine({ trustRegistry: tr, skillRegistry: sr, agentPubKey, ...(isRevoked ? { isRevoked } : {}) });
  await tr.setTier(issuerPubKey, 'trusted');
  return { tr, sr, pe };
}

describe('TaskGrantManager.attachGrant — issues a task-scoped, verifiable token', () => {
  it('stamps constraints.task, verifies, and passes PolicyEngine.checkInbound', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    const { sr, pe } = await setupPolicy(
      granter.identity.pubKey, granter.identity.pubKey, (id) => mgr.isRevoked(id),
    );
    // A token-gated skill — proves the task grant is what authorises the call.
    sr.register(defineSkill('predict.run', () => 'ok', {
      visibility: 'authenticated', policy: 'requires-token',
    }));

    const MEMBER = 'assignee-pubkey';

    const token = await mgr.attachGrant({
      taskId: 'task-1', memberPubKey: MEMBER,
      grant: { skill: 'predict.run', constraints: { note: 'prediction bot' } },
    });

    // Task-stamped for provenance + revocation targeting.
    expect(token.subject).toBe(MEMBER);
    expect(token.skill).toBe('predict.run');
    expect(token.agentId).toBe(granter.identity.pubKey);
    expect(token.constraints).toMatchObject({ task: 'task-1', note: 'prediction bot' });
    expect(CapabilityToken.verify(token, granter.identity.pubKey)).toBe(true);

    // Tracked under the taskId.
    expect(mgr.tokensForTask('task-1').map((t) => t.id)).toEqual([token.id]);

    // Passes the real enforcement path — subject == caller, issuer trusted.
    await expect(pe.checkInbound({
      peerPubKey: MEMBER, skillId: 'predict.run', token: token.toJSON(),
    })).resolves.toMatchObject({ allowed: true });
  });
});

describe('TaskGrantManager — attenuation (can only grant what you hold)', () => {
  it('rejects a grant WIDER than the granter parent token (verifyChain)', async () => {
    const granter = await makeGranter();
    const root    = await makeGranter();

    // The granter's OWN authority: a narrow token they hold (skill 'tasks.help').
    const parentToken = await CapabilityToken.issue(root.identity, {
      subject: granter.identity.pubKey,
      agentId: granter.identity.pubKey,
      skill:   'tasks.help',
      expiresIn: 48 * HOUR,
    });

    const mgr = new TaskGrantManager({ identity: granter.identity, parentToken });

    // Narrower-or-equal grant is fine.
    await expect(mgr.attachGrant({
      taskId: 'task-a', memberPubKey: 'm', grant: { skill: 'tasks.help', expiresIn: HOUR },
    })).resolves.toBeInstanceOf(CapabilityToken);

    // A WIDER skill (wildcard) exceeds the parent → rejected.
    await expect(mgr.attachGrant({
      taskId: 'task-a', memberPubKey: 'm', grant: { skill: '*', expiresIn: HOUR },
    })).rejects.toThrow(/attenuation/);

    // A DIFFERENT, non-narrower skill is also rejected.
    await expect(mgr.attachGrant({
      taskId: 'task-a', memberPubKey: 'm', grant: { skill: 'admin.wipe', expiresIn: HOUR },
    })).rejects.toThrow(/attenuation/);

    // Only the one accepted grant is tracked.
    expect(mgr.tokensForTask('task-a')).toHaveLength(1);
  });

  it('a prefix parent attenuates to a narrower exact skill', async () => {
    const granter = await makeGranter();
    const root    = await makeGranter();
    const parentToken = await CapabilityToken.issue(root.identity, {
      subject: granter.identity.pubKey, agentId: granter.identity.pubKey,
      skill: 'pod.*', expiresIn: 48 * HOUR,
    });
    const mgr = new TaskGrantManager({ identity: granter.identity, parentToken });
    const token = await mgr.attachGrant({
      taskId: 't', memberPubKey: 'm', grant: { skill: 'pod.read', pod: '/calendar/', expiresIn: HOUR },
    });
    expect(CapabilityToken.verifyChain([parentToken, token])).toBe(true);
    expect(token.constraints.pod).toBe('/calendar/');
  });
});

describe('TaskGrantManager.revokeTaskGrants — grants expire with the task', () => {
  it('revoked tokens fail checkInbound afterwards', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    const { sr, pe } = await setupPolicy(
      granter.identity.pubKey, granter.identity.pubKey, (id) => mgr.isRevoked(id),
    );
    sr.register(defineSkill('predict.run', () => 'ok', {
      visibility: 'authenticated', policy: 'requires-token',
    }));

    const MEMBER = 'assignee-pk';
    const token = await mgr.attachGrant({
      taskId: 'task-1', memberPubKey: MEMBER, grant: { skill: 'predict.run' },
    });
    const wire = token.toJSON();

    // Before: passes.
    await expect(pe.checkInbound({ peerPubKey: MEMBER, skillId: 'predict.run', token: wire }))
      .resolves.toMatchObject({ allowed: true });

    // Task completes → revoke its grants.
    const { revokedTokenIds } = mgr.revokeTaskGrants('task-1');
    expect(revokedTokenIds).toEqual([token.id]);
    expect(mgr.isRevoked(token.id)).toBe(true);
    expect(mgr.tokensForTask('task-1')).toEqual([]);

    // After: the SAME token no longer passes.
    await expect(pe.checkInbound({ peerPubKey: MEMBER, skillId: 'predict.run', token: wire }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('revokes two tasks independently', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    const { sr, pe } = await setupPolicy(
      granter.identity.pubKey, granter.identity.pubKey, (id) => mgr.isRevoked(id),
    );
    sr.register(defineSkill('predict.run', () => 'ok', {
      visibility: 'authenticated', policy: 'requires-token',
    }));
    const A = 'assignee-a', B = 'assignee-b';

    const tokA = await mgr.attachGrant({ taskId: 'task-A', memberPubKey: A, grant: { skill: 'predict.run' } });
    const tokB = await mgr.attachGrant({ taskId: 'task-B', memberPubKey: B, grant: { skill: 'predict.run' } });

    // Revoke only task-A.
    mgr.revokeTaskGrants('task-A');
    expect(mgr.isRevoked(tokA.id)).toBe(true);
    expect(mgr.isRevoked(tokB.id)).toBe(false);

    // task-A's grant is dead; task-B's still authorises.
    await expect(pe.checkInbound({ peerPubKey: A, skillId: 'predict.run', token: tokA.toJSON() }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(pe.checkInbound({ peerPubKey: B, skillId: 'predict.run', token: tokB.toJSON() }))
      .resolves.toMatchObject({ allowed: true });
  });
});

describe('TaskGrantManager — OFF by default', () => {
  it('grants nothing until attachGrant is explicitly called', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    // No implicit / default grant.
    expect(mgr.tokensForTask('any-task')).toEqual([]);
    expect(mgr.revokeTaskGrants('any-task')).toEqual({ revokedTokenIds: [] });
    expect(mgr.isRevoked('whatever')).toBe(false);
  });

  it('rejects an empty grant (must specify at least one of skill / pod / actingAs)', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    await expect(mgr.attachGrant({ taskId: 't', memberPubKey: 'm', grant: {} }))
      .rejects.toThrow(/at least one of skill \/ pod \/ actingAs/);
  });
});
