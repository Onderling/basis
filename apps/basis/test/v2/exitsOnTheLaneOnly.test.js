/**
 * A LEAVE AND A REMOVAL LIVE ON THE MEMBERSHIP LANE ONLY.
 *
 * The lane has carried `leave` and `evict` statements, folded deny-wins, since before this test; pinboard also wrote an
 * exit ROW into its own pile (`group-leave` / `group-removal`) that six readers consulted, the list of "my circles"
 * among them. Two records of one fact. The rows go: every reader asks the fold, and a device that left a circle stops
 * listing it because its own `leave` statement folds it out — offline, at boot, with nothing else to read.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { CachingDataSource } from '@onderling/local-store';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, rosterBindingVerifier } from '../../src/v2/membershipRail.js';

const CIRCLE = 'exits-on-the-lane';
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}
// every exit row written into pinboard's pile, by type (written in the clear here, sealed below)
const exitRows = [];
const write = CachingDataSource.prototype.write;
vi.spyOn(CachingDataSource.prototype, 'write').mockImplementation(async function (p, data) {
  if (String(p).startsWith('mem://neighbourhood/items/')) {
    let t = null; try { t = JSON.parse(data)?.type; } catch { /* not JSON */ }
    if (t === 'group-leave' || t === 'group-removal') exitRows.push(t);
  }
  return write.call(this, p, data);
});

describe('a leave and a removal are statements on the lane, not rows in a pile', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); vi.restoreAllMocks(); });

  it('B leaves, C is removed: no exit row is written, and each drops the circle from its own list', async () => {
    [A, B, C] = await Promise.all(['A', 'B', 'C'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
    await connectNodesOverBus([A, B, C]);
    for (const n of [A, B, C]) wireMembershipReceiver(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Exits' });
    for (const [n, h] of [[B, 'bram'], [C, 'cas']]) {
      const j = await joinExistingCircle(A, n, { groupId: CIRCLE, handle: h });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, C], CIRCLE);
    const mine = async (n) => (await n.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [];
    expect(await mine(B)).toContain(CIRCLE);

    // C's relay records what comes off it: the security half of a removal runs the moment the evict folds on C
    const removedAddrs = [];
    const cAddress = C.agent.circleAddressFor?.(CIRCLE) ?? null;
    const relaysBefore = C.agent.sa.relays;
    C.agent.sa.relays = { ...(relaysBefore ?? {}), list: () => [...(relaysBefore?.list?.() ?? []), { url: 'ws://recording.example', port: { removeAddress: (a) => { removedAddrs.push(a); } } }] };

    const left = await B.agent.callSkill('pinboard', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    const removed = await A.agent.callSkill('pinboard', 'removeMember', { groupId: CIRCLE, memberWebid: C.pubKey });
    expect(removed?.error, JSON.stringify(removed)).toBeUndefined();

    expect(await until(async () => (!(await mine(B)).includes(CIRCLE) ? true : null), { timeout: 8000, step: 100 }),
      'the leaver no longer lists the circle').toBe(true);
    const members = async (n) => ((await n.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? []).map((m) => m.webid);
    expect(await until(async () => (!(await members(A)).includes(B.pubKey) && !(await members(A)).includes(C.pubKey) ? true : null), { timeout: 12000, step: 150 }),
      'the admin folds both out').toBe(true);
    expect(exitRows, 'no exit row is written into pinboard\'s pile').toEqual([]);

    // C, removed by the admin: out of "my circles" (the security half ran: the address is off the relay), listed only as
    // removed — what a person's shells show read-only until they close it — and a line from C does not land on A
    const cMine = await C.agent.callSkill('pinboard', 'listMyCircles', {});
    expect(cMine?.circles ?? [], 'C\'s circles no longer hold the circle').not.toContain(CIRCLE);
    expect((cMine?.removed ?? []).map((r) => r.id), 'C sees it as removed').toContain(CIRCLE);
    expect(cAddress, 'C had a per-circle address').toBeTruthy();
    expect(await until(async () => (removedAddrs.includes(cAddress) ? true : null), { timeout: 8000, step: 100 }),
      'C\'s address for the circle came off the relay when the evict folded').toBe(true);
    // A's content lanes bind every incoming statement against A's folded roster: one C signs with its circle key no longer binds
    const aBinds = rosterBindingVerifier((...x) => A.agent.callSkill(...x));
    expect(await aBinds({ author: cAddress, ref: C.pubKey, circleId: CIRCLE }), 'a line from the removed member does not land in the circle').toBe(false);
  }, 120_000);
});

describe('an exit the fold does not grant takes nobody out', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  // ingest's gate is signature + declared kind + author↔ref binding; it grants no authority. A plain member's signed
  // `evict` of C, or a `leave` with C as subject that B wrote, lands on C's lane — and the fold keeps C in.
  for (const kind of ['evict', 'leave']) {
    it(`a plain member's ${kind} naming C: C stays in, its address stays registered, a line from C still binds on A`, async () => {
      const CIRCLE2 = `exits-no-authority-${kind}`;   // a circle of its own: a local leave runs once per circle
      if (!A) {
        [A, B, C] = await Promise.all(['A', 'B', 'C'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
        await connectNodesOverBus([A, B, C]);
        for (const n of [A, B, C]) wireMembershipReceiver(n);
      }
      {
        await createCircle(A, { groupId: CIRCLE2, name: `Geen gezag ${kind}` });
        for (const [n, h] of [[B, 'bram'], [C, 'cas']]) {
          const j = await joinExistingCircle(A, n, { groupId: CIRCLE2, handle: h });
          expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
        }
        await bindCircleAddresses([A, B, C], CIRCLE2);
        // C must know B's per-circle address before B's statement can bind on C at all
        const bOnC = async () => ((await C.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE2, spineless: true }))?.members ?? [])
          .find((m) => (m.webid ?? m.addr) === B.pubKey && (m.circleAddress || (m.circleAddresses ?? []).length));
        expect(await until(async () => ((await bOnC()) ? true : null), { timeout: 10000, step: 150 }), 'C holds B\'s circle address').toBe(true);        // A's gate binds a line C signs with its circle key, before anything happens (else the check below proves nothing)
        expect(await rosterBindingVerifier((...x) => A.agent.callSkill(...x))({ author: C.agent.circleAddressFor(CIRCLE2), ref: C.pubKey, circleId: CIRCLE2 }),
          'baseline: a line from C binds on A').toBe(true);
      }
      const removedAddrs = [];
      const cAddress = C.agent.circleAddressFor?.(CIRCLE2) ?? null;
      const relaysBefore = C.agent.sa.relays;
      C.agent.sa.relays = { ...(relaysBefore ?? {}), list: () => [...(relaysBefore?.list?.() ?? []), { url: 'ws://recording.example', port: { removeAddress: (a) => { removedAddrs.push(a); } } }] };

      const forged = await B.agent.membershipRail.append(CIRCLE2, { kind, subject: C.pubKey });
      expect(forged?.statement, 'B could sign the statement').toBeTruthy();
      const landed = await C.agent.membershipRail.ingest(CIRCLE2, forged.statement);
      // L560: this refusal appeared under full-suite load only. When it does, SAY WHICH BRANCH: the same ingest again past
      // the verifier's roster memo (300 ms), and B's row as C holds it then — a stale memo read, a row without B's
      // address at that seq, or a real refusal are three different findings.
      let named = null;
      if (!landed?.ok) {
        const first = landed;
        await new Promise((r) => { setTimeout(r, 400); });
        const again = await C.agent.membershipRail.ingest(CIRCLE2, forged.statement);
        const row = ((await C.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE2, spineless: true }))?.members ?? []).find((m) => (m.webid ?? m.addr) === B.pubKey) ?? null;
        named = { first, again: { ok: again?.ok, reason: again?.reason }, author: String(forged.statement?.body?.author ?? '').slice(0, 8), rowAddrs: [row?.circleAddress, ...(row?.circleAddresses ?? [])].filter(Boolean).map((a) => String(a).slice(0, 8)) };
      }
      expect(landed?.ok, `the ${kind} passes ingest (signature + binding): ${JSON.stringify(named ?? landed)}`).toBe(true);
      await new Promise((r) => { setTimeout(r, 1500); });

      const cMine = await C.agent.callSkill('pinboard', 'listMyCircles', {});
      expect(cMine?.circles ?? [], 'C still lists the circle').toContain(CIRCLE2);
      expect(removedAddrs, 'C\'s address stays on the relay').not.toContain(cAddress);
      // the same statement lands on A too (B fans it there); A's fold keeps C, so a line C signs still binds on A
      expect((await A.agent.membershipRail.ingest(CIRCLE2, forged.statement))?.ok, 'it passes ingest on A as well').toBe(true);
      const aMembers = ((await A.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE2 }))?.members ?? []).map((m) => m.webid);
      expect(aMembers, 'A still has C on the roster').toContain(C.pubKey);
      expect(await rosterBindingVerifier((...x) => A.agent.callSkill(...x))({ author: cAddress, ref: C.pubKey, circleId: CIRCLE2 }),
        'a line from C still lands on A').toBe(true);
      C.agent.sa.relays = relaysBefore;
    }, 120_000);
  }
});
