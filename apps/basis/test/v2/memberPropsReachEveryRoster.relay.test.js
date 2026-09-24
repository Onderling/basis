/**
 * `member-props` OVER A REAL RELAY (2026-09-21; the note `NOTE-member-props-on-the-membership-lane.md`, Fable's review):
 * a member renames under Mij → one signed statement per circle they are in → every co-member's roster row shows the
 * new name; a handle another member holds is refused at the fold on every device; an unchanged save appends nothing.
 *
 * Three devices, two circles: admin + bram + cato in A, admin + bram in B. Bram renames; the admin's and cato's rows
 * for bram rename in A, the admin's in B. Cato then tries to take bram's handle in A — refused everywhere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE_A = 'circle-member-props-a';
const CIRCLE_B = 'circle-member-props-b';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const rowOf = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('a member\'s own name reaches every roster they are on — member-props on the membership lane', () => {
  let relay; let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    // WITH a device log, as every shell boots: the membership RAIL (signed statements on the log, fanned, caught up)
    // exists only then — without it the statements ride the legacy store appender and never leave the device.
    const opts = () => ({ agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    [admin, bram, cato] = await Promise.all([bootRealAgentNode('admin', opts()), bootRealAgentNode('bram', opts()), bootRealAgentNode('cato', opts())]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl: relay.url });
    await createCircle(admin, { groupId: CIRCLE_A, name: 'A' });
    await settleMember(admin, CIRCLE_A);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE_A, handle: 'bram' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE_A);
    expect((await joinExistingCircle(admin, cato, { groupId: CIRCLE_A, handle: 'cato' })).joined.ok).toBe(true);
    await settleMember(cato, CIRCLE_A);
    await createCircle(admin, { groupId: CIRCLE_B, name: 'B' });
    await settleMember(admin, CIRCLE_B);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE_B, handle: 'bram' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE_B);
    await Promise.all([admin, bram, cato].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const [node, circles] of [[admin, [CIRCLE_A, CIRCLE_B]], [bram, [CIRCLE_A, CIRCLE_B]], [cato, [CIRCLE_A]]]) {
      for (const c of circles) await bindCircleAddressKeysFor({ agent: node.agent, circleId: c });
    }
  }, 180000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* */ }
    try { await relay?.stop(); } catch { /* */ }
  });

  it('bram sets a display name under Mij → the admin\'s and cato\'s rows for bram show it in A, the admin\'s in B', async () => {
    const r = await bram.agent.callSkill('stoop', 'setMyDisplayName', { displayName: 'Bram de Vries' });
    expect(r?.error).toBeUndefined();
    // …and the statement rode the lane: bram's OWN folded row names it (the local fold), before anyone else's does
    expect(await until(async () => (rowOf(await readRoster(bram, CIRCLE_A), bram.pubKey)?.displayName === 'Bram de Vries' ? true : null), { timeout: 10_000, step: 250 })).toBe(true);
    for (const [who, circleId] of [[admin, CIRCLE_A], [cato, CIRCLE_A], [admin, CIRCLE_B]]) {
      const ok = await until(async () => (rowOf(await readRoster(who, circleId), bram.pubKey)?.displayName === 'Bram de Vries' ? true : null), { timeout: 20_000, step: 400 });
      expect(ok, `${who.label}'s row for bram in ${circleId} renamed`).toBe(true);
    }
    // cato is in A only — B's roster never heard of cato and cato never heard of B: nothing to assert, nothing leaked
  }, 60_000);

  it('an oversize FACE reaches no roster at all — the cap binds on every receiver', async () => {
    // The picture itself is the persona's `profilePicture`, disclosed per circle through the release (the
    // "shares his persona release" case below covers the happy path, and the two-device walk covers it on
    // real bytes). What is asserted HERE is the refusal, because it is the part no shell can be trusted with:
    // an app version that skipped its own check would still be refused by every fold that receives it.
    const huge = { type: 'blob', ref: 'blob://big', enc: { sealed: true, keyRef: 'k', format: 'b', bytes: 99, thumb: 'A'.repeat(9000) } };
    const before = rowOf(await readRoster(admin, CIRCLE_A), bram.pubKey)?.said?.displayName ?? null;
    await bram.agent.emitMemberProps({ circleIds: [CIRCLE_A], props: { displayName: 'Bram Oversize', personaProperties: { profilePicture: huge } } });
    await new Promise((r) => { setTimeout(r, 3000); });
    const row = rowOf(await readRoster(admin, CIRCLE_A), bram.pubKey);
    expect(row?.personaProperties?.profilePicture, 'the oversize picture never lands').toBeUndefined();
    expect(row?.said?.displayName, 'and nothing it travelled with lands either').toBe(before);
  }, 60_000);

  it('a handle change reaches the rows too; a handle ANOTHER member holds is refused — by the op here (it reads the folded rosters), by the fold everywhere (kernel-tested)', async () => {
    const r = await bram.agent.callSkill('stoop', 'setMyHandle', { handle: 'bramdv' });
    expect(r?.error).toBeUndefined();
    expect(await until(async () => (rowOf(await readRoster(admin, CIRCLE_A), bram.pubKey)?.handle === 'bramdv' ? true : null), { timeout: 20_000, step: 400 }), 'the admin\'s row has bram\'s new handle').toBe(true);
    // cato tries to take it. The op refuses first — it reads every folded roster it is on, so bram's lane-borne
    // rename counts (the local cache alone still had bram's join-time handle: measured, this was red). The FOLD is
    // the rule that binds on every other device (`rosterFold.test.js`, uniqueness deny-wins).
    const stmt = await cato.agent.callSkill('stoop', 'setMyHandle', { handle: 'bramdv' });
    expect(stmt?.error, 'the op refuses a taken handle').toBe('invalid-handle');
    await settle(2000);
    expect(rowOf(await readRoster(admin, CIRCLE_A), cato.pubKey)?.handle, 'cato keeps the old handle on the admin\'s roster').toBe('cato');
    expect(rowOf(await readRoster(bram, CIRCLE_A), cato.pubKey)?.handle, '…and on bram\'s').toBe('cato');
  }, 60_000);

  it('an unchanged save appends nothing (the diff gate)', async () => {
    const before = await bram.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE_A });
    const rowsBefore = JSON.stringify(rowOf(before?.members ?? [], bram.pubKey));
    const r = await bram.agent.callSkill('stoop', 'setMyDisplayName', { displayName: 'Bram de Vries' });   // the same name again
    expect(r?.error).toBeUndefined();
    await settle(1500);
    const after = await bram.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE_A });
    expect(JSON.stringify(rowOf(after?.members ?? [], bram.pubKey))).toBe(rowsBefore);
  }, 30_000);

  // STEP TWO (2026-09-22): the persona's RELEASE for a circle rides the same statement. No admin in the loop: bram's
  // own device says it on A's lane, the admin's and cato's rows fold it; B never hears what bram told A alone.
  it('bram shares his persona release to A → the admin\'s and cato\'s rows for bram carry it; B\'s roster does not; a withdrawn key is gone; an unchanged share says nothing', async () => {
    const { shareDisclosureToCircle, createDisclosureShareMemo } = await import('../../src/core/handlers/personaPropsUpdate.js');
    const call = (app, op, args) => bram.agent.callSkill(app, op, args);
    await call('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });
    await call('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Bram Bakker' });
    await call('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE_A, key: 'place', enabled: true });
    // realName stays undisclosed to A: reveal-gating — it must never travel
    const memo = createDisclosureShareMemo();
    const share = () => shareDisclosureToCircle({ callSkill: call, emitMemberProps: (a) => bram.agent.emitMemberProps(a), circleId: CIRCLE_A, personaId: 'default', lastShared: memo });
    const r1 = await share();
    expect(r1).toMatchObject({ ok: true, via: 'lane' });
    for (const who of [admin, cato]) {
      const ok = await until(async () => (rowOf(await readRoster(who, CIRCLE_A), bram.pubKey)?.personaProperties?.place === 'Groningen' ? true : null), { timeout: 20_000, step: 400 });
      expect(ok, `${who.label}'s row for bram in A carries the release`).toBe(true);
      const row = rowOf(await readRoster(who, CIRCLE_A), bram.pubKey);
      expect(row.personaProperties.realName, 'the undisclosed property never travels').toBeUndefined();
      expect(row.said?.personaProperties, 'the row says the lane holds it').toEqual({ place: 'Groningen' });
    }
    expect(rowOf(await readRoster(admin, CIRCLE_B), bram.pubKey)?.personaProperties?.place, 'B was not told').toBeUndefined();
    // unchanged share: nothing said
    expect(await share()).toEqual({ ok: true, via: 'none', unchanged: true, changedKeys: [] });
    // withdraw: the key leaves the release → the rows lose it (the map is replaced whole)
    await call('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE_A, key: 'place', enabled: false });
    const r3 = await share();
    expect(r3).toMatchObject({ ok: true, via: 'lane' });
    const gone = await until(async () => { const pp = rowOf(await readRoster(admin, CIRCLE_A), bram.pubKey)?.personaProperties; return pp && pp.place === undefined ? true : null; }, { timeout: 20_000, step: 400 });
    expect(gone, 'the admin\'s row no longer carries the withdrawn property').toBe(true);
  }, 90_000);
});
