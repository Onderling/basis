/**
 * Story 5.1 / 9.1 DELIVERY half — a released persona property reaches co-members over the BUS, gated per
 * circle. The discloser-side release (5.1/5.3/5.6 core) is proven on a single node; the full delivery is proven
 * over a REAL relay (`releasePropagation.relay.test.js`). This is the missing corner: the SAME delivery over the
 * hermetic `connectNodesOverBus` harness, driven through the REAL `getPersonaRelease` path (not a hardcoded
 * `personaProperties`), with a CROSS-CIRCLE NEGATIVE — the one-persona-two-circles bleed check (story 9.1).
 *
 * The crossing is the `circle-address-announce` fan (NOT item-sync): `recordMemberPersonaProperties` on the
 * admin patches the admin's roster, and `broadcastCircleAddresses` carries the release to each member's
 * per-circle address; the receiver patches its OWN membership trail, so its `listGroupMembers` sees it.
 *
 * Boots with `allowAddressFallback: false` so delivery PROVES per-circle addressing (a missing address-bind
 * would throw / go undeliverable, naming the seam) rather than silently falling back to the global key.
 * Assertions read the RECEIVER's own roster (Anne / Yuri), never the admin's — the admin would pass trivially.
 *
 * Cast: Anna (admin of X and Y) · Cato (in BOTH; discloses realName to X only) · Anne (X, must receive) ·
 * Yuri (Y, must NOT — the name disclosed to X must not bleed into Y).
 *
 * This end-to-end path was UNBLOCKED by the #24 fix (`releaseFor` defaulting absent keys to the context's
 * disclosed keys): before it, `getPersonaRelease` with no keys returned {} and the fan carried nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { announcementsFromRoster } from '../../src/v2/circleAddressAnnounce.js';

const X = 'circle-x-release-bus';
const Y = 'circle-y-release-bus';
const NO_FALLBACK = { agentOpts: { allowAddressFallback: false } };
const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

async function settle(node, group) {
  await bindCircleAddresses([node], group);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId: group });
}

/** Admin records a member's release, then re-fans the roster (the crossing). Returns the fanned announcements. */
async function recordAndFan(admin, group, memberWebid, released) {
  const rec = await admin.agent.callSkill('stoop', 'recordMemberPersonaProperties', {
    groupId: group, memberWebid, personaProperties: released ?? {},
  });
  expect(rec?.ok, `record on ${group}`).toBe(true);
  const announcements = announcementsFromRoster({ members: await readRoster(admin, group), circleId: group });
  await admin.agent.callSkill('stoop', 'broadcastCircleAddresses', { groupId: group, announcements });
  return announcements;
}

describe('release propagation over the BUS — per-circle gated delivery to a third device (5.1 / 9.1)', () => {
  let admin; let cato; let anne; let yuri;

  beforeAll(async () => {
    [admin, cato, anne, yuri] = await Promise.all([
      bootRealAgentNode('admin', NO_FALLBACK), bootRealAgentNode('cato', NO_FALLBACK),
      bootRealAgentNode('anne', NO_FALLBACK), bootRealAgentNode('yuri', NO_FALLBACK),
    ]);
    await connectNodesOverBus([admin, cato, anne, yuri]);

    // Circle X — admin, cato, anne
    await createCircle(admin, { groupId: X, name: 'Circle X' });
    await settle(admin, X);
    expect((await joinExistingCircle(admin, cato, { groupId: X, handle: 'cato' })).joined.ok).toBe(true);
    await settle(cato, X);
    expect((await joinExistingCircle(admin, anne, { groupId: X, handle: 'anne' })).joined.ok).toBe(true);
    await settle(anne, X);

    // Circle Y — admin, cato (SAME person, second circle), yuri
    await createCircle(admin, { groupId: Y, name: 'Circle Y' });
    await settle(admin, Y);
    expect((await joinExistingCircle(admin, cato, { groupId: Y, handle: 'cato-y' })).joined.ok).toBe(true);
    await settle(cato, Y);
    expect((await joinExistingCircle(admin, yuri, { groupId: Y, handle: 'yuri' })).joined.ok).toBe(true);
    await settle(yuri, Y);

    // The address fan must have reached the receivers before we ask about the release riding it.
    await until(async () => rowFor(await readRoster(anne, X), cato.pubKey)?.circleAddress, { timeout: 15000 });
    await until(async () => rowFor(await readRoster(yuri, Y), cato.pubKey)?.circleAddress, { timeout: 15000 });
  }, 120000);

  afterAll(async () => { try { await teardown(admin, cato, anne, yuri); } catch { /* best-effort */ } });

  it('Cato discloses realName to X only → the REAL release carries it and Anne (X) receives it on her own roster', async () => {
    await cato.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Catharina' });
    await cato.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: X, key: 'realName', enabled: true });

    // The #24-fixed no-keys release carries exactly what Cato disclosed in X (the delivery this test exists for).
    const relX = await cato.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: X });
    expect(relX?.released?.realName, 'the source release carries the disclosed name').toBe('Catharina');

    await recordAndFan(admin, X, cato.pubKey, relX.released);

    // Anne's OWN roster (device-local trail, patched by the fan) holds Cato's released name.
    const anneRow = await until(async () => {
      const row = rowFor(await readRoster(anne, X), cato.pubKey);
      return row?.personaProperties?.realName ? row : null;
    }, { timeout: 15000 });
    expect(anneRow.personaProperties.realName).toBe('Catharina');
    expect(anneRow.circleAddress, 'the release rode ALONGSIDE the address, not instead of it').toBeTruthy();
  }, 90000);

  it('5.3 delivery — an UPDATE to the disclosed name re-fans and Anne sees the NEW value (propagation ≠ read path)', async () => {
    // Cato changes his disclosed name; the release carries the update, and a re-fan must land the NEW value on
    // Anne's roster — the "update propagates reveal-gated" catch, over the wire.
    await cato.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Catharina Bakker' });
    const relX = await cato.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: X });
    expect(relX?.released?.realName).toBe('Catharina Bakker');

    await recordAndFan(admin, X, cato.pubKey, relX.released);

    const updated = await until(async () => {
      const row = rowFor(await readRoster(anne, X), cato.pubKey);
      return row?.personaProperties?.realName === 'Catharina Bakker' ? row : null;
    }, { timeout: 15000 });
    expect(updated.personaProperties.realName).toBe('Catharina Bakker');
  }, 90000);

  it('Cato never disclosed in Y → the Y release is empty and Yuri (Y) never holds the name (no cross-context bleed, 9.1)', async () => {
    // Cato disclosed realName to X only. The per-circle gate means the Y release is empty — the #24 default
    // respects the context, so nothing to fan for Cato in Y.
    const relY = await cato.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: Y });
    expect(relY?.released?.realName, 'nothing disclosed in Y ⇒ empty release').toBeUndefined();

    const anns = await recordAndFan(admin, Y, cato.pubKey, relY.released);
    expect(anns.find((x) => x.memberWebid === cato.pubKey)?.personaProperties,
      'Cato\'s Y announcement carries NO release').toBeUndefined();

    // Give the fan time; Yuri's OWN Y roster must hold no name for Cato — X's disclosure did not bleed into Y.
    await new Promise((r) => setTimeout(r, 800));
    const yuriRow = rowFor(await readRoster(yuri, Y), cato.pubKey);
    expect(yuriRow?.personaProperties?.realName ?? null,
      'the name disclosed to X must NOT appear on a Y member\'s roster').toBeNull();
  }, 90000);
});
