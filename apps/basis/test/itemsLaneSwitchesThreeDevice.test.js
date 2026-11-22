/**
 * A CIRCLE'S SWITCHES BIND ON EVERY MEMBER'S DEVICE: the items lane, three devices and a fourth that joins, adversarial.
 *
 * Over REAL agents on one in-process bus (`pairRealAgents.js`): each node is `createRealHouseholdAgent` with its device
 * log handed in as the shells hand theirs (the items rail and its judge, the governance rail and the policy-update
 * emitter are the agent's own), the receive handlers and catch-ups registered as the lane table registers them, and the
 * settings lane composed as the three shells compose it (`settingsLane`: `makeCirclePolicyLane` over a policy store,
 * the roster through the waist, handed its governance rail at boot, applied on every landed governance statement).
 *
 * Cast: Anna (A, admin, changes the settings) · Bram (B, an honest member) · Cato (C, the CHANGED sender: its app skips
 * the sender's gate and writes straight into its store, which the lane signs and fans) · Dirk (D, joins afterwards).
 *
 * What must hold:
 *   - a row Cato made while adding was on stays everywhere after the switch-off (it does not reach back);
 *   - a row Cato made while the switch-off was under way (racing it) is refused on Anna's and Bram's devices and taken
 *     back on Cato's own;
 *   - a row Cato BACKDATES (its links point at statements from before the switch-off) is refused everywhere;
 *   - all three end with the same rows;
 *   - Dirk, joining after the switch-off, gets the existing rows of the type whose ADD is off, also when every lane
 *     statement has aged out and the rows reach him as heads served in answer to his own ask.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { signSpine, InternalTransport } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
  sendInCircle, goOffline, goOnline,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { keptPolicyChangesOf } from '../src/v2/keptPolicyChanges.js';
import { ITEMS_BROADCAST } from '../src/v2/itemsRail.js';

const CIRCLE = 'switches-three';
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const WARM = { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] };
const callOf = (n) => (app, op, args) => n.agent.callSkill(app, op, args);

function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return undefined; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}
const storeOf = (n) => n.agent.circleStoreFor(CIRCLE);
const rowsOf = async (n) => ((await storeOf(n).list()) ?? []).filter((r) => r?.type === 'task').map((r) => `${r.id}|${r.text}`).sort();
const hasText = async (n, text) => (await rowsOf(n)).some((r) => r.endsWith(`|${text}`));
const keptVersions = (n) => (keptPolicyChangesOf(n.deviceLog, CIRCLE) ?? []).map((b) => b.payload?.version).sort();
const waitFor = (pred, label, timeout = 20_000) => until(async () => ((await pred()) ? true : null), { timeout, step: 100 }).then((r) => { expect(r, label).toBe(true); });

/** Cato's changed app: no sender gate, a write straight into the circle's store (the lane signs and fans it). */
async function catoWrites(C, text) {
  const id = `task-${text.replace(/\W+/g, '-')}`;
  await storeOf(C).put({ id, type: 'task', text }, { by: 'cato' });
  return id;
}

describe('the items lane: a changed sender, three devices that end equal, and a joiner', () => {
  let A; let B; let C; let D; let bus;
  afterAll(async () => { await teardown(A, B, C, D); });

  it('the switch-off binds on every device, the author\'s own included; a joiner gets the existing rows', async () => {
    const opts = { itemsLane: true, settingsLane: true };
    [A, B, C] = await Promise.all([bootRealAgentNode('A', opts), bootRealAgentNode('B', opts), bootRealAgentNode('C', opts)]);
    // the harness is composed as a shell: one device log, the settings lane handed its rail, the agent's own items rail
    for (const n of [A, B, C]) {
      expect(n.deviceLog, `${n.label}: a device log`).toBeTruthy();
      expect(n.chatEventLog, `${n.label}: the receive rails land on that same log`).toBe(n.deviceLog);
      expect(n.settings?.lane, `${n.label}: the settings lane`).toBeTruthy();
      expect(n.settings.govRail.deviceLog, `${n.label}: the lane's rail is on the device log`).toBe(n.deviceLog);
      expect(n.agent.itemsRail.deviceLog, `${n.label}: the items rail judges by the same log`).toBe(n.deviceLog);
    }
    bus = await connectNodesOverBus([A, B, C]);
    for (const n of [A, B, C]) wireInboundLikeShell(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Schakelaars' });
    for (const [joiner, handle] of [[B, 'bram'], [C, 'cato']]) {
      const r = await joinExistingCircle(A, joiner, { groupId: CIRCLE, handle });
      expect(r.joined?.ok, JSON.stringify(r.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, C], CIRCLE);
    await Promise.all([A, B, C].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    for (const [from, to] of [[A, B], [A, C], [C, B], [C, A], [B, C]]) {
      await sendInCircle(from, to, CIRCLE, { type: 'p2p-chat', subtype: 'chat-message', msgId: `warm-${from.label}${to.label}`, body: `warm ${from.label}` }, WARM);
      await until(() => to.received.find((m) => m.payload?.body === `warm ${from.label}`), { timeout: 8000 });
    }
    for (const n of [A, B, C]) await n.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });   // each opens the circle

    // ── the creation settings: version 1, stated by the admin, applied on every device ──────────────────────────────
    expect(await A.settings.lane.state(CIRCLE), 'the admin states the creation settings').toBeTruthy();
    for (const n of [A, B, C]) await waitFor(() => keptVersions(n).join() === '1', `${n.label} keeps version 1`);

    // ── a row made while adding is on ─────────────────────────────────────────────────────────────────────────────────
    const oldId = await catoWrites(C, 'made while adding was on');
    for (const n of [A, B]) await waitFor(() => hasText(n, 'made while adding was on'), `${n.label} holds the old row`);

    // ── the race: Cato is away while Anna switches adding off, and writes in that window ──────────────────────────────
    await goOffline(C);
    await A.settings.policies.update(CIRCLE, ADD_OFF);
    expect(await A.settings.lane.state(CIRCLE), 'the admin states the switch-off').toBeTruthy();
    await waitFor(() => keptVersions(B).join() === '1,2', 'B keeps version 2');
    await waitFor(() => keptVersions(A).join() === '1,2', 'A, the admin, judges by its own change too');
    const racedId = await catoWrites(C, 'raced the switch-off');
    expect(await hasText(C, 'raced the switch-off'), 'Cato\'s app wrote it locally').toBe(true);
    await goOnline(C, { announceTo: A });
    // what a shell does on reconnect: ask the lanes of each other member (the catch-ups)
    await C.govCatchUp.requestCircle(CIRCLE, { callSkill: callOf(C) });
    await waitFor(() => keptVersions(C).join() === '1,2', 'C keeps version 2 after its catch-up');
    for (const n of [A, B]) await n.itemsCatchUp.requestCircle(CIRCLE, { callSkill: callOf(n) });

    await waitFor(async () => !(await hasText(C, 'raced the switch-off')), 'the author\'s own device takes back the raced row');
    // the raced statement reached A and B (on the log), and neither applied it
    for (const n of [A, B]) {
      await waitFor(() => n.agent.itemsRail.storedStatements(CIRCLE).some((s) => s.body.subject === racedId), `${n.label} holds the raced statement`);
      expect(await hasText(n, 'raced the switch-off'), `${n.label} refused the raced row`).toBe(false);
    }

    // ── a backdated row: Cato's app links it to a statement from before the switch-off ────────────────────────────────
    const old = C.agent.itemsRail.storedStatements(CIRCLE).find((s) => s.body.subject === oldId);
    expect(old, 'Cato holds his old statement').toBeTruthy();
    const identity = await C.agent.circleIdentityFor(CIRCLE);
    const backdated = signSpine(identity, {
      kind: 'snapshot', circleId: CIRCLE, subject: 'task-backdated',
      payload: { item: { id: 'task-backdated', type: 'task', text: 'backdated' }, authorRef: old.body.payload.authorRef },
      parent: old.body.hash, deps: [],
    });
    for (const n of [A, B, C]) {
      await n._routerRef.fn({ from: C.pubKey, payload: { subtype: ITEMS_BROADCAST, circleId: CIRCLE, event: backdated } });
    }
    for (const n of [A, B, C]) {
      await waitFor(() => n.agent.itemsRail.storedStatements(CIRCLE).some((s) => s.body.hash === backdated.body.hash), `${n.label} holds the backdated statement`);
      expect(await hasText(n, 'backdated'), `${n.label} refused the backdated row`).toBe(false);
    }

    // ── the switch-off did not reach back, and the three end equal ───────────────────────────────────────────────────
    for (const n of [A, B, C]) expect(await hasText(n, 'made while adding was on'), `${n.label} keeps the old row`).toBe(true);
    const [ra, rb, rc] = await Promise.all([rowsOf(A), rowsOf(B), rowsOf(C)]);
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);

    // ── a joiner, after the switch-off, with every lane statement aged out: the rows reach it as SERVED heads ─────────
    for (const n of [A, B, C]) n.deviceLog.setRetention({ chat: 0 });
    for (const n of [A, B, C]) expect(n.agent.itemsRail.storedStatements(CIRCLE).length, `${n.label}'s lane aged out`).toBe(0);
    D = await bootRealAgentNode('D', opts);
    const tx = new InternalTransport(bus, D.pubKey);
    await D.agent.sa.addSecureTransport('relay', tx);
    D._busTransport = tx;
    wireInboundLikeShell(D);
    const joined = await joinExistingCircle(A, D, { groupId: CIRCLE, handle: 'dirk' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B, C, D], CIRCLE);
    await Promise.all([A, B, C, D].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    await D.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
    await D.govCatchUp.requestCircle(CIRCLE, { callSkill: callOf(D) });
    await waitFor(() => keptVersions(D).join() === '1,2', 'D keeps the settings chain');
    await D.itemsCatchUp.requestCircle(CIRCLE, { callSkill: callOf(D) });
    await waitFor(() => hasText(D, 'made while adding was on'), 'the joiner gets the existing row of a type whose ADD is off');
    // the heads the members SERVED for it were taken (only an asked batch lands one on the log); the members' re-fan to a
    // new member may also bring the original statement, judged as the act it was (behind the line: allowed)
    const served = D.agent.itemsRail.storedStatements(CIRCLE).filter((s) => s.body.subject === oldId && s.body.payload?.served === true);
    expect(served.length, 'served heads, taken in answer to D\'s own ask').toBeGreaterThan(0);
    expect(await rowsOf(D)).toEqual(ra);
  }, 180_000);
});
