/**
 * J8 — Task-scoped grant, attenuated + revoked ("authority travels with
 * the task"; NOTE-skills-vs-capabilities volley 5;
 * PLAN-cluster-verification-journeys J8).
 *
 * Proves the tasks-v0 app-side wiring of the `TaskGrantManager` primitive:
 *   - `attachTaskGrant` issues an attenuated, task-scoped cap-token for a
 *     member that VERIFIES + PASSES the agent's `PolicyEngine.checkInbound`.
 *   - completing the task REVOKES the grant — the same token no longer passes
 *     checkInbound (bound to task lifetime).
 *   - OFF BY DEFAULT — a task with no `attachTaskGrant` carries no grants.
 *   - the attach gate — only the task CREATOR or a circle ADMIN may attach.
 *   - legibility — the granted tokenId is recorded on the task's `source`.
 *
 * The primitive itself (attenuation floor, revocation-set wiring) is covered
 * in packages/core; this file is the APP composition test.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { DataPart } from '@onderling/core';

import { createTasksAgent } from '../src/Agent.js';

const ANNE = 'https://id.example/anne';
const KID  = 'https://id.example/kid';

// A grantee "member" pubKey — an unknown peer (defaults to tier
// 'authenticated' in the TrustRegistry, which clears the 'authenticated'
// visibility gate on the granted skill). Any stable string works as the token
// subject; the verify path checks issuer signature, not subject key shape.
const BOT_PUBKEY = 'ed25519:prediction-bot-pubkey';

const ROLES = {
  [ANNE]: 'admin',
  [KID]:  'member',
};
const MEMBERS = [
  { webid: ANNE, displayName: 'Anne', role: 'admin' },
  { webid: KID,  displayName: 'Kid',  role: 'member' },
];

let bundle;
beforeEach(async () => {
  bundle = await createTasksAgent({ roles: ROLES, members: MEMBERS });
});

function callSkill(skillId, args, fromWebid) {
  const def = bundle.agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent:    bundle.agent,
    envelope: null,
  });
}

/** Run a token through the agent's PolicyEngine exactly as an inbound call would. */
function checkInbound(token, { peerPubKey, skillId }) {
  return bundle.agent.policyEngine.checkInbound({
    peerPubKey,
    skillId,
    action:      'call',
    token:       token.toJSON(),
    agentPubKey: bundle.agent.pubKey,
  });
}

describe('J8 — task-scoped grant', () => {
  it('wires a TaskGrantManager onto the agent bundle + CircleState', () => {
    expect(bundle.taskGrantManager).toBeTruthy();
    expect(typeof bundle.taskGrantManager.attachGrant).toBe('function');
    expect(typeof bundle.taskGrantManager.revokeTaskGrants).toBe('function');
    // Available to skills via the resolved CircleState (like the itemStore).
    expect(bundle._circleState.taskGrantManager).toBe(bundle.taskGrantManager);
    // registered as a callable skill
    expect(bundle.agent.skills.has('attachTaskGrant')).toBe(true);
  });

  it('a task with no attachTaskGrant carries NO grants (off by default)', async () => {
    const { task } = await callSkill('addTask', { text: 'plain task' }, ANNE);
    expect(bundle.taskGrantManager.tokensForTask(task.id)).toEqual([]);
    expect(task.source?.taskGrants).toBeUndefined();
  });

  it('attachTaskGrant issues a grant that verifies + passes checkInbound; complete revokes it', async () => {
    const { task } = await callSkill('addTask', { text: 'read my agenda' }, ANNE);

    const res = await callSkill('attachTaskGrant', {
      taskId: task.id,
      member: BOT_PUBKEY,
      grant:  { skill: 'listOpen' },
    }, ANNE);
    expect(res.ok).toBe(true);
    expect(res.tokenId).toBeTruthy();
    expect(res.skill).toBe('listOpen');

    // The materialized token verifies + passes the agent's PolicyEngine.
    const [token] = bundle.taskGrantManager.tokensForTask(task.id);
    expect(token).toBeTruthy();
    expect(token.subject).toBe(BOT_PUBKEY);
    expect(token.constraints.task).toBe(task.id);   // stamped for provenance
    const ok = await checkInbound(token, { peerPubKey: BOT_PUBKEY, skillId: 'listOpen' });
    expect(ok.allowed).toBe(true);

    // Legibility — the granted tokenId is recorded on the task's source.
    const open = await bundle.itemStore.listOpen();
    const stored = open.find((t) => t.id === task.id);
    expect(stored.source.taskGrants).toEqual([
      { tokenId: token.id, member: BOT_PUBKEY, skill: 'listOpen' },
    ]);

    // Complete the task → the grant expires WITH the task.
    await callSkill('claimTask', { id: task.id }, ANNE);
    const done = await callSkill('completeTask', { id: task.id }, ANNE);
    expect(done.task).toBeTruthy();

    // The SAME token no longer passes checkInbound (revoked with the task).
    expect(await bundle.taskGrantManager.isRevoked(token.id)).toBe(true);
    const denied = await checkInbound(token, { peerPubKey: BOT_PUBKEY, skillId: 'listOpen' })
      .catch((e) => e);
    expect(denied?.name).toBe('PolicyDeniedError');
    expect(denied?.code).toBe('INVALID_TOKEN');
    expect(denied?.message).toMatch(/revoked/i);
  });

  it('removing/cancelling a task also revokes its grants', async () => {
    const { task } = await callSkill('addTask', { text: 'cancellable' }, ANNE);
    await callSkill('attachTaskGrant', {
      taskId: task.id, member: BOT_PUBKEY, grant: { skill: 'listOpen' },
    }, ANNE);
    const [token] = bundle.taskGrantManager.tokensForTask(task.id);

    await callSkill('removeTask', { id: task.id }, ANNE);   // admin-only hard-delete
    expect(await bundle.taskGrantManager.isRevoked(token.id)).toBe(true);
    const denied = await checkInbound(token, { peerPubKey: BOT_PUBKEY, skillId: 'listOpen' })
      .catch((e) => e);
    expect(denied?.code).toBe('INVALID_TOKEN');
  });

  it('the creator (non-admin) may attach; a non-authorized member may not (gate)', async () => {
    // KID (a plain member) creates their own task → is the creator.
    const { task } = await callSkill('addTask', { text: "kid's task" }, KID);

    // Creator path: KID can attach a grant to a task they created.
    const asCreator = await callSkill('attachTaskGrant', {
      taskId: task.id, member: BOT_PUBKEY, grant: { skill: 'listOpen' },
    }, KID);
    expect(asCreator.ok).toBe(true);

    // A DIFFERENT task, created by ANNE. KID is neither its creator nor admin.
    const { task: annes } = await callSkill('addTask', { text: "anne's task" }, ANNE);
    const denied = await callSkill('attachTaskGrant', {
      taskId: annes.id, member: BOT_PUBKEY, grant: { skill: 'listOpen' },
    }, KID);
    expect(denied.error).toBe('permission-denied');
    // No grant materialized on the denied path.
    expect(bundle.taskGrantManager.tokensForTask(annes.id)).toEqual([]);
  });

  it('validates its args + a missing task', async () => {
    expect((await callSkill('attachTaskGrant', { member: BOT_PUBKEY, grant: { skill: 'x' } }, ANNE)).error).toMatch(/taskId/);
    expect((await callSkill('attachTaskGrant', { taskId: 't', grant: { skill: 'x' } }, ANNE)).error).toMatch(/member/);
    const { task } = await callSkill('addTask', { text: 'g' }, ANNE);
    expect((await callSkill('attachTaskGrant', { taskId: task.id, member: BOT_PUBKEY }, ANNE)).error).toMatch(/grant/);
    expect((await callSkill('attachTaskGrant', { taskId: 'nope', member: BOT_PUBKEY, grant: { skill: 'x' } }, ANNE)).error).toBe('task-not-found');
  });
});
