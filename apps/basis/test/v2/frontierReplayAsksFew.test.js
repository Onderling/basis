/**
 * THE CONTENT LANES ASK THREE MEMBERS, NOT ALL (the start burst, 2026-11-20).
 *
 * A start asked every member of every circle for each lane's missing statements at once: with 5 circles of 15 that is
 * 75 requests per lane. The content lanes (items, chat) now ask three per circle: this person's own other devices
 * first, the rest picked at random by this device at each start. They WIDEN to the next three when nobody of the asked
 * answered within a short wait, and when an answer leaves a GAP (a statement whose predecessor this device still lacks):
 * a member who answers with less than it holds must not end the catch-up. A member with nothing missing answers with an
 * empty batch, so silence means "not reached".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';

const CIRCLE = 'circle:few';
const SUBTYPES = { request: 'lane-few-request', batch: 'lane-few-batch' };
const ME = 'me-webid';
const MINE = 'me-addr-here';
const SIBLING = 'me-addr-phone';

/** A bare rail: statements are bodies with a hash and an optional parent; ingest stores whatever arrives. */
function fakeRail(initial = []) {
  const stored = [...initial];
  return {
    storedStatements: () => stored.map((body) => ({ body })),
    ingest: async (_cid, s) => { if (stored.some((b) => b.hash === s.body.hash)) return { ok: true, existed: true }; stored.push(s.body); return { ok: true }; },
  };
}
/** A roster of 12 others plus this person's own row with two devices (this one and a sibling). */
const roster = (n = 12) => [
  { webid: ME, circleAddress: MINE, circleAddresses: [MINE, SIBLING] },
  ...Array.from({ length: n }, (_, i) => ({ webid: `w${i}`, circleAddress: `a${i}` })),
];
const callSkillFor = (rows) => async (app, op) => (op === 'listGroupMembers' ? { members: rows } : null);

function replay({ rail = fakeRail(), askWaitMs = 1000, sent = [] } = {}) {
  const r = makeFrontierReplay({
    rail,
    sendToPeer: (addr, payload) => { sent.push({ addr, payload }); },
    subtypes: SUBTYPES,
    selfWebid: ME,
    askFew: 3,
    askWaitMs,
    ownAddressFor: () => MINE,
  });
  return { r, sent, rail };
}
const asked = (sent) => sent.filter((s) => s.payload.subtype === SUBTYPES.request).map((s) => s.addr);

afterEach(() => { vi.useRealTimers(); });

describe('a content lane asks three members per circle', () => {
  it('asks three: this person\'s own other device first, then two others; never this device itself', async () => {
    const { r, sent } = replay();
    await r.requestCircle(CIRCLE, { callSkill: callSkillFor(roster()) });
    const a = asked(sent);
    expect(a.length).toBe(3);
    expect(a[0]).toBe(SIBLING);
    expect(a).not.toContain(MINE);
  });

  it('the pick differs between starts (picked at random by this device)', async () => {
    const picks = new Set();
    for (let i = 0; i < 12; i += 1) {
      const { r, sent } = replay();
      await r.requestCircle(CIRCLE, { callSkill: callSkillFor(roster()) });
      picks.add(asked(sent).slice(1).sort().join(','));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('widens to the next three when nobody answered within the wait; not when someone answered', async () => {
    vi.useFakeTimers();
    const quiet = replay();
    await quiet.r.requestCircle(CIRCLE, { callSkill: callSkillFor(roster()) });
    await vi.advanceTimersByTimeAsync(1100);
    expect(asked(quiet.sent).length, 'silence: three more asked').toBe(6);

    const answered = replay();
    await answered.r.requestCircle(CIRCLE, { callSkill: callSkillFor(roster()) });
    const first = asked(answered.sent)[1];
    await answered.r.onBatch(first, { subtype: SUBTYPES.batch, circleId: CIRCLE, statements: [], seq: 0, done: true, more: false });
    await vi.advanceTimersByTimeAsync(1100);
    expect(asked(answered.sent).length, 'an answer (even an empty one): nobody more asked').toBe(3);
  });

  it('widens at once when an answer leaves a gap: a statement whose predecessor this device lacks', async () => {
    const { r, sent } = replay({ rail: fakeRail([{ hash: 'h0' }]) });
    await r.requestCircle(CIRCLE, { callSkill: callSkillFor(roster()) });
    const from = asked(sent)[1];
    // this member holds h1 -> h2 but sends only h2: h1 is missing here
    await r.onBatch(from, { subtype: SUBTYPES.batch, circleId: CIRCLE, statements: [{ body: { hash: 'h2', parentHash: 'h1' } }], seq: 0, done: true, more: false });
    expect(asked(sent).length, 'a gap: three more asked at once').toBe(6);
  });
});

describe('serving: nothing missing is an answer too', () => {
  it('a member with nothing the asker lacks answers with an empty batch, not silence', async () => {
    const sent = [];
    const r = makeFrontierReplay({ rail: fakeRail([{ hash: 'h0' }]), sendToPeer: (addr, payload) => { sent.push({ addr, payload }); }, subtypes: SUBTYPES });
    await r.onRequest('asker', { subtype: SUBTYPES.request, circleId: CIRCLE, frontier: ['h0'], limit: 50 });
    expect(sent.map((s) => s.payload)).toEqual([{ subtype: SUBTYPES.batch, circleId: CIRCLE, statements: [], seq: 0, done: true, more: false }]);
  });
});
