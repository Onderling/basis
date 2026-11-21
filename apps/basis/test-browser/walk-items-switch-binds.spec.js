/**
 * A CIRCLE'S SWITCH ON ADDING TASKS BINDS ON EVERY MEMBER'S DEVICE, ON ARRIVAL.
 *
 * Three real web apps in one circle over a local relay. A (the admin) turns tasks on; B adds a task. A switches adding
 * tasks off (the policy write and the signed statement a settings save makes). B's own app now refuses an add (its
 * sender's gate). C's app is one whose settings say adding is still on (its local copy of the policy is patched back,
 * as an older or changed app would hold it): its add passes its own gate, lands in its store and rides the items lane.
 * A and B must not show it; the task made before the switch-off stays on all three.
 *
 * C's patched policy is C's OWN copy (`window.onderlingCirclePolicy.update`, no statement made): no seam reaches a
 * peer's store past its sender gate, and an app that holds an older or changed policy is exactly the case the judge on
 * arrival is for. The adds go through the outer waist as a tap (`{door: 'tap'}`): only a person's act is asked by the
 * sender's gate, so a door-less call would pass B's gate too and prove nothing.
 *
 * The probe names its branch: a row missing on A or B is checked against what that device's console said (the items
 * lane's "refused ... circle-switch" line: it arrived and the switch refused it), so "never arrived" is not read as a
 * pass. With the judge off (`judging` forced false in `itemsRail.js`) the walk goes red at "A does not show the task
 * put past the gate": the row arrives and is shown.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8798 npx playwright test --project=relay test-browser/walk-items-switch-binds.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, gotoCircles, openCircleMatching, getInvite, joinFromInvite, enableTasks } from './peerHarness.js';
import { circleIds } from './contactsWalk.js';

test.setTimeout(480_000);
const NAME = 'Schakel Kring';
const RE = /schakel.?kring/i;
const BEFORE = 'gemaakt toen toevoegen aan stond';
const PAST = 'langs de schakelaar gezet';
const ADD = 'tasks add task';

// a read as background; an add as the person's tap (only a call naming a person door is asked by the sender's gate)
const call = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x), [app, op, args]);
const tap = (page, app, op, args = {}) => page.evaluate(([a, o, x]) => window.onderlingCall(a, o, x, { door: 'tap' }), [app, op, args]);
const openText = async (page, circleId) => JSON.stringify((await call(page, 'tasks', 'listOpen', { circleId })) ?? null);
const policyOf = (page, circleId) => page.evaluate((cid) => window.onderlingCirclePolicy.get(cid), circleId);
const addingOn = async (page, circleId) => (await policyOf(page, circleId))?.capabilities?.[ADD]?.enabled !== false;
// `features` is a map of feature → boolean (`circlePolicy.js` isFeatureEnabled)
const tasksOn = async (page, circleId) => (await policyOf(page, circleId))?.features?.tasks === true;

async function poll(fn, { tries = 30, every = 2000 } = {}) {
  for (let i = 0; i < tries; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)); }
  return null;
}

test('adding tasks switched off: a task put past the sender\'s gate is not shown on the other devices', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const said = new Map();   // label → console lines
  for (const p of peers) { said.set(p.label, []); p.page.on('console', (m) => said.get(p.label).push(m.text())); }
  try {
    const [A, B, C] = peers;
    const p = await pair(A, B, { name: NAME, re: RE, handle: 'schakelbee' });
    expect(p.joined, `B joined (${p.outcome})`).toBe(true);
    await gotoCircles(A.page); await openCircleMatching(A.page, RE);
    const uri = await getInvite(A.page, 'switch-c-invite');
    expect(uri, 'A has an invite for C').toBeTruthy();
    const jc = await joinFromInvite(C.page, uri, { handle: 'schakelcee', tag: 'switch-c' });
    expect(jc.joined, `C joined (${jc.outcome})`).toBe(true);
    const circle = (await circleIds(A.page)).find((id) => !/^pair-|^cc-help$/.test(String(id)));
    expect(circle, 'the circle id').toBeTruthy();

    // A turns tasks on; B and C follow it over the settings lane
    await gotoCircles(A.page); await openCircleMatching(A.page, RE);
    expect(await enableTasks(A.page), 'A turned tasks on').toBe(true);
    for (const n of [B, C]) expect(await poll(() => tasksOn(n.page, circle)), `${n.label} holds tasks on`).toBeTruthy();

    // B adds a task while adding is on: it reaches A and C
    const made = await tap(B.page, 'tasks', 'addTask', { text: BEFORE, circleId: circle });
    expect(made?.ok !== false && !made?.error, `B's add: ${JSON.stringify(made)}`).toBe(true);
    for (const n of [A, C]) expect(await poll(async () => (await openText(n.page, circle)).includes(BEFORE)), `${n.label} shows the task made before`).toBeTruthy();

    // A switches adding tasks off: what a settings save does (write the policy, state it on the lane)
    const pol = (await policyOf(A.page, circle)) ?? {};
    await A.page.evaluate(([cid, caps]) => window.onderlingCirclePolicy.update(cid, { capabilities: caps }), [circle, { ...(pol.capabilities ?? {}), [ADD]: { enabled: false } }]);
    expect(await A.page.evaluate((cid) => window.onderlingCirclePolicy.state(cid), circle), 'A states the switch-off').toBeTruthy();
    for (const n of [B, C]) expect(await poll(async () => !(await addingOn(n.page, circle))), `${n.label} holds adding off`).toBeTruthy();

    // B's own app refuses an add now (the sender's gate)
    const refused = await tap(B.page, 'tasks', 'addTask', { text: 'B probeert nog toe te voegen', circleId: circle });
    expect(refused?.ok, `B's own gate refuses: ${JSON.stringify(refused)}`).toBe(false);

    // C's app holds adding on (its copy of the policy patched back) and adds: past its gate, into its store, onto the lane
    const cPol = (await policyOf(C.page, circle)) ?? {};
    await C.page.evaluate(([cid, caps]) => window.onderlingCirclePolicy.update(cid, { capabilities: caps }), [circle, { ...(cPol.capabilities ?? {}), [ADD]: { enabled: true } }]);
    const past = await tap(C.page, 'tasks', 'addTask', { text: PAST, circleId: circle });
    expect(past?.ok !== false && !past?.error, `C's add passed its own gate: ${JSON.stringify(past)}`).toBe(true);

    // A and B: the statement arrives and is refused; never shown
    for (const n of [A, B]) {
      const refusal = await poll(() => said.get(n.label).find((l) => /refused/.test(l) && /circle-switch/.test(l)), { tries: 30, every: 2000 });
      const shown = (await openText(n.page, circle)).includes(PAST);
      if (!refusal && !shown) throw new Error(`${n.label}: the task is not shown, but no refusal was said: it may never have arrived (no evidence the switch bound)`);
      expect(shown, `${n.label} does not show the task put past the gate (said: ${refusal ?? 'nothing'})`).toBe(false);
      expect(refusal, `${n.label} said the switch refused it`).toBeTruthy();
    }
    // the task made before stays on all three
    for (const n of [A, B, C]) expect((await openText(n.page, circle)).includes(BEFORE), `${n.label} keeps the task made before`).toBe(true);
  } finally {
    await teardown(peers);
  }
});
