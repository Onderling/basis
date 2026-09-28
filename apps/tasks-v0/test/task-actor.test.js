/**
 * `actor` — who a call is on behalf of, vouched for by the tasks engine's HOST.
 *
 * A host (for example a household bot) serves several people through one key. Its calls carry that key as
 * the authority (`from` → `addedBy` / `master` / the role gates, unchanged), and may name the person they
 * are for in `args.actor` (a contact id such as `telegram:123`). The engine honours `actor` ONLY when the
 * invoking peer IS its host. From any other peer the argument is refused with a reason — never silently
 * dropped — because otherwise a peer could attribute its writes to anyone. Being an admin of the circle
 * is not being its host: the host is the one key the composer declared.
 *
 * What `actor` changes:
 *   - `addTask` stamps it on the item (`task.actor`); the authority fields stay the host's key.
 *   - `claimTask` puts the actor into the co-owner set (the host's key passes the claim gate).
 *   - `listMine` asks "assigned to whom?" for the actor instead of the invoking key.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DataPart } from '@onderling/core';

import { createTasksAgent } from '../src/index.js';
import { createTasksService } from '../src/Service.js';
import { singleCircleResolver } from '../src/bundleResolver.js';
import { ACTOR_REFUSED } from '../src/skills/actor.js';

const HOST  = 'https://id.example/host';     // the key the composer declared as host (and an admin)
const ADMIN = 'https://id.example/admin2';   // a second admin — NOT the host
const KID   = 'https://id.example/kid';      // a plain member

const ANN = 'telegram:111';
const BO  = 'telegram:222';

const ROLES = { [HOST]: 'admin', [ADMIN]: 'admin', [KID]: 'member' };
const MEMBERS = [
  { webid: HOST,  displayName: 'Host',  role: 'admin' },
  { webid: ADMIN, displayName: 'Admin', role: 'admin' },
  { webid: KID,   displayName: 'Kid',   role: 'member' },
];

async function call(agent, skillId, args, from) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

let bundle;
beforeEach(async () => {
  bundle = await createTasksAgent({ roles: ROLES, members: MEMBERS, hostKey: HOST });
});

describe('actor from a peer that is not the host is refused, with a reason', () => {
  it('a member naming an actor on addTask is refused and nothing is written', async () => {
    const r = await call(bundle.agent, 'addTask', { text: 'bins out', actor: ANN }, KID);
    expect(r.error).toBe(ACTOR_REFUSED);
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
    const open = await call(bundle.agent, 'listOpen', {}, KID);
    expect(open.items).toHaveLength(0);
  });

  it('an ADMIN that is not the host is refused too — admin is not host', async () => {
    const r = await call(bundle.agent, 'addTask', { text: 'bins out', actor: ANN }, ADMIN);
    expect(r.error).toBe(ACTOR_REFUSED);
  });

  it('listMine and claimTask refuse it the same way', async () => {
    const t = await call(bundle.agent, 'addTask', { text: 'dishes' }, HOST);
    expect((await call(bundle.agent, 'listMine', { actor: ANN }, KID)).error).toBe(ACTOR_REFUSED);
    expect((await call(bundle.agent, 'claimTask', { id: t.task.id, actor: ANN }, KID)).error).toBe(ACTOR_REFUSED);
    // …and the refused claim changed nothing
    const open = await call(bundle.agent, 'listOpen', {}, HOST);
    expect(open.items[0].assignees ?? []).toEqual([]);
  });

  it('a skill that does not use actor still refuses it from a non-host (never silently dropped)', async () => {
    const r = await call(bundle.agent, 'listMyMasteredTasks', { actor: ANN }, KID);
    expect(r.error).toBe(ACTOR_REFUSED);
  });

  it('the local service route refuses it the same way', async () => {
    const service = createTasksService({ bundleResolver: singleCircleResolver(bundle._circleState) });
    const viaCore = await service.callSkill('addTask', { text: 'x', actor: ANN }, { from: KID });
    expect(viaCore.error).toBe(ACTOR_REFUSED);
    const viaHandler = await service.callSkill('listClaimConflicts', { actor: ANN }, { from: KID });
    expect(viaHandler.error).toBe(ACTOR_REFUSED);
  });
});

describe('actor from the host is accepted and lands on the item', () => {
  it('addTask carries actor; the authority fields stay the host key', async () => {
    const r = await call(bundle.agent, 'addTask', { text: 'bins out', actor: ANN }, HOST);
    expect(r.error).toBeUndefined();
    expect(r.task.actor).toBe(ANN);
    expect(r.task.addedBy).toBe(HOST);
    expect(r.task.master).toBe(HOST);
    const open = await call(bundle.agent, 'listOpen', {}, HOST);
    expect(open.items[0].actor).toBe(ANN);
  });

  it('an actor that is not a non-empty string is refused, even from the host', async () => {
    expect((await call(bundle.agent, 'addTask', { text: 'x', actor: 42 }, HOST)).error).toBe(ACTOR_REFUSED);
    expect((await call(bundle.agent, 'addTask', { text: 'x', actor: '' }, HOST)).error).toBe(ACTOR_REFUSED);
  });

  it('a claim on behalf of Ann makes Ann the assignee; listMine reads the actor', async () => {
    const t = await call(bundle.agent, 'addTask', { text: 'dishes', actor: ANN }, HOST);
    const c = await call(bundle.agent, 'claimTask', { id: t.task.id, actor: ANN }, HOST);
    expect(c.result.assignees).toEqual([ANN]);
    expect(c.result.assignee).toBe(ANN);
    expect(c.result.confirmedAssignee).toBe(ANN);

    const annMine = await call(bundle.agent, 'listMine', { actor: ANN }, HOST);
    expect(annMine.items.map((i) => i.id)).toEqual([t.task.id]);
    const boMine = await call(bundle.agent, 'listMine', { actor: BO }, HOST);
    expect(boMine.items).toHaveLength(0);
    // the host's OWN list is its own: Ann's task is not in it
    const hostMine = await call(bundle.agent, 'listMine', {}, HOST);
    expect(hostMine.items).toHaveLength(0);
  });

  it('Bo claiming the task Ann already holds gets already-claimed (the fold compares people, not the host key)', async () => {
    const t = await call(bundle.agent, 'addTask', { text: 'dishes' }, HOST);
    await call(bundle.agent, 'claimTask', { id: t.task.id, actor: ANN }, HOST);
    const c = await call(bundle.agent, 'claimTask', { id: t.task.id, actor: BO }, HOST);
    expect(c.result.error).toBe('already-claimed');
  });

  it('the local service route honours it the same way', async () => {
    const service = createTasksService({ bundleResolver: singleCircleResolver(bundle._circleState) });
    const r = await service.callSkill('addTask', { text: 'x', actor: ANN }, { from: HOST });
    expect(r.task.actor).toBe(ANN);
  });
});

describe('the host defaults to the engine’s own key', () => {
  it('without a declared host, only the agent’s own key may name an actor', async () => {
    const own = await createTasksAgent({ roles: ROLES, members: MEMBERS });
    const self = own.agent.pubKey;
    expect(own._circleState.hostKey).toBe(self);
    expect((await call(own.agent, 'addTask', { text: 'x', actor: ANN }, HOST)).error).toBe(ACTOR_REFUSED);
  });
});
