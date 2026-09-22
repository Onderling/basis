/**
 * A released name reaches co-members — over a REAL relay, three real devices.
 *
 * The roster projection already shares who is in a circle and how to reach them (the
 * `circle-address-announce` fan). It was INCOMPLETE by one field: a member's per-circle RELEASE
 * (what they chose to disclose here) reached the admin and stopped. This completes that crossing —
 * the release rides the same announcement, carried under the same roster-level trust as the address's
 * member attribution, gated at the source (a row holds only what its member released).
 *
 * Proven end-to-end, not by unit: three `createRealHouseholdAgent` nodes on a started relay, two real
 * joins through the peer bridge, then the admin re-fans the roster — and Cato's device must end up
 * holding Bram's released name, while a member who released NOTHING stays a handle to everyone.
 *
 * Cast: Anna (admin) · Bram (releases his name to the circle) · Cato (must receive it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { shareDisclosureToCircle, createDisclosureShareMemo } from '../../src/core/handlers/personaPropsUpdate.js';

const GROUP = 'circle-release-prop';
async function settle(node) {
  await bindCircleAddresses([node], GROUP);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId: GROUP });
}
const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('a released name reaches co-members (real relay, three devices)', () => {
  let relay; let relayUrl;
  let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    [admin, bram, cato] = await Promise.all([
      bootRealAgentNode('admin', { taskLane: true }), bootRealAgentNode('bram', { taskLane: true }), bootRealAgentNode('cato', { taskLane: true }),
    ]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl });

    await createCircle(admin, { groupId: GROUP, name: 'Release Circle' });
    await settle(admin);
    expect((await joinExistingCircle(admin, bram, { groupId: GROUP, handle: 'bram' })).joined.ok).toBe(true);
    await settle(bram);
    expect((await joinExistingCircle(admin, cato, { groupId: GROUP, handle: 'cato' })).joined.ok).toBe(true);
    await settle(cato);

    // The address fan must have reached both ways before we ask about the release riding it.
    await until(async () => rowFor(await readRoster(cato, GROUP), bram.pubKey)?.circleAddress, { timeout: 15000 });
    await until(async () => rowFor(await readRoster(bram, GROUP), cato.pubKey)?.circleAddress, { timeout: 15000 });
  }, 90000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it("Bram releases his name to the circle → Cato's device HOLDS 'Bram de Wit'", async () => {
    // Bram discloses his name to THIS circle and says so himself: one `member-props` statement on the circle's
    // membership lane (what "share to this circle" runs since 2026-09-22 — no admin in the loop).
    await bram.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Bram de Wit' });
    await bram.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: GROUP, key: 'realName', enabled: true });
    const said = await shareDisclosureToCircle({
      callSkill: (app, op, args) => bram.agent.callSkill(app, op, args),
      emitMemberProps: (a) => bram.agent.emitMemberProps(a),
      circleId: GROUP, personaId: 'default', lastShared: createDisclosureShareMemo(),
    });
    expect(said, JSON.stringify(said)).toMatchObject({ ok: true, via: 'lane' });

    // …and it lands on Cato's device, on Bram's row — the released name crossed the wire.
    const catoBram = await until(async () => {
      const row = rowFor(await readRoster(cato, GROUP), bram.pubKey);
      return row?.personaProperties?.realName ? row : null;
    }, { timeout: 15000 });
    expect(catoBram.personaProperties.realName).toBe('Bram de Wit');
    // The reveal ladder on Cato's device now shows it (released ⇒ visible to a member).
    expect(catoBram.circleAddress, "Bram's address is still there — the release rode ALONGSIDE it").toBeTruthy();
  }, 60000);

  it('Cato, who released NOTHING, stays a handle to everyone — no name is conjured', async () => {
    // Cato never disclosed a name, so his release is empty and there is nothing to say: the source gate is
    // structural, and no co-member ever holds a name for him.
    const said = await shareDisclosureToCircle({
      callSkill: (app, op, args) => cato.agent.callSkill(app, op, args),
      emitMemberProps: (a) => cato.agent.emitMemberProps(a),
      circleId: GROUP, personaId: 'default', lastShared: createDisclosureShareMemo(),
    });
    expect(said, 'an empty release says nothing at all').toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 800));
    const bramCato = rowFor(await readRoster(bram, GROUP), cato.pubKey);
    expect(bramCato?.personaProperties ?? null, 'Cato disclosed nothing, so nobody holds a name').toBeNull();
  }, 60000);
});
