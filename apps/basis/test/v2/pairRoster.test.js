/**
 * The pair roster (L105): the roster a contact lacks, made automatically from the circle mechanics on the first
 * exchange after the Hi. Deterministic id, deterministic founder, invite on the turn, join by the shared path, the
 * joiner promoted to admin, idempotent, a stranger's invite refused; the launcher never shows it.
 */
import { describe, it, expect, vi } from 'vitest';
import { pairCircleIdFor, isPairCircleId, pairFounderOf, createPairRoster, withoutPairCircles } from '../../src/v2/pairRoster.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { createContactThreadChannel } from '../../src/v2/contactThreadChannel.js';
import { encodeMembershipCodeUrl } from '../../src/core/wizards/createGroupState.js';

const ANNA = 'anna-webid-aaaa', BEA = 'bea-webid-bbbb', CATO = 'cato-webid-cccc';

describe('the id and the founder', () => {
  it('both sides derive the same id whichever asks; the founder is the webid that sorts first; a pair needs two persons', () => {
    const id = pairCircleIdFor(ANNA, BEA);
    expect(id).toBe(pairCircleIdFor(BEA, ANNA));
    expect(id).toMatch(/^pair-[0-9a-f]{24}$/);
    expect(isPairCircleId(id)).toBe(true);
    expect(isPairCircleId('circle-42')).toBe(false);
    expect(pairCircleIdFor(ANNA, CATO)).not.toBe(id);
    expect(pairFounderOf(BEA, ANNA)).toBe(ANNA);
    expect(() => pairCircleIdFor(ANNA, ANNA)).toThrow();
  });
  it('the launcher never shows a pair roster', async () => {
    const circles = await loadCircles({ fetchGroups: async () => [{ id: 'k1', name: 'Huis' }, { id: pairCircleIdFor(ANNA, BEA), name: 'bea' }] });
    expect(circles.map((c) => c.id)).toEqual(['k1']);
    expect(withoutPairCircles(['k1', pairCircleIdFor(ANNA, BEA)])).toEqual(['k1']);
  });
});

/** A stoop stand-in: circles I am in, their members, the invite code, the calls made. */
function fakeSkills({ self, circles = {}, code = 'CODE1' } = {}) {
  const calls = [];
  const callSkill = vi.fn(async (app, op, args = {}) => {
    calls.push({ op, args });
    if (op === 'listMyCircles') return { circles: Object.keys(circles), names: Object.fromEntries(Object.keys(circles).map((c) => [c, circles[c].name ?? c])) };
    if (op === 'listGroupMembers') return { members: (circles[args.groupId]?.members ?? []).map((w) => ({ webid: w })) };
    if (op === 'createGroupV2') { circles[args.groupId] = { name: args.name, members: [self], rules: args.rules, inviteMaxRedemptions: args.inviteMaxRedemptions }; return { ok: true, groupId: args.groupId }; }
    if (op === 'getCurrentMembershipCode') return { code, expiresAt: 9e12, maxRedemptions: 1, redemptionsUsed: 0 };
    if (op === 'getGroupRules') return { doc: circles[args.groupId]?.rules ?? null };
    if (op === 'setMemberRole') return { ok: true };
    if (op === 'addContact') return { contact: { webid: args.webid } };
    if (op === 'whoAmI') return { webid: self };
    if (op === 'redeemMembershipCode') return { error: 'invalid-or-expired-code' };   // the code lives on the founder: the redeem is a round-trip
    if (op === 'setMyHandle') return { ok: true, handle: args.handle };
    return { ok: true };
  });
  return { callSkill, calls, circles };
}

describe('prepare — what the next turn carries', () => {
  it('the FOUNDER side (webid sorts first) creates the hidden circle once and puts the invite on the turn; a second turn while the contact is not in re-sends it; once the contact is in, nothing', async () => {
    const { callSkill, calls, circles } = fakeSkills({ self: ANNA });
    const pr = createPairRoster({ selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn() });
    const id = pairCircleIdFor(ANNA, BEA);
    const first = await pr.prepare(BEA, { name: 'bea' });
    expect(first?.pairInvite, 'no invite on the first turn').toMatch(/^onderling-invite:/);
    expect(circles[id]).toMatchObject({ name: 'bea', rules: { pair: true, apps: [] }, inviteMaxRedemptions: 1 });
    expect(calls.filter((c) => c.op === 'createGroupV2')).toHaveLength(1);
    const second = await pr.prepare(BEA);
    expect(second?.pairInvite).toBeTruthy();
    expect(calls.filter((c) => c.op === 'createGroupV2'), 'created twice').toHaveLength(1);
    circles[id].members.push(BEA);
    expect(await pr.prepare(BEA), 'the roster has both: nothing to carry').toBe(null);
  });
  it('the OTHER side never creates: its turn carries a request until the roster exists here', async () => {
    const { callSkill, calls, circles } = fakeSkills({ self: BEA });
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem: vi.fn() });
    expect(await pr.prepare(ANNA)).toEqual({ pairRequest: true });
    expect(calls.some((c) => c.op === 'createGroupV2')).toBe(false);
    circles[pairCircleIdFor(ANNA, BEA)] = { members: [ANNA, BEA] };
    expect(await pr.prepare(ANNA)).toBe(null);
  });
  it('a request is answered by the founder with the invite, and ignored by the side that does not found', async () => {
    const a = fakeSkills({ self: ANNA }); const prA = createPairRoster({ selfWebid: ANNA, callSkill: a.callSkill, sendPeerRedeem: vi.fn() });
    expect((await prA.onRequest(BEA))?.pairInvite).toBeTruthy();
    const b = fakeSkills({ self: BEA }); const prB = createPairRoster({ selfWebid: BEA, callSkill: b.callSkill, sendPeerRedeem: vi.fn() });
    expect(await prB.onRequest(ANNA)).toBe(null);
    expect(b.calls.some((c) => c.op === 'createGroupV2')).toBe(false);
  });
});

describe('the invite lands — the join', () => {
  const inviteFor = (groupId, code = 'CODE1') => encodeMembershipCodeUrl({ groupId, code, expiresAt: 9e12, name: 'anna', adminPeerAddr: ANNA });
  it('THE pair invite from the founder joins through the shared path, promotes nobody here, records the roster on the contact; a second one while joining joins once', async () => {
    const { callSkill, calls } = fakeSkills({ self: BEA });
    const joined = [];
    let resolveJoin;
    // stand in for joinCircleFromInvite's redeem: the shell's sendPeerRedeem answers the admin's confirmation
    const sendPeerRedeem = vi.fn(() => new Promise((r) => { resolveJoin = r; }));
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem, onJoined: (a) => joined.push(a) });
    const id = pairCircleIdFor(ANNA, BEA);
    const p1 = pr.onInvite(ANNA, inviteFor(id));
    const p2 = pr.onInvite(ANNA, inviteFor(id));
    await vi.waitFor(() => expect(typeof resolveJoin).toBe('function'));   // the chain reaches the redeem round-trip
    resolveJoin({ ok: true, groupId: id });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ joined: true, circleId: id });
    expect(r2).toEqual({ joined: true, circleId: id });
    expect(sendPeerRedeem, 'joined twice').toHaveBeenCalledTimes(1);
    expect(joined).toEqual([{ circleId: id }]);
    expect(calls.find((c) => c.op === 'addContact')?.args).toEqual({ webid: ANNA, pairCircleId: id });
  });
  it('an invite whose id is not THE pair id for these two is refused — a stranger cannot put you in a roster of theirs', async () => {
    const { callSkill } = fakeSkills({ self: BEA });
    const sendPeerRedeem = vi.fn();
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem, logger: { warn() {} } });
    expect(await pr.onInvite(CATO, inviteFor(pairCircleIdFor(ANNA, BEA)))).toEqual({ joined: false, reason: 'not-our-pair' });
    expect(await pr.onInvite(ANNA, inviteFor('some-other-circle'))).toEqual({ joined: false, reason: 'not-our-pair' });
    expect(await pr.onInvite(ANNA, 'garbage')).toEqual({ joined: false, reason: 'not-our-pair' });
    expect(sendPeerRedeem).not.toHaveBeenCalled();
  });
  it('an invite for a roster this side is already in joins nothing (and still records the row)', async () => {
    const id = pairCircleIdFor(ANNA, BEA);
    const { callSkill, calls } = fakeSkills({ self: BEA, circles: { [id]: { members: [ANNA, BEA] } } });
    const sendPeerRedeem = vi.fn();
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem });
    expect(await pr.onInvite(ANNA, inviteFor(id))).toEqual({ joined: false, reason: 'already-in', circleId: id });
    expect(sendPeerRedeem).not.toHaveBeenCalled();
    expect(calls.find((c) => c.op === 'addContact')?.args).toEqual({ webid: ANNA, pairCircleId: id });
  });
  it('the ADMITTING side promotes the joiner to admin of the pair circle and records the row; another circle is not its business', async () => {
    const id = pairCircleIdFor(ANNA, BEA);
    const { callSkill, calls } = fakeSkills({ self: ANNA, circles: { [id]: { members: [ANNA, BEA] } } });
    const pr = createPairRoster({ selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn() });
    expect(await pr.onAdmitted({ circleId: id, newMemberWebid: BEA })).toEqual({ promoted: true });
    expect(calls.find((c) => c.op === 'setMemberRole')?.args).toEqual({ groupId: id, memberWebid: BEA, role: 'admin' });
    expect(await pr.onAdmitted({ circleId: 'k1', newMemberWebid: BEA })).toBe(null);
    expect(await pr.onAdmitted({ circleId: id, newMemberWebid: CATO }), 'a pair id that is not for these two').toBe(null);
  });
});

describe('the channel carries it', () => {
  it('sendTurn asks the pair seam and puts the invite/request on the wire (inside the seal when there is one); inbound hands them to the seam and still delivers the text', async () => {
    const sent = [];
    const pair = { prepare: vi.fn(async () => ({ pairInvite: 'onderling-invite://X' })), onInvite: vi.fn(async () => ({ joined: true })), onRequest: vi.fn(async () => null) };
    const ch = createContactThreadChannel({ sendToPeer: async (a, p) => { sent.push(p); }, pair, now: () => 1 });
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm1' }).sent;
    expect(pair.prepare).toHaveBeenCalledWith('bea', expect.anything());
    expect(sent[0]).toMatchObject({ text: 'hoi', pairInvite: 'onderling-invite://X' });
    // sealed: the invite rides INSIDE the box, never in the clear beside it
    const sealFor = async (_peer, content) => ({ to: { version: 1 }, from: { version: 1 }, sealed: JSON.stringify(content), nonce: 'n' });
    const chS = createContactThreadChannel({ sendToPeer: async (a, p) => { sent.push(p); }, pair, sealFor, now: () => 1 });
    await chS.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm2' }).sent;
    expect(sent[1].pairInvite).toBeUndefined();
    expect(JSON.parse(sent[1].sealed.sealed)).toEqual({ text: 'hoi', pairInvite: 'onderling-invite://X' });
    // inbound, in the clear
    const got = [];
    const handler = ch.messageHandler((m) => got.push(m));
    await handler('anna', { subtype: sent[0].subtype, threadId: 'x', text: 'dag', messageId: 'm3', pairInvite: 'onderling-invite://Y' });
    expect(pair.onInvite).toHaveBeenCalledWith('anna', 'onderling-invite://Y');
    expect(got.map((m) => m.text)).toEqual(['dag']);
    await handler('anna', { subtype: sent[0].subtype, threadId: 'x', text: 'dag2', messageId: 'm4', pairRequest: true });
    expect(pair.onRequest).toHaveBeenCalledWith('anna', expect.anything());
    // inbound, sealed: the seam gets what the box held
    const openFor = async (s) => JSON.parse(s.sealed);
    const chO = createContactThreadChannel({ sendToPeer: async () => {}, pair, openFor, now: () => 1 });
    const got2 = [];
    await chO.messageHandler((m) => got2.push(m))('anna', { subtype: sent[0].subtype, threadId: 'x', text: '', messageId: 'm5', sealed: { to: { version: 1 }, sealed: JSON.stringify({ text: 'psst', pairInvite: 'onderling-invite://Z' }), nonce: 'n' } });
    expect(pair.onInvite).toHaveBeenLastCalledWith('anna', 'onderling-invite://Z');
    expect(got2.map((m) => m.text)).toEqual(['psst']);
  });
});
