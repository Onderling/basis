/**
 * AN ITEM AND A CHAT MESSAGE FANNED TO A SHORT ROSTER REACH THE MEMBER WHO WAS MISSING FROM IT, ONCE THEIR ADDRESS LANDS.
 *
 * The membership lane has had this since the late-recipient re-tell (lateRecipient.relay.test.js); the content lanes had
 * not. With the address-fallback setting off (the default), a member whose circle address this device does not hold yet
 * is reached NOWHERE — not held, simply not sent — so a list entry or a chat line written in that moment never reaches
 * them by a fan. The shape seen with the household bot: it joins a circle, writes for Ann before her address has landed
 * on its roster, and Ann never sees the entry. Here: Anna is away while Dirk joins through Bea; Anna writes a list and a
 * chat line, which her fan cannot carry to Dirk; Dirk's catch-ups are held off so only a fan could reach him. When Dirk's
 * address lands on Anna's roster, both must reach him — sent as the circle, never at his global key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, joinExistingCircle, bindCircleAddresses, until, teardown, readRoster, sendCircleChat,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { MEMBERSHIP_CATCHUP_SUBTYPES } from '../src/v2/membershipRail.js';
import { ITEMS_CATCHUP_SUBTYPES } from '../src/v2/itemsRail.js';
import { CHAT_CATCHUP_SUBTYPES } from '../src/v2/chatRail.js';
import { propagateCircleAddressesAfterJoin } from '../src/v2/circleAddressAnnounce.js';

const GROUP = 'late-recipient-content';
const roleOf = async (node, webid) => (await readRoster(node, GROUP)).find((m) => m.webid === webid)?.role ?? null;
const CATCHUP_BATCHES = new Set([MEMBERSHIP_CATCHUP_SUBTYPES.batch, ITEMS_CATCHUP_SUBTYPES.batch, CHAT_CATCHUP_SUBTYPES.batch]);

describe('content fanned to a short roster', () => {
  let relay; let A; let B; let D;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    A = await bootRealAgentNode('anna', { itemsLane: true, agentOpts: { allowAddressFallback: false } });
    B = await bootRealAgentNode('bea', { itemsLane: true });
    D = await bootRealAgentNode('dirk', { itemsLane: true });
    await connectNodesOverRelay([A, B, D], { relayUrl: relay.url });
    await pairCircle(A, B, { groupId: GROUP, name: 'Laat', handle: 'bea' });
    await bindCircleAddresses([A, B], GROUP);
    expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: 'admin' }))?.error ?? null).toBeNull();
    expect(await until(async () => ((await roleOf(B, B.pubKey)) === 'admin' ? true : null), { timeout: 20_000, step: 200 }), 'Bea never became admin').toBe(true);
  }, 120_000);
  afterAll(async () => { await teardown(A, B, D); await relay?.close?.(); });

  it("Dirk, missing from Anna's roster when she wrote, holds her list and her chat line once his address lands on it", async () => {
    const annaPrior = A._routerRef.fn;
    const dirkPrior = D._routerRef.fn;
    try {
      // Anna is away: no address announce reaches her while Dirk joins through Bea
      A._routerRef.fn = (env) => (env?.payload?.subtype === 'circle-address-announce' ? undefined : annaPrior?.(env));
      await joinExistingCircle(B, D, { groupId: GROUP, handle: 'dirk' });
      await bindCircleAddresses([B, D], GROUP);
      await Promise.all([B, D].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP })));
      const dirkAddr = D.agent.circleAddressFor(GROUP);
      expect((await readRoster(A, GROUP)).some((m) => (m.circleAddresses ?? [m.circleAddress]).includes(dirkAddr)), 'Anna already knew Dirk — the case proves nothing').toBe(false);
      // from here only a FAN can reach Dirk: his catch-up answers on every lane are dropped
      D._routerRef.fn = (env) => (CATCHUP_BATCHES.has(env?.payload?.subtype) ? undefined : dirkPrior?.(env));

      // Anna writes while her roster lacks Dirk's address
      const made = await A.agent.callSkill('lists', 'createList', { text: 'Boodschappen', circleId: GROUP });
      expect(made?.ok, JSON.stringify(made)).not.toBe(false);
      const sent = await sendCircleChat(A, { groupId: GROUP, msgId: 'anna-late-1', text: 'wie haalt er brood?' });
      expect(sent?.error ?? null, JSON.stringify(sent)).toBe(null);
      // Bea, whom Anna does reach, has both — the writes went out
      const beaHasList = await until(async () => (JSON.stringify(await B.agent.callSkill('lists', 'listLists', { circleId: GROUP })).includes('Boodschappen') ? true : null), { timeout: 20_000, step: 250 });
      expect(beaHasList, "Bea never got Anna's list — the fan did not run at all").toBe(true);

      // Anna is back: Dirk's address lands on her roster (the admin who admitted him introduces it again)
      A._routerRef.fn = annaPrior;
      await A.membershipCatchUp.requestCircle(GROUP, { callSkill: (...x) => A.agent.callSkill(...x) });
      await propagateCircleAddressesAfterJoin({ agent: B.agent, circleId: GROUP, newMemberWebid: D.pubKey, logger: { info() {}, warn() {}, log() {} } });
      const annaKnows = await until(async () => ((await readRoster(A, GROUP)).some((m) => (m.circleAddresses ?? [m.circleAddress]).includes(dirkAddr)) ? true : null), { timeout: 20_000, step: 250 });
      expect(annaKnows, "Anna never learned Dirk's address — the re-tell has nothing to answer to").toBe(true);

      const dirkHasList = await until(async () => (JSON.stringify(await D.agent.callSkill('lists', 'listLists', { circleId: GROUP })).includes('Boodschappen') ? true : null), { timeout: 20_000, step: 250 });
      expect(dirkHasList, 'Dirk never received the list Anna wrote before his address reached her').toBe(true);
      const dirkHasChat = await until(() => (D.chatRail.storedStatements(GROUP).some((s) => s?.body?.payload?.text === 'wie haalt er brood?') ? true : null), { timeout: 20_000, step: 250 });
      expect(dirkHasChat, 'Dirk never received the chat line Anna wrote before his address reached her').toBe(true);
    } finally { A._routerRef.fn = annaPrior; D._routerRef.fn = dirkPrior; }
  }, 120_000);
});
