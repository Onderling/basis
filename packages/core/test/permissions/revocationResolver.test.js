/**
 * A PolicyEngine's revocation truth is fixed at CONSTRUCTION, and several sources union into it.
 *
 * ── The defect this closes ───────────────────────────────────────────────────────────────────────
 * The engine used to expose `setRevocationCheck(fn)`, which REPLACED the resolver rather than adding
 * to it. Six independent places called it, so the last one to run silently disarmed every other. That
 * is not a hypothetical: on 2026-08-19 an older call clobbered a newer one and unpairing a connection
 * left it working — the revoked connection's tokens were still admitted, because the list holding
 * that revocation was no longer the list being asked.
 *
 * A guard that says "don't call the setter" would still leave the setter callable. So the setter is
 * GONE: the engine takes one `isRevoked` at construction, and a composer with several sources unions
 * them with `anyRevoked` before handing the engine the single result. The first test below writes the
 * disarming move out literally and asserts it cannot RUN — the violation is unwritable, not merely
 * forbidden.
 *
 * Covered here:
 *   1. the replace-the-resolver move does not exist (and the first source still binds afterwards);
 *   2. TWO sources, each revoking a DIFFERENT token → BOTH revocations bind (the union really unions);
 *   3. deny-wins survives the union — a source that THROWS means revoked, and it means revoked even
 *      when a later source would have said "fine";
 *   4. `anyRevoked`'s own contract: order + short-circuit, null skipped, a non-function is loud at
 *      compose time rather than a silently missing source at verify time.
 *
 * NOT covered, deliberately: `TaskGrantManager`'s revocation set is an in-process Set, so it does not
 * survive a restart. That is real and known, and it is a separate step (moving these sources onto the
 * grants lane) — nothing here pretends otherwise.
 */
import { describe, it, expect } from 'vitest';

import { PolicyEngine, PolicyDeniedError, anyRevoked } from '../../src/permissions/PolicyEngine.js';
import { TaskGrantManager } from '../../src/permissions/TaskGrant.js';
import { CapabilityToken }  from '../../src/permissions/CapabilityToken.js';
import { TrustRegistry }    from '../../src/permissions/TrustRegistry.js';
import { SkillRegistry }    from '../../src/skills/SkillRegistry.js';
import { defineSkill }      from '../../src/skills/defineSkill.js';
import { AgentIdentity }    from '../../src/identity/AgentIdentity.js';
import { VaultMemory }      from '@onderling/vault';

const SKILL = 'predict.run';

/** An issuer identity + a skill registry holding one token-gated skill. */
async function makeIssuer() {
  return AgentIdentity.generate(new VaultMemory());
}

/**
 * Build the gate the way production does: sources first, then ONE engine over their union.
 * @param {object} a
 * @param {import('../../src/identity/AgentIdentity.js').AgentIdentity} a.issuer
 * @param {Array<((tokenId: string) => boolean | Promise<boolean>) | null>} a.sources
 */
async function makeGate({ issuer, sources }) {
  const tr = new TrustRegistry(new VaultMemory());
  const sr = new SkillRegistry();
  sr.register(defineSkill(SKILL, () => 'ok', { visibility: 'authenticated', policy: 'requires-token' }));
  await tr.setTier(issuer.pubKey, 'trusted');   // a PRESENTED token's issuer must be trusted
  const pe = new PolicyEngine({
    trustRegistry: tr,
    skillRegistry: sr,
    agentPubKey:   issuer.pubKey,
    isRevoked:     anyRevoked(sources),
  });
  return { tr, sr, pe };
}

/** Issue a token for `subject` that the gate above will accept while it is live. */
async function issueFor(issuer, subject) {
  return CapabilityToken.issue(issuer, {
    subject, agentId: issuer.pubKey, skill: SKILL, expiresIn: 60_000,
  });
}

const present = (pe, subject, token) =>
  pe.checkInbound({ peerPubKey: subject, skillId: SKILL, token: token.toJSON() });

// ── 1. The violation is unwritable ───────────────────────────────────────────────────────────────

describe('a second registration cannot disarm the first — because there is nothing to register with', () => {
  it('the disarming move does not RUN, and the source it would have replaced still binds', async () => {
    const issuer = await makeIssuer();
    const revoked = new Set();
    const { pe } = await makeGate({ issuer, sources: [(id) => revoked.has(id)] });

    const token = await issueFor(issuer, 'holder-pk');
    await expect(present(pe, 'holder-pk', token)).resolves.toMatchObject({ allowed: true });
    revoked.add(token.id);

    // THE 2026-08-19 DEFECT, WRITTEN OUT LITERALLY. Under the old API this line succeeded and the
    // engine forgot `revoked` entirely — the token below was then admitted. It is not that this is
    // now disallowed: the method it calls does not exist, so the statement cannot execute at all.
    expect(() => pe.setRevocationCheck(() => false)).toThrow(TypeError);

    // Nor under any other name: nothing on the engine offers to replace its revocation resolver.
    const surface = [
      ...Object.getOwnPropertyNames(PolicyEngine.prototype),
      ...Object.getOwnPropertyNames(pe),
    ];
    expect(surface.filter((k) => /revo/i.test(k))).toEqual([]);

    // And the source the disarming call was aimed at is still the one that answers.
    await expect(present(pe, 'holder-pk', token)).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(present(pe, 'holder-pk', token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('a SECOND composed engine cannot reach into the first — each owns its own resolver', async () => {
    const issuer = await makeIssuer();
    const revoked = new Set();
    const { pe: guarded }  = await makeGate({ issuer, sources: [(id) => revoked.has(id)] });
    // The shape that used to do the damage: something else builds a gate and wires its own truth.
    const { pe: unguarded } = await makeGate({ issuer, sources: [() => false] });

    const token = await issueFor(issuer, 'holder-pk');
    revoked.add(token.id);

    // The permissive engine admits it (it was told nothing is revoked) — and cannot make the
    // guarded one agree. Two gates, two answers, no crosstalk.
    await expect(present(unguarded, 'holder-pk', token)).resolves.toMatchObject({ allowed: true });
    await expect(present(guarded,   'holder-pk', token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

// ── 2. The union actually unions ─────────────────────────────────────────────────────────────────

describe('two sources, two different revocations — BOTH bind', () => {
  it('each source revokes its own token and neither cancels the other', async () => {
    const issuer = await makeIssuer();
    // Two REAL sources of the kind the composers hold: independent managers, each with its own set.
    const taskGrants = new TaskGrantManager({ identity: issuer });
    const botTokens  = new Set();

    const { pe } = await makeGate({
      issuer,
      sources: [
        (id) => taskGrants.isRevoked(id),
        (id) => botTokens.has(id),
      ],
    });

    // One token per source, plus one nobody revokes (the control — a union that revoked everything
    // would pass every other assertion here).
    const fromTask = await taskGrants.attachGrant({
      taskId: 'task-1', memberPubKey: 'assignee-pk', grant: { skill: SKILL },
    });
    const fromBot  = await issueFor(issuer, 'bot-pk');
    const untouched = await issueFor(issuer, 'other-pk');

    await expect(present(pe, 'assignee-pk', fromTask)).resolves.toMatchObject({ allowed: true });
    await expect(present(pe, 'bot-pk',      fromBot)).resolves.toMatchObject({ allowed: true });

    // Revoke through EACH source independently.
    await taskGrants.revokeTaskGrants('task-1');
    botTokens.add(fromBot.id);

    await expect(present(pe, 'assignee-pk', fromTask)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(present(pe, 'bot-pk',      fromBot)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    // …and the union is not a blanket deny.
    await expect(present(pe, 'other-pk',    untouched)).resolves.toMatchObject({ allowed: true });
  });

  it('a source added LATE is asked too — the composer passes a thunk, not a snapshot', async () => {
    const issuer = await makeIssuer();
    // The real shape in tasks-v0/basis: the source is built after the engine, so the engine holds a
    // thunk that reads the variable when the check runs. This is what replaced "push it in later".
    let lateSource = null;
    const { pe } = await makeGate({ issuer, sources: [(id) => Boolean(lateSource?.isRevoked(id))] });

    const token = await issueFor(issuer, 'holder-pk');
    await expect(present(pe, 'holder-pk', token)).resolves.toMatchObject({ allowed: true });

    lateSource = new TaskGrantManager({ identity: issuer });
    const grant = await lateSource.attachGrant({
      taskId: 't', memberPubKey: 'holder-pk', grant: { skill: SKILL },
    });
    await lateSource.revokeTaskGrants('t');

    await expect(present(pe, 'holder-pk', grant)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

// ── 3. Deny-wins survives the union ──────────────────────────────────────────────────────────────

describe('deny-wins: a revocation source that throws means REVOKED', () => {
  it('a single throwing source denies, and says the check failed', async () => {
    const issuer = await makeIssuer();
    const { pe } = await makeGate({
      issuer,
      sources: [() => { throw new Error('vault down'); }],
    });
    const token = await issueFor(issuer, 'holder-pk');
    await expect(present(pe, 'holder-pk', token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(present(pe, 'holder-pk', token)).rejects.toThrow(/vault down/);
  });

  it('a throwing source is not rescued by a later source that would have allowed', async () => {
    const issuer = await makeIssuer();
    const { pe } = await makeGate({
      issuer,
      sources: [
        async () => { throw new Error('grants lane unreachable'); },
        () => false,          // would have admitted — must not get the chance to
      ],
    });
    const token = await issueFor(issuer, 'holder-pk');
    await expect(present(pe, 'holder-pk', token)).rejects.toThrow(/grants lane unreachable/);
  });
});

// ── 4. anyRevoked's own contract ─────────────────────────────────────────────────────────────────

describe('anyRevoked', () => {
  it('asks sources in order and stops at the first truthy answer', async () => {
    const asked = [];
    const resolver = anyRevoked([
      (id) => { asked.push('a'); return id === 'x'; },
      (id) => { asked.push('b'); return false; },
    ]);
    expect(await resolver('x')).toBe(true);
    expect(asked).toEqual(['a']);           // short-circuited — 'b' was never asked
    asked.length = 0;
    expect(await resolver('y')).toBe(false);
    expect(asked).toEqual(['a', 'b']);      // no source said yes, so every one was asked
  });

  it('awaits async sources rather than truthy-testing the promise', async () => {
    // Boolean(promise) is true for every token — the bug that made an async source deny everything.
    expect(await anyRevoked([async () => false])('any')).toBe(false);
    expect(await anyRevoked([async () => true])('any')).toBe(true);
  });

  it('skips null/undefined sources (a conditional source) but not a nonsense one', () => {
    expect(() => anyRevoked([null, undefined])).not.toThrow();
    // A non-function is a mistake, and it is loud HERE — at compose time — rather than a source that
    // quietly is not consulted at verify time.
    expect(() => anyRevoked([{ isRevoked: () => true }])).toThrow(TypeError);
    expect(() => anyRevoked('not-an-array')).toThrow(TypeError);
  });

  it('with no sources it answers "not revoked" — an empty union is empty, not a blanket deny', async () => {
    expect(await anyRevoked([])('anything')).toBe(false);
  });
});
