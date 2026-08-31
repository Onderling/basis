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
import { describe, it, expect, vi } from 'vitest';

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
    const { revokedTokenIds } = await mgr.revokeTaskGrants('task-1');
    expect(revokedTokenIds).toEqual([token.id]);
    expect(await mgr.isRevoked(token.id)).toBe(true);
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
    await mgr.revokeTaskGrants('task-A');
    expect(await mgr.isRevoked(tokA.id)).toBe(true);
    expect(await mgr.isRevoked(tokB.id)).toBe(false);

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
    expect(await mgr.revokeTaskGrants('any-task')).toEqual({ revokedTokenIds: [] });
    expect(await mgr.isRevoked('whatever')).toBe(false);
  });

  it('rejects an empty grant (must specify at least one of skill / pod / actingAs)', async () => {
    const granter = await makeGranter();
    const mgr = new TaskGrantManager({ identity: granter.identity });
    await expect(mgr.attachGrant({ taskId: 't', memberPubKey: 'm', grant: {} }))
      .rejects.toThrow(/at least one of skill \/ pod \/ actingAs/);
  });
});

describe('TaskGrantManager — a revocation must outlive the process', () => {
  /**
   * The defect this closes: `#revoked` was a plain in-process Set, so a revoked task grant came back
   * to life on restart while the token itself stayed signed and unexpired — the issuer re-admitted a
   * holder it had already cut off, until TTL. `RoleGrantManager` had taken a `{get,set}` store since
   * it was written; this class had not, and its own header called the bare Set "the single revocation
   * enforcement point".
   *
   * A restart is modelled the only honest way: build a SECOND manager over the same store and ask it.
   * Asserting against the first instance would prove nothing about durability.
   */
  const memStore = () => {
    const m = new Map();
    return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), _m: m };
  };

  it('a revoked grant is still revoked after a restart', async () => {
    const store = memStore();
    const identity = await AgentIdentity.generate(new VaultMemory());

    const before = new TaskGrantManager({ identity, store });
    const token = await before.attachGrant({
      taskId: 'task-1', memberPubKey: 'member-pub', grant: { skill: 'echo' },
    });
    await before.revokeTaskGrants('task-1');
    expect(await before.isRevoked(token.id)).toBe(true);

    // The restart.
    const after = new TaskGrantManager({ identity, store });
    await after.whenReady();
    expect(await after.isRevoked(token.id)).toBe(true);
  });

  it('a LIVE grant also survives, so a later revoke can still find its tokens', async () => {
    // Persisting only the revocation set would leave a restarted manager unable to revoke: the
    // task→tokens index it needs would be empty, and `revokeTaskGrants` would revoke nothing while
    // reporting success.
    const store = memStore();
    const identity = await AgentIdentity.generate(new VaultMemory());

    const before = new TaskGrantManager({ identity, store });
    const token = await before.attachGrant({
      taskId: 'task-2', memberPubKey: 'member-pub', grant: { skill: 'echo' },
    });

    const after = new TaskGrantManager({ identity, store });
    await after.whenReady();
    expect(after.tokensForTask('task-2').map((t) => t.id)).toEqual([token.id]);

    const { revokedTokenIds } = await after.revokeTaskGrants('task-2');
    expect(revokedTokenIds).toEqual([token.id]);
    expect(await after.isRevoked(token.id)).toBe(true);
  });

  it('without a store it still works, and says out loud that revocations are not durable', async () => {
    // Degrading quietly is what made this defect survive: nothing looked different.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const identity = await AgentIdentity.generate(new VaultMemory());
    const mgr = new TaskGrantManager({ identity });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MEMORY-ONLY|not survive a restart/));
    const token = await mgr.attachGrant({ taskId: 't', memberPubKey: 'm', grant: { skill: 'echo' } });
    await mgr.revokeTaskGrants('t');
    expect(await mgr.isRevoked(token.id)).toBe(true);      // still correct in-process
    warn.mockRestore();
  });

  it('the onRevoked appender port is handed every revoked token, id and subject', async () => {
    // The cross-device half rides this port: the host appends these ids to its grants lane.
    const identity = await AgentIdentity.generate(new VaultMemory());
    const seen = [];
    const mgr = new TaskGrantManager({ identity, store: memStore(), onRevoked: (r) => { seen.push(r); } });

    const token = await mgr.attachGrant({ taskId: 't-port', memberPubKey: 'member-pub', grant: { skill: 'echo' } });
    await mgr.revokeTaskGrants('t-port');

    expect(seen).toEqual([{ taskId: 't-port', tokens: [{ id: token.id, subject: 'member-pub' }] }]);
    // A task with nothing to revoke does not fire the port — no empty statements on any lane.
    await mgr.revokeTaskGrants('t-empty');
    expect(seen.length).toBe(1);
  });

  it('a throwing appender does not fail the revoke — it binds locally and complains out loud', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const identity = await AgentIdentity.generate(new VaultMemory());
    const mgr = new TaskGrantManager({
      identity, store: memStore(),
      onRevoked: () => { throw new Error('lane unreachable'); },
    });
    const token = await mgr.attachGrant({ taskId: 't-throw', memberPubKey: 'm', grant: { skill: 'echo' } });

    const { revokedTokenIds } = await mgr.revokeTaskGrants('t-throw');
    expect(revokedTokenIds).toEqual([token.id]);
    expect(await mgr.isRevoked(token.id)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/onRevoked appender failed/));
    warn.mockRestore();
  });

  it('a check racing the load answers from the persisted set, not an empty one', async () => {
    // The boot window: the engine can be asked about a token BEFORE the store's read resolves.
    // `isRevoked` awaits hydration internally (the closure `RoleGrantManager` already had), so the
    // caller needs no `whenReady` discipline for correctness — the answer is simply late, not wrong.
    const identity = await AgentIdentity.generate(new VaultMemory());

    const seed = new TaskGrantManager({ identity, store: memStore() });
    const token = await seed.attachGrant({ taskId: 't-race', memberPubKey: 'm', grant: { skill: 'echo' } });
    await seed.revokeTaskGrants('t-race');

    // A store whose read only resolves when WE let it — the racing check must wait on it.
    const persisted = JSON.stringify({ revoked: [token.id], grants: [] });
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowStore = {
      get: async () => { await gate; return persisted; },
      set: async () => {},
    };

    const mgr = new TaskGrantManager({ identity, store: slowStore });
    const racing = mgr.isRevoked(token.id);   // asked before the load resolved — no whenReady
    release();
    expect(await racing).toBe(true);
  });

  it('a corrupt blob starts empty rather than throwing at construction', async () => {
    const store = memStore();
    store._m.set('task-grants', '{not json');
    const identity = await AgentIdentity.generate(new VaultMemory());

    const mgr = new TaskGrantManager({ identity, store });
    await expect(mgr.whenReady()).resolves.toBeUndefined();
    expect(await mgr.isRevoked('anything')).toBe(false);
  });
});
