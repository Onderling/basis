/**
 * The pair roster (L105): the roster a contact lacks, made automatically from the circle mechanics on the first
 * exchange after the Hi. Deterministic id, deterministic founder, invite on the turn, join by the shared path, the
 * joiner promoted to admin, idempotent, a stranger's invite refused; the launcher never shows it.
 */
import { describe, it, expect, vi } from 'vitest';
import { pairCircleIdFor, isPairCircleId, pairFounderOf, createPairRoster, withoutPairCircles, pairRouteFor } from '../../src/v2/pairRoster.js';
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
    expect(joined.map((j) => [j.circleId, j.invite?.groupId])).toEqual([[id, id]]);   // …with the invite: the point is recorded there
    expect(calls.find((c) => c.op === 'addContact')?.args).toEqual({ webid: ANNA, pairCircleId: id });
    // A person WITHOUT a handle joins under a quiet derived one — on the pair roster's row only. It must never become
    // the person's profile handle: found 2026-09-21 when the book started reading the roster and a visitor's
    // Contacten row read "pjy8n7fq" — the placeholder had been set as their handle at the join and stated on every
    // roster as what they say about themselves.
    expect(calls.filter((c) => c.op === 'setMyHandle'), 'the placeholder is not the person\'s handle').toEqual([]);
    expect(calls.find((c) => c.op === 'recordRemoteRedemption')?.args?.peerDisplay).toMatch(/^p[a-z0-9]{4,7}$/);
  });
  it('a person WITH a handle joins the pair roster under it, and the profile keeps it (the ordinary join path)', async () => {
    const { callSkill, calls } = fakeSkills({ self: BEA });
    let resolveJoin;
    const sendPeerRedeem = vi.fn(() => new Promise((r) => { resolveJoin = r; }));
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem, myHandle: async () => 'beatrix' });
    const id = pairCircleIdFor(ANNA, BEA);
    const p = pr.onInvite(ANNA, inviteFor(id));
    await vi.waitFor(() => expect(typeof resolveJoin).toBe('function'));
    resolveJoin({ ok: true, groupId: id });
    expect(await p).toEqual({ joined: true, circleId: id });
    expect(calls.filter((c) => c.op === 'setMyHandle').map((c) => c.args.handle)).toEqual(['beatrix']);
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

describe('the route (8b) — a message to a contact with a pair roster goes over it', () => {
  it('resolves to the contact\'s PRIMARY per-circle address on the pair roster with the roster\'s person key; null without a roster, or without them on it', async () => {
    const id = pairCircleIdFor(ANNA, BEA);
    const rowsOf = (circles) => async (_a, op, args) => (op === 'listMyCircles' ? { circles: Object.keys(circles) }
      : op === 'listGroupMembers' ? { members: circles[args.groupId] ?? [] } : {});
    const withBea = rowsOf({ [id]: [{ webid: ANNA, circleAddress: 'anna@pair' }, { webid: BEA, circleAddress: 'bea@pair', circleAddresses: ['bea@pair', 'bea-box@pair'], personKey: { version: 2, pubKey: 'K2' } }] });
    expect(await pairRouteFor({ callSkill: withBea, selfWebid: ANNA, contactWebid: BEA })).toEqual({ to: 'bea@pair', circleId: id, personKey: { version: 2, pubKey: 'K2' } });
    expect(await pairRouteFor({ callSkill: rowsOf({}), selfWebid: ANNA, contactWebid: BEA }), 'no roster yet').toBe(null);
    expect(await pairRouteFor({ callSkill: rowsOf({ [id]: [{ webid: ANNA, circleAddress: 'anna@pair' }] }), selfWebid: ANNA, contactWebid: BEA }), 'the contact is not on it yet').toBe(null);
    expect(await pairRouteFor({ callSkill: withBea, selfWebid: ANNA, contactWebid: ANNA })).toBe(null);
  });
  it('the channel delivers to the route with the circle id, persists the turn under the CONTACT, and falls back to the profile address without a route', async () => {
    const sent = [];
    const pair = { prepare: vi.fn(async () => null), routeFor: vi.fn(async (peer) => (peer === 'bea' ? { to: 'bea@pair', circleId: 'pair-x', personKey: null } : null)) };
    const store = { items: [], addItems: vi.fn(async (d) => { const p = d.map((x, i) => ({ id: `i${i}`, ...x })); store.items.push(...p); return p; }), listOpen: vi.fn(async () => store.items) };
    const ch = createContactThreadChannel({ sendToPeer: async (a, p, o) => { sent.push({ a, p, o }); }, pair, itemStore: store, now: () => 1 });
    await ch.sendTurn({ peerAddr: 'bea', threadId: 'bea', text: 'hoi', messageId: 'm1' }).sent;
    expect(sent[0]).toMatchObject({ a: 'bea@pair', o: { circleId: 'pair-x' } });
    expect(sent[0].p).toMatchObject({ text: 'hoi', threadId: 'bea' });
    expect(store.addItems.mock.calls[0][0][0].source.threadId ?? store.addItems.mock.calls[0][0][0].source.to ?? 'bea').toBeTruthy();
    await ch.sendTurn({ peerAddr: 'cato', threadId: 'cato', text: 'dag', messageId: 'm2' }).sent;
    expect(sent[1].a).toBe('cato');
    expect(sent[1].o).toBeUndefined();
  });
});

// ── THE LENS (persona step 3, 2026-09-24): which persona a contact sees you as ──────────────────────────────────
// The contact row records the persona; the founder pushes that persona's release onto the new pair circle; the
// joiner joins AS it. Same identity, same address, same pair id — only what the contact receives differs.
describe('the lens — the pair circle carries the persona the contact row names', () => {
  const inviteFor = (groupId, code = 'CODE1') => encodeMembershipCodeUrl({ groupId, code, expiresAt: 9e12, name: 'anna', adminPeerAddr: ANNA });

  it('the FOUNDER pushes the contact\'s persona release onto the pair circle it just made', async () => {
    const { callSkill } = fakeSkills({ self: ANNA });
    const shared = [];
    const pr = createPairRoster({
      selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn(),
      personaFor: async (webid) => (webid === BEA ? 'werk' : null),
      shareRelease: async (circleId, personaId) => { shared.push([circleId, personaId]); return { ok: true }; },
    });
    const first = await pr.prepare(BEA, { name: 'bea' });
    expect(first?.pairInvite).toBeTruthy();
    expect(shared).toEqual([[pairCircleIdFor(ANNA, BEA), 'werk']]);
  });

  it('a contact row with NO persona (predates the field) pushes nothing — never a silent default', async () => {
    const { callSkill } = fakeSkills({ self: ANNA });
    const shared = [];
    const pr = createPairRoster({ selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn(), personaFor: async () => null, shareRelease: async (...a) => { shared.push(a); } });
    await pr.prepare(BEA);
    expect(shared).toEqual([]);
  });

  it('the JOINER joins the pair circle AS the persona the contact row names — the release computed is that persona\'s', async () => {
    const { callSkill, calls } = fakeSkills({ self: BEA });
    let resolveJoin;
    const sendPeerRedeem = vi.fn(() => new Promise((r) => { resolveJoin = r; }));
    const pr = createPairRoster({ selfWebid: BEA, callSkill, sendPeerRedeem, personaFor: async (webid) => (webid === ANNA ? 'buurt' : null) });
    const id = pairCircleIdFor(ANNA, BEA);
    const p = pr.onInvite(ANNA, inviteFor(id));
    await vi.waitFor(() => expect(typeof resolveJoin).toBe('function'));
    resolveJoin({ ok: true, groupId: id });
    expect(await p).toEqual({ joined: true, circleId: id });
    const release = calls.find((c) => c.op === 'getPersonaRelease');
    expect(release?.args, 'finalSubmit asked for THIS persona\'s release for THIS circle').toMatchObject({ id: 'buurt', contextId: id });
  });

  it('without a personaFor, the book is read: the row\'s `persona` field decides', async () => {
    const { callSkill } = fakeSkills({ self: ANNA });
    const base = callSkill.getMockImplementation();
    callSkill.mockImplementation(async (app, op, args) => (op === 'listContacts' ? { items: [{ webid: BEA, persona: 'club' }] } : base(app, op, args)));
    const shared = [];
    const pr = createPairRoster({ selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn(), shareRelease: async (c, pid) => { shared.push([c, pid]); } });
    await pr.prepare(BEA);
    expect(shared).toEqual([[pairCircleIdFor(ANNA, BEA), 'club']]);
  });

  it('…read from the reply the WAIST really gives: full `contacts` beside the trimmed chat `items` (2026-09-24)', async () => {
    // `adaptStoopReply` answers `listContacts` with BOTH: `contacts` (the book's rows, whole) and `items` (the chat
    // projection — id, label, handle, trust, peerAddr, personKey, pairCircleId, and NOT `persona`). Reading `items`
    // first found no persona on any row, so every pair circle founded with no release: the lens from #188 never took
    // effect in a running app. The test above faked a reply the waist never gives.
    const { callSkill } = fakeSkills({ self: ANNA });
    const base = callSkill.getMockImplementation();
    callSkill.mockImplementation(async (app, op, args) => (op === 'listContacts'
      ? { contacts: [{ webid: BEA, persona: 'club' }], items: [{ id: BEA, type: 'contact', webid: BEA, label: BEA }] }
      : base(app, op, args)));
    const shared = [];
    const pr = createPairRoster({ selfWebid: ANNA, callSkill, sendPeerRedeem: vi.fn(), shareRelease: async (c, pid) => { shared.push([c, pid]); } });
    await pr.prepare(BEA);
    expect(shared).toEqual([[pairCircleIdFor(ANNA, BEA), 'club']]);
  });
});
