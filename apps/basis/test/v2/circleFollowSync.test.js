/**
 * SIBLINGS FOLLOW A CIRCLE (L109 option A, Frits 2026-09-21: "build L109 option A first"). A device that founds or
 * joins a circle tells the person's other devices — over the one sibling carry, sibling-gated like the grants lane —
 * and a sibling that hears it joins itself: the same per-circle step the enrol consume runs (registry record ·
 * presence · the roster seed from the sibling · the announce · the lanes' pulls). On connect a device asks its
 * siblings for the circles it lacks (the offline half). A kring the person switched OFF on that device is not
 * joined (the opt-out wins); a circle this device is in already is left alone.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleFollowSync, CIRCLE_FOLLOW_SUBTYPES } from '../../src/v2/circleFollowSync.js';

const SIB = 'sibling-addr'; const STRANGER = 'stranger';
function rig({ mine = [], inCircles = [], kringOff = [] } = {}) {
  const sent = []; const consumed = []; const landed = [];
  const sync = createCircleFollowSync({
    siblings: async () => [SIB],
    sendToPeer: async (to, payload, opts) => { sent.push({ to, payload, opts }); },
    myEntries: async () => mine,
    isIn: async (circleId) => inCircles.includes(circleId),
    kringOn: (circleId) => !kringOff.includes(circleId),
    consume: async (entry) => { consumed.push(entry); return { circleId: entry.id, ok: true, steps: ['registry', 'roster-derived'] }; },
    onLanded: (r) => landed.push(r),
  });
  return { sync, sent, consumed, landed };
}
const entry = (id, over = {}) => ({ id, handle: 'anna', address: `${id}@sib`, relays: ['wss://r'], ...over });

describe('createCircleFollowSync', () => {
  it('LIVE: a circle I just entered goes to every sibling, hold-forwarded, as the entry the enrol consume takes', async () => {
    const { sync, sent } = rig({ mine: [entry('c1')] });
    const r = await sync.fanJoined('c1');
    expect(r).toEqual({ attempted: 1 });
    expect(sent[0].to).toBe(SIB);
    expect(sent[0].payload).toEqual({ subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c1') });
    expect(sent[0].opts).toMatchObject({ guarantee: 'hold-forward' });
    expect(await sync.fanJoined('not-mine'), 'a circle I am not in is nobody\'s business').toEqual({ attempted: 0 });
  });
  it('LANDING: a sibling\'s carry for a circle I am not in is CONSUMED — the per-circle enrol step; one I am in is left alone', async () => {
    const { sync, consumed, landed } = rig({ inCircles: ['c-old'] });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c-new') });
    expect(consumed).toEqual([entry('c-new')]);
    expect(landed).toEqual([{ from: SIB, circleId: 'c-new', ok: true, steps: ['registry', 'roster-derived'] }]);
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c-old') });
    expect(consumed.length, 'already in it: nothing to do').toBe(1);
  });
  it('the KRING OPT-OUT wins: a circle the person switched off on this device is not joined; a stranger\'s carry is refused; a malformed one too', async () => {
    const { sync, consumed } = rig({ kringOff: ['c-off'] });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c-off') });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](STRANGER, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c-x') });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: { id: 'c-y' } });   // no sibling address: nothing to seed from
    expect(consumed).toEqual([]);
  });
  it('a landing is consumed ONCE while in flight — a re-sent carry does not run the step twice', async () => {
    let resolveIt; const consume = vi.fn(() => new Promise((r) => { resolveIt = r; }));
    const sync = createCircleFollowSync({ siblings: async () => [SIB], sendToPeer: async () => {}, myEntries: async () => [], isIn: async () => false, consume });
    const p1 = sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c1') });
    const p2 = sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c1') });
    while (!resolveIt) await new Promise((r) => setTimeout(r, 1));   // the step is reached after the sibling + membership checks
    resolveIt({ circleId: 'c1', ok: true, steps: [] });
    await Promise.all([p1, p2]);
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it('CATCH-UP: on connect a device asks its siblings; a sibling answers with every circle it is in, one carry each', async () => {
    const { sync, sent } = rig({ mine: [entry('c1'), entry('c2')] });
    expect(await sync.requestFromSiblings()).toEqual({ requested: 1 });
    expect(sent[0].payload).toEqual({ subtype: CIRCLE_FOLLOW_SUBTYPES.request });
    sent.length = 0;
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.request](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.request });
    expect(sent.map((s) => [s.to, s.payload.circle.id])).toEqual([[SIB, 'c1'], [SIB, 'c2']]);
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.request](STRANGER, { subtype: CIRCLE_FOLLOW_SUBTYPES.request });
    expect(sent.length, 'a stranger learns nothing').toBe(2);
  });
});

describe('LEAVE FOLLOWS (2026-09-22) — a circle left on one device is left on the person\'s others', () => {
  const rigLeft = ({ mine = [], left = [], inCircles = [] } = {}) => {
    const sent = []; const lefts = [];
    const sync = createCircleFollowSync({
      siblings: async () => [SIB],
      sendToPeer: async (to, payload, opts) => { sent.push({ to, payload, opts }); },
      myEntries: async () => mine,
      myLeft: async () => left,
      isIn: async (circleId) => inCircles.includes(circleId),
      consume: async (entry) => ({ circleId: entry.id, ok: true, steps: [] }),
      leave: async (circleId) => { lefts.push(circleId); return { ok: true }; },
    });
    return { sync, sent, lefts };
  };
  it('LIVE: the leaving device tells every sibling, hold-forwarded', async () => {
    const { sync, sent } = rigLeft();
    expect(await sync.fanLeft('c1')).toEqual({ attempted: 1 });
    expect(sent[0]).toMatchObject({ to: SIB, payload: { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: 'c1' } }, opts: { guarantee: 'hold-forward' } });
    expect(sent[0].payload.circleId, 'never a top-level circleId — the sibling send would speak in the circle just left').toBeUndefined();
  });
  it('LANDING: a sibling\'s left for a circle I am in runs the local leave — no statement of my own; one I am not in is nothing; a stranger is refused', async () => {
    const { sync, lefts } = rigLeft({ inCircles: ['c1'] });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.left](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: 'c1' } });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.left](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: 'c-not-mine' } });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.left](STRANGER, { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: 'c1' } });
    expect(lefts).toEqual(['c1']);
  });
  it('CATCH-UP: a sibling\'s answer names the circles it LEFT beside the ones it is in; the asker leaves what it still holds', async () => {
    const { sync, sent } = rigLeft({ mine: [entry('c2')], left: ['c1'] });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.request](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.request });
    expect(sent.map((s) => [s.payload.subtype, s.payload.circle?.id])).toEqual([
      [CIRCLE_FOLLOW_SUBTYPES.carry, 'c2'], [CIRCLE_FOLLOW_SUBTYPES.left, 'c1'],
    ]);
  });
  it('a carry for a circle a sibling has LEFT is not a re-join: the left wins on the landing device', async () => {
    // the ORDER on the wire is the sibling's: what it is in first, then what it left — so a device that was in
    // neither joins c2 and ignores c1; a device still in c1 leaves it. Nothing re-joins a left circle.
    const { sync, lefts } = rigLeft({ inCircles: ['c1'] });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.left](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: 'c1' } });
    await sync.handlers[CIRCLE_FOLLOW_SUBTYPES.carry](SIB, { subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle: entry('c1') });
    expect(lefts).toEqual(['c1']);
  });
});
