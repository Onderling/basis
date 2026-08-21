/**
 * POD-LESS ROSTER PARITY (PLAN-podless-enroll-completeness S4a) — the acceptance walk for the
 * roster level: a device enrolled by phrase + offer, with NO pod anywhere, ends up seeing the
 * SAME circle truth its siblings see, via peers alone.
 *
 * The full corridor, all production gates: B creates a rules-gated circle and raises the rules to
 * v2 (the rules-update rider carries the doc to A) · A joins with a handle, accepting v1 · A adds
 * a second device through the enroll offer + the phrase ceremony · the enrolled boot consumes:
 * the roster SEED from the sibling (device-set verified, id-preserved), then the membership and
 * governance pulls, which now BIND because the seed gave the projection its head.
 *
 * Parity asserted on the new device, as a PERSON reads it:
 *   roles         — the founder shows as admin, the member rows exist;
 *   the fold      — A's rules acceptance ('1') folds from the SIGNED join statement (the
 *                   authoritative branch engages — statements landed and bound);
 *   the rules doc — current version '2' stamps on every row (the governance pull + the
 *                   rules-update apply, pod-free);
 *   the banner    — the member card line for the person's own row reads accepted 1 / current 2 /
 *                   STALE — exactly what their other device shows.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  sendCircleChat, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import {
  makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES, rosterBindingVerifier,
} from '../../src/v2/membershipRail.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';
import { TASK_CATCHUP_SUBTYPES } from '../../src/v2/taskRail.js';
import { CHAT_CATCHUP_SUBTYPES } from '../../src/v2/chatRail.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { applyRulesUpdates } from '../../src/v2/rulesUpdateLane.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../../src/v2/enrollOffer.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'podless-parity-circle';

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
};

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

function wireMembershipCatchUp(node) {
  const cu = makeGovernanceCatchUp({
    rail: node.agent.membershipRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    subtypes: MEMBERSHIP_CATCHUP_SUBTYPES,
  });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    if (st === cu.subtypes.request) { cu.onRequest(env?.from, env.payload); return undefined; }
    if (st === cu.subtypes.batch) { cu.onBatch(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

/** The GOVERNANCE catch-up pair with the rules-update apply hook — the shells' exact shape. */
function wireGovernanceCatchUp(node) {
  const rail = makeGovernanceRail({
    eventLog: node.chatEventLog,
    circleIdentityFor: node.agent.circleIdentityFor,
    myRef: '',
    callSkill: (app, op, args) => node.agent.callSkill(app, op, args),
  });
  const cu = makeGovernanceCatchUp({
    rail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    onChange: (cid) => applyRulesUpdates({
      rail, callSkill: (app, op, args) => node.agent.callSkill(app, op, args), circleId: cid,
    }).catch(() => {}),
  });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    if (st === cu.subtypes.request) { cu.onRequest(env?.from, env.payload); return undefined; }
    if (st === cu.subtypes.batch) { cu.onBatch(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

/**
 * The CONTENT catch-up pairs — the shells' exact wiring shape: the task lane over the agent's
 * rail (serve set = catchUpStatements, so aged-out heads still serve), the chat lane over the
 * node's rail. Returns the instances so the consume's `contentPulls` can aim `requestFrom` at
 * the offer's sibling, exactly as the shells hand it in.
 */
function wireContentCatchUp(node) {
  const taskCU = node.agent.taskRail ? makeFrontierReplay({
    rail: node.agent.taskRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    subtypes: TASK_CATCHUP_SUBTYPES,
    statementsFor: (cid) => node.agent.taskRail.catchUpStatements(cid),
  }) : null;
  const chatCU = makeFrontierReplay({
    rail: node.chatRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    subtypes: CHAT_CATCHUP_SUBTYPES,
  });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    for (const cu of [taskCU, chatCU]) {
      if (!cu) continue;
      if (st === cu.subtypes.request) { Promise.resolve(cu.onRequest(env?.from, env.payload)).catch(() => {}); return undefined; }
      if (st === cu.subtypes.batch) { Promise.resolve(cu.onBatch(env?.from, env.payload)).catch(() => {}); return undefined; }
      if (st === cu.subtypes.offer) { Promise.resolve(cu.onOffer(env?.from, env.payload)).catch(() => {}); return undefined; }
    }
    return inner?.(env);
  };
  return { taskCU, chatCU };
}

describe('pod-less roster parity — the enrolled device sees what its sibling sees', () => {
  let B; let A; let A2; let bus;
  afterAll(async () => { await teardown(B, A, A2); });

  it('roles, the authoritative fold, the rules version, and the stale banner — all on the seeded device', async () => {
    [B, A] = await Promise.all([
      bootRealAgentNode('B', { taskLane: true }),
      bootRealAgentNode('A', {
        taskLane: true,
        agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() },
      }),
    ]);
    bus = await connectNodesOverBus([B, A]);
    for (const n of [B, A]) { wireMembershipReceiver(n); wireMembershipCatchUp(n); wireGovernanceCatchUp(n); wireContentCatchUp(n); }
    await createCircle(B, { groupId: CIRCLE, name: 'Podless parity' });
    const okJoin = await joinExistingCircle(B, A, { groupId: CIRCLE, handle: 'anna' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([B, A], CIRCLE);
    await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    // The join fan predates A's address bind (the known void window) — the reconnect re-fan
    // analogue: B's membership lane hand-carried through A's production ingest gate.
    for (const stmt of B.agent.membershipRail.storedStatements(CIRCLE)) {
      await A.agent.membershipRail.ingest(CIRCLE, stmt);
    }

    // B raises the rules to v2 — the rules-update rider fans the doc; A applies it live.
    const edited = await B.agent.callSkill('stoop', 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'v2: quiet hours', purpose: 'v2: quiet hours', agreements: 'be kind', version: 1 },
    });
    expect(edited.version).toBe(2);
    const aHasV2 = await until(async () => {
      const rows = (await A.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];
      return rows.some((m) => m.rulesCurrentVersion === '2') ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(aHasV2, 'the v2 doc never reached the sibling — the parity source would be stale').toBe(true);

    // The content the new device must INHERIT — a task and a chat message that exist BEFORE the
    // second device does. S3's claim is inheritance through the targeted pulls, not the live fan.
    const preTask = await A.agent.callSkill('tasks', 'addTask', { text: 'water the plants', circleId: CIRCLE });
    expect(preTask?.itemId, JSON.stringify(preTask)).toBeTruthy();
    await sendCircleChat(A, { groupId: CIRCLE, msgId: 'parity-m1', text: 'hoi van anna' });

    // A adds a second device: offer → ceremony → enrolled reboot → consume.
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tablet' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', {
      agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) },
      // No in-process omniscience for the NEW device's chat lane: its binding rides the DERIVED
      // roster only — exactly what a real fresh install holds. (Deferred evaluation: the closure
      // runs at ingest time, after this boot resolves.)
      verifyChatBinding: (q) => rosterBindingVerifier((app, op, args) => A2.agent.callSkill(app, op, args))(q),
    });
    const tx = new InternalTransport(bus, A2.pubKey);
    await A2.agent.sa.addSecureTransport('relay', tx);
    A2._busTransport = tx;
    await bindCircleAddresses([A2], CIRCLE);
    wireMembershipReceiver(A2);
    wireMembershipCatchUp(A2);
    wireGovernanceCatchUp(A2);
    const a2Content = wireContentCatchUp(A2);

    const consumed = await consumeEnrollOffer({
      agent: A2.agent,
      callSkill: (app, op, args) => A2.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => A2.agent.sendPeerMessage(to, payload, opts),
      storage,
      // The shells' shape: the content lanes' requestFrom, aimed at the offer's sibling address.
      contentPulls: (circleId, siblingAddress) => Promise.allSettled([
        a2Content.taskCU?.requestFrom(siblingAddress, circleId),
        a2Content.chatCU?.requestFrom(siblingAddress, circleId),
      ]),
    });
    const report = consumed.circles?.find((c) => c.circleId === CIRCLE);
    expect(report?.ok, JSON.stringify(consumed)).toBe(true);
    expect(report.steps).toContain('roster-derived');

    // ── The parity, as a person reads it ─────────────────────────────────────────────────────
    const rowsOn = async (n) => (await n.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];

    // Roles: the founder is the admin; the person's own row is there.
    const roleParity = await until(async () => {
      const rows = await rowsOn(A2);
      const b = rows.find((m) => m.webid === B.pubKey);
      const self = rows.find((m) => m.webid === A.pubKey);
      return (b?.role === 'admin' && self) ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(roleParity, 'roles never reached parity on the seeded device').toBe(true);

    // The authoritative fold: A's SIGNED acceptance ('1' on the join statement) folds on the
    // seeded device — the statements landed, bound against the seeded rows, and the fold went
    // authoritative.
    const foldParity = await until(async () => {
      const rows = await rowsOn(A2);
      const self = rows.find((m) => m.webid === A.pubKey);
      return self?.rulesAccepted === '1' ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(foldParity, 'the signed acceptance never folded on the seeded device').toBe(true);

    // The rules doc: current version '2' stamps on the seeded device (the governance pull + the
    // rules-update apply — the doc itself travelled peer-to-peer, no pod anywhere).
    const rulesParity = await until(async () => {
      const rows = await rowsOn(A2);
      return rows.some((m) => m.rulesCurrentVersion === '2') ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(rulesParity, 'the rules version never stamped on the seeded device').toBe(true);

    // The banner: the member-card line for the person's own row — accepted 1, current 2, STALE —
    // byte-for-byte what their existing device paints.
    const { normalizeCircleMembers, memberRulesStatus } = await import('@onderling/kring-host/circleMembers');
    void memberRulesStatus;
    const paintedA2 = normalizeCircleMembers({ members: await rowsOn(A2) });
    const paintedA = normalizeCircleMembers({ members: await rowsOn(A) });
    const selfOnA2 = paintedA2.find((m) => m.id === A.pubKey);
    const selfOnA = paintedA.find((m) => m.id === A.pubKey);
    expect(selfOnA2?.rules, 'the banner state on the NEW device').toEqual({ accepted: '1', current: '2', stale: true });
    expect(selfOnA2?.rules, 'both devices paint the SAME banner').toEqual(selfOnA?.rules);

    // ── The CONTENT the person already had, now on the new device (S3) ───────────────────────
    expect(report.steps, 'the circle store opened THIS boot (content merges instead of parking)').toContain('store-open');
    expect(report.steps, 'the targeted content pulls went out').toContain('content');

    // Tasks: the pre-enroll task shows in the enrolled device's own task list — served over the
    // frontier replay, verified at the rail against the seeded roster, merged into the open store.
    const taskParity = await until(async () => {
      const r = await A2.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
      return (Array.isArray(r?.items) ? r.items : []).some((t2) => t2.id === preTask.itemId) ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(taskParity, 'the pre-enroll task never reached the seeded device').toBe(true);

    // Chat: the pre-enroll message landed on the new device's chat lane — its binding rode the
    // DERIVED roster only (no test omniscience on this node), so this is the real fresh-install gate.
    const chatParity = await until(() => A2.chatRail.storedStatements(CIRCLE)
      .some((s) => s?.body?.subject === 'parity-m1' && s?.body?.payload?.text === 'hoi van anna') ? true : null,
    { timeout: 15000, step: 100 });
    expect(chatParity, 'the pre-enroll chat message never landed on the seeded device').toBe(true);
  }, 180_000);
});
