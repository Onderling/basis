/**
 * A JOIN IS ONE ACT, WITH ITS REAL END.
 *
 * The two-phone walk (2026-11-27): a join from another device succeeded (the circle was in the list, the admin's sheet
 * said "S joined.") and the strip said "That did not work: invalid-or-expired-code". The wizard first tries the code
 * LOCALLY; on a joiner that holds no code that answer is by design, it is what sends the wizard to the admin over the
 * peer path. The strip followed that first call (inside the tap's window) and nothing after it (the peer round trip
 * took longer than the window), so the by-design answer was the last thing it painted.
 *
 * Driven through the real wizard, the real act store, the real wrapper and the real manifests; only the waist's
 * bottom (the substrate) and the peer send are stand-ins.
 */
import { describe, it, expect } from 'vitest';
import { createActState, wrapCallSkillWithActState, ACT_INTERACTION_WINDOW_MS } from '../../src/v2/actState.js';
import { allManifests } from '../../src/v2/manifestSources.js';
import * as JG from '../../src/core/wizards/joinGroupState.js';

function fakeTimers() {
  let now = 1000; const q = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const h = { at: now + ms, fn }; q.push(h); return h; },
    clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    advance: (ms) => { now += ms; for (const h of [...q].sort((a, b) => a.at - b.at)) { if (h.at <= now) { q.splice(q.indexOf(h), 1); h.fn(); } } },
  };
}

const MANIFESTS = Object.fromEntries(allManifests().map((m) => [m.app, m]));

/** The substrate under the waist: the joiner holds no code, so the local redeem says so; the rest succeeds. */
function joinerSubstrate() {
  return async (appOrigin, opId) => {
    if (opId === 'redeemMembershipCode') return { error: 'invalid-or-expired-code' };
    return { ok: true };
  };
}

function crossDeviceJoin({ peerTakesMs }) {
  const timers = fakeTimers();
  const store = createActState({ now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const seen = [];
  store.subscribe((c) => seen.push(c ? { state: c.state, opId: c.opId, error: c.error ?? c.result?.error ?? null } : null));
  const callSkill = wrapCallSkillWithActState(joinerSubstrate(), { store, manifestsByOrigin: MANIFESTS });
  const state = JG.initialState();
  state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', adminPeerAddr: 'ADMIN' };
  state.handle = 'S';
  // the admin answers over the peer path, later than the tap's window
  const sendPeerRedeem = async () => { timers.advance(peerTakesMs); return { ok: true, codeId: 'k1', validUntil: 0 }; };
  store.noteInteraction();   // the person taps Join
  return { store, seen, timers, run: () => JG.finalSubmit({ state, callSkill, sendPeerRedeem }) };
}

describe('a join from another device is one act', () => {
  it('the local redeem\'s by-design answer is never painted; the strip ends on the join\'s success', async () => {
    const { store, seen, timers, run } = crossDeviceJoin({ peerTakesMs: ACT_INTERACTION_WINDOW_MS + 1500 });
    const { result } = await run();
    expect(result?.ok, 'the join itself worked').toBe(true);
    timers.advance(1);   // let a pending/done line paint
    const failed = seen.filter((c) => c?.state === 'failed');
    expect(failed, `the strip painted a failure on a join that worked: ${JSON.stringify(failed)}`).toEqual([]);
    expect(seen.some((c) => c?.state === 'done'), `the strip never said the join was done: ${JSON.stringify(seen)}`).toBe(true);
    expect(store.current?.state === 'failed').toBe(false);
  });

  it('being inside the join travels with its calls, not the clock: other calls meanwhile are judged on their own', async () => {
    const timers = fakeTimers();
    const store = createActState({ now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const calls = [];
    const substrate = async (appOrigin, opId, args, ctx) => { calls.push({ opId, ctx }); return opId === 'redeemMembershipCode' ? { error: 'invalid-or-expired-code' } : { ok: true }; };
    const callSkill = wrapCallSkillWithActState(substrate, { store, manifestsByOrigin: MANIFESTS });
    const seen = [];
    store.subscribe((c) => seen.push(c ? { state: c.state, opId: c.opId } : null));
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', adminPeerAddr: 'ADMIN' };
    state.handle = 'S';
    let answer;
    const answered = new Promise((r) => { answer = r; });
    const sendPeerRedeem = () => answered;   // the admin has not answered yet: the join stays open
    store.noteInteraction();
    const join = JG.finalSubmit({ state, callSkill, sendPeerRedeem });
    await new Promise((r) => setTimeout(r, 0));

    // (1) the person taps something else while the join hangs: that act paints its own pending and done
    timers.advance(ACT_INTERACTION_WINDOW_MS + 500);
    store.noteInteraction();
    const other = callSkill('pinboard', 'setMyHandle', { groupId: 'b9', handle: 'x' });
    timers.advance(500);   // past the pending delay
    await other;
    expect(seen.some((c) => c?.opId === 'setMyHandle' && c.state === 'pending'), `no pending for the other act: ${JSON.stringify(seen)}`).toBe(true);
    expect(seen.some((c) => c?.opId === 'setMyHandle' && c.state === 'done'), `no done for the other act: ${JSON.stringify(seen)}`).toBe(true);
    expect(calls.find((c) => c.opId === 'setMyHandle' && c.ctx?.door === 'tap'), 'a real tap is a tap').toBeTruthy();

    // (2) a write with no tap in the window (a turn, a background step), still during the join: its own door, no line
    timers.advance(ACT_INTERACTION_WINDOW_MS + 500);
    const before = seen.length;
    await callSkill('pinboard', 'setMyHandle', { groupId: 'b8', handle: 'y' }, { door: 'slash' });
    await callSkill('pinboard', 'setMyHandle', { groupId: 'b7', handle: 'z' });
    expect(seen.length, `a call with no tap painted: ${JSON.stringify(seen.slice(before))}`).toBe(before);
    const b8 = calls.find((c) => c.opId === 'setMyHandle' && c.ctx?.door === 'slash');
    expect(b8, 'a turn keeps its own door').toBeTruthy();
    const untapped = calls.filter((c) => c.opId === 'setMyHandle').at(-1);
    expect(untapped.ctx?.door, 'a background write is not recorded as the person\'s tap').not.toBe('tap');

    answer({ ok: true, codeId: 'k1', validUntil: 0 });
    const { result } = await join;
    expect(result?.ok, 'the join itself worked').toBe(true);
    // the join's own calls went down as the person's tap
    expect(calls.find((c) => c.opId === 'recordRemoteRedemption')?.ctx?.door, 'the join\'s own write is the person\'s tap').toBe('tap');
  });

  it('a join that really fails still says so: the admin\'s refusal is the act\'s end', async () => {
    const timers = fakeTimers();
    const store = createActState({ now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    const callSkill = wrapCallSkillWithActState(joinerSubstrate(), { store, manifestsByOrigin: MANIFESTS });
    const state = JG.initialState();
    state.invite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', adminPeerAddr: 'ADMIN' };
    state.handle = 'S';
    const sendPeerRedeem = async () => { timers.advance(ACT_INTERACTION_WINDOW_MS + 1500); return { error: 'invite-full' }; };
    store.noteInteraction();
    await JG.finalSubmit({ state, callSkill, sendPeerRedeem });
    expect(state.submitError, 'the wizard reports the refusal').toBeTruthy();
    expect(store.current?.state, 'the strip says the act failed').toBe('failed');
  });
});
