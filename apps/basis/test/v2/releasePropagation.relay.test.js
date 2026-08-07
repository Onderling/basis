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
import { startRelay } from '@onderling/relay';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { announcementsFromRoster } from '../../src/v2/circleAddressAnnounce.js';

const GROUP = 'buurt-release-prop';
async function settle(node) {
  await bindCircleAddresses([node], GROUP);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId: GROUP });
}
const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('a released name reaches co-members (real relay, three devices)', () => {
  let relay; let relayUrl;
  let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    [admin, bram, cato] = await Promise.all([
      bootRealAgentNode('admin'), bootRealAgentNode('bram'), bootRealAgentNode('cato'),
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
    // Bram discloses his name to THIS circle (the admin is the roster authority that records it —
    // exactly what a `full` join or a post-join "share to this circle" lands on the admin).
    const rec = await admin.agent.callSkill('stoop', 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: bram.pubKey, personaProperties: { realName: 'Bram de Wit' },
    });
    expect(rec?.ok).toBe(true);

    // The admin re-fans the roster; the announcement now carries Bram's release alongside his address.
    const roster = await readRoster(admin, GROUP);
    const announcements = announcementsFromRoster({ members: roster, circleId: GROUP });
    expect(announcements.find((x) => x.memberWebid === bram.pubKey)?.personaProperties?.realName,
      'the admin fan carries the release').toBe('Bram de Wit');
    await admin.agent.callSkill('stoop', 'broadcastCircleAddresses', { groupId: GROUP, announcements });

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
    // Cato never disclosed a name. The admin's fan of Cato's row carries no release, so no co-member
    // ever holds a name for Cato — the source gate is structural (an empty release travels as nothing).
    const roster = await readRoster(admin, GROUP);
    const catoAnn = announcementsFromRoster({ members: roster, circleId: GROUP })
      .find((x) => x.memberWebid === cato.pubKey);
    expect(catoAnn, 'Cato is announced (address)').toBeTruthy();
    expect(catoAnn.personaProperties, 'but with NO release — nothing to fan').toBeUndefined();

    await admin.agent.callSkill('stoop', 'broadcastCircleAddresses',
      { groupId: GROUP, announcements: announcementsFromRoster({ members: roster, circleId: GROUP }) });
    // Give the fan time, then confirm Bram's device holds no name for Cato.
    await new Promise((r) => setTimeout(r, 800));
    const bramCato = rowFor(await readRoster(bram, GROUP), cato.pubKey);
    expect(bramCato?.personaProperties ?? null, 'Cato disclosed nothing, so nobody holds a name').toBeNull();
  }, 60000);
});
