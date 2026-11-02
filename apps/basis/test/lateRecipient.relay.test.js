/**
 * A STATEMENT FANNED TO A SHORT ROSTER REACHES THE MEMBER WHO WAS MISSING FROM IT, ONCE THEIR ADDRESS LANDS.
 *
 * The shape captured on CI (the spine walk, "Bea never saw the box's change"): a device signs a membership statement
 * while its roster lacks one member's address, so its fan reaches everyone but that member — and nothing tells them
 * again. Here: Anna is away while Dirk joins through Bea (an admin), so Anna's roster has no address for Dirk; Anna
 * signs a role change, which her fan cannot carry to him; Dirk's catch-up is held off so only a fan could reach him.
 * When Anna then catches up and Dirk's rows land on her roster, the statement must reach him.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, joinExistingCircle, bindCircleAddresses, until, teardown, readRoster,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { MEMBERSHIP_CATCHUP_SUBTYPES } from '../src/v2/membershipRail.js';
import { propagateCircleAddressesAfterJoin } from '../src/v2/circleAddressAnnounce.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'late-recipient';
const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const roleOf = async (node, webid) => (await readRoster(node, GROUP)).find((m) => m.webid === webid)?.role ?? null;

describe('a statement fanned to a short roster', () => {
  let relay; let A; let B; let D;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    A = await bootRealAgentNode('anna', { agentOpts: log() });
    B = await bootRealAgentNode('bea', { agentOpts: log() });
    D = await bootRealAgentNode('dirk', { agentOpts: log() });
    await connectNodesOverRelay([A, B, D], { relayUrl: relay.url });
    await pairCircle(A, B, { groupId: GROUP, name: 'Laat', handle: 'bea' });
    await bindCircleAddresses([A, B], GROUP);
    // Bea becomes an admin, so a new member can join through her
    expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: 'admin' }))?.error ?? null).toBeNull();
    expect(await until(async () => ((await roleOf(B, B.pubKey)) === 'admin' ? true : null), { timeout: 20_000, step: 200 }), 'Bea never became admin').toBe(true);
  }, 120_000);
  afterAll(async () => { await teardown(A, B, D); await relay?.close?.(); });

  it('Dirk, missing from Anna\'s roster when she signed, holds her statement once his address lands on it', async () => {
    const annaPrior = A._routerRef.fn;
    const dirkPrior = D._routerRef.fn;
    try {
      // Anna is away: nothing reaches her while Dirk joins through Bea
      A._routerRef.fn = (env) => (env?.payload?.subtype === 'circle-address-announce' ? undefined : annaPrior?.(env));
      await joinExistingCircle(B, D, { groupId: GROUP, handle: 'dirk' });
      await bindCircleAddresses([B, D], GROUP);
      await Promise.all([B, D].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP })));
      const dirkAddr = D.agent.circleAddressFor(GROUP);
      expect((await readRoster(A, GROUP)).some((m) => (m.circleAddresses ?? [m.circleAddress]).includes(dirkAddr)), 'Anna already knew Dirk — the case proves nothing').toBe(false);
      // from here only a FAN can reach Dirk: his catch-up answers are dropped
      D._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_CATCHUP_SUBTYPES.batch ? undefined : dirkPrior?.(env));
      // Anna signs while her roster lacks Dirk's address (her outgoing fan still works; only her inbox is shut)
      expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: 'member' }))?.error ?? null).toBeNull();
      const mine = A.agent.circleAddressFor(GROUP);
      const s = await until(() => (A.agent.membershipRail.storedStatements(GROUP) ?? []).find((x) => x?.body?.author === mine && x.body.kind === 'role' && x.body.payload?.role === 'member') ?? null, { timeout: 10_000, step: 100 });
      expect(s, 'Anna signed nothing').toBeTruthy();
      // Anna is back: she catches up from Bea, and Dirk's address lands on her roster
      A._routerRef.fn = annaPrior;
      await A.membershipCatchUp.requestCircle(GROUP, { callSkill: (...x) => A.agent.callSkill(...x) });
      // …the admin who admitted him introduces his address again (Anna refuses his own envelopes until it is on her roster)
      await propagateCircleAddressesAfterJoin({ agent: B.agent, circleId: GROUP, newMemberWebid: D.pubKey, logger: { info() {}, warn() {}, log() {} } });
      const annaKnows = await until(async () => ((await readRoster(A, GROUP)).some((m) => (m.circleAddresses ?? [m.circleAddress]).includes(dirkAddr)) ? true : null), { timeout: 20_000, step: 250 });
      const rows = async (n) => (await readRoster(n, GROUP)).map((m) => `${String(m.webid).slice(0, 6)}:${m.role ?? '?'}:${(m.circleAddresses ?? [m.circleAddress]).filter(Boolean).map((a) => String(a).slice(-6)).join('/')}`);
      expect(annaKnows, `Anna never learned Dirk's address (…${String(dirkAddr).slice(-6)}, webid ${D.pubKey.slice(0, 6)}) — Anna's roster: ${JSON.stringify(await rows(A))}; Bea's: ${JSON.stringify(await rows(B))}; Anna's membership statements: ${(A.agent.membershipRail.storedStatements(GROUP) ?? []).length}, Bea's: ${(B.agent.membershipRail.storedStatements(GROUP) ?? []).length}`).toBe(true);
      const dirkHas = await until(() => ((D.agent.membershipRail.storedStatements(GROUP) ?? []).some((x) => x?.body?.hash === s.body.hash) ? true : null), { timeout: 20_000, step: 250 });
      expect(dirkHas, 'Dirk never received the statement Anna signed before his address reached her').toBe(true);
    } finally { A._routerRef.fn = annaPrior; D._routerRef.fn = dirkPrior; }
  }, 120_000);
});
