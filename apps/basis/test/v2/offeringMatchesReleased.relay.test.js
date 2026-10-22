/**
 * WHO OFFERS IT — matched from what a member RELEASED, never from what they hold.
 *
 * Offerings are persona drivers (kind 'offering') since 2026-10-15; a co-member learns one only from the member's
 * release for the circle. The matcher read `offerings` and nothing turned the release into that, so every member
 * match (/find's, and an ask's) came back empty. Two members over a real relay: Bram sets two offerings, releases ONE
 * to the circle; the asker's matcher, over her own roster, finds Bram for the released one and nothing for the other.
 */
import { it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { shareDisclosureToCircle, createDisclosureShareMemo } from '../../src/core/handlers/personaPropsUpdate.js';
import { findOfferingMatches } from '@onderling/kring-host/findOfferingMatches';
import { normalizeCircleMembers } from '@onderling/kring-host/circleMembers';

const G = 'offer-released';
let relay; let A; let B;
afterAll(async () => { await teardown(A, B); await relay?.stop?.(); });

it("the asker's matcher finds a member for what they released — and never for what they did not", async () => {
  relay = await startJourneyRelay();
  [A, B] = await Promise.all([bootRealAgentNode('asker', { taskLane: true }), bootRealAgentNode('offerer', { taskLane: true })]);
  await connectNodesOverRelay([A, B], { relayUrl: relay.url });
  await createCircle(A, { groupId: G, name: 'Straat' });
  await bindCircleAddresses([A], G); await bindCircleAddressKeysFor({ agent: A.agent, circleId: G });
  expect((await joinExistingCircle(A, B, { groupId: G, handle: 'bram' })).joined.ok).toBe(true);
  await bindCircleAddresses([B], G); await bindCircleAddressKeysFor({ agent: B.agent, circleId: G });

  const set = (key, text) => B.agent.callSkill('agents', 'setProfileDriver', { id: 'default', key, kind: 'offering', text, tags: '' });
  expect((await set('dogwalk', 'Walk your dog')).ok).toBe(true);
  expect((await set('ladder', 'Lend a ladder')).ok).toBe(true);
  // only the dog walk is released to this circle
  expect((await B.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: G, key: 'dogwalk', enabled: true })).ok).toBe(true);
  const said = await shareDisclosureToCircle({
    callSkill: (a, o, x) => B.agent.callSkill(a, o, x), emitMemberProps: (a) => B.agent.emitMemberProps(a),
    circleId: G, personaId: 'default', lastShared: createDisclosureShareMemo(),
  });
  expect(said).toMatchObject({ ok: true });
  await until(async () => ((await readRoster(A, G)).find((m) => m.webid === B.pubKey)?.personaProperties?.dogwalk ? true : null), { timeout: 15000 });

  const members = normalizeCircleMembers(await A.agent.callSkill('pinboard', 'listGroupMembers', { groupId: G }));
  const dog = findOfferingMatches({ query: 'dog walk', members });
  expect(dog.map((m) => [m.id, m.skill])).toEqual([[B.pubKey, 'Walk your dog']]);
  const ladder = findOfferingMatches({ query: 'ladder', members });
  expect(ladder, 'an offering Bram never released is matched by nobody').toEqual([]);
}, 120000);
