/**
 * TWO PERSONAS, ONE DEVICE, ONE CO-MEMBER OF BOTH — over a real relay (persona arc c3b2).
 *
 * A device is two people here: its default persona in circle X, persona B in circle Y. Cor is in both circles. What a
 * persona exists to prevent is Cor (or the relay) linking the two: so Cor sees two members with two webids, two
 * per-circle addresses and two commitments; the device holds a relay socket per persona; and what B says in Y arrives
 * as B. When B has no connection of its own, a message in Y does not leave at all — never on the default's socket —
 * and the bubble says why (`persona-no-connection`, retryable).
 *
 * Production here: the real factory (twice), the real relay transport, the create and join wizards' op paths (the join
 * AS a persona through `finalSubmit`'s bind), the circle chat fan through stoop, the delivery map the shells read.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
import { broadcastCircleFanOut } from '@onderling/kring-host/circleBroadcast';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown, readRoster,
} from './support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../src/v2/circleInvite.js';
import { EventLog } from '../src/eventLog.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';

const X = 'circle-x-default';
const Y = 'circle-y-persona';
const rowOf = (roster, webid) => roster.find((m) => (m?.webid ?? m?.id) === webid) ?? null;

describe('two personas of one device, seen by a co-member of both circles', () => {
  let relay; let dev; let cor; let B; let personaId;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [dev, cor] = await Promise.all([
      // WITH a device log, as every shell boots — the membership rail (what a member says about themself) exists only then
      bootRealAgentNode('dev', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
      bootRealAgentNode('cor', { agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } }),
    ]);
    await connectNodesOverRelay([dev, cor], { relayUrl: relay.url });
    personaId = (await dev.agent.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    B = dev.agent.persona(personaId);

    await createCircle(cor, { groupId: X, name: 'X' });
    await createCircle(cor, { groupId: Y, name: 'Y' });
    // X as the default — the join as it has always been
    await joinExistingCircle(cor, dev, { groupId: X, handle: 'anne' });
    // Y as persona B: on the relay on B's own socket, then the wizard's own path (finalSubmit binds before the redeem)
    expect((await dev.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId, relayUrl: relay.url })).ok).toBe(true);
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => cor.agent.callSkill(a, o, x), circleId: Y, adminPeerAddr: cor.pubKey });
    const joined = await joinCircleFromInvite({
      inviteUri: invite.uri, callSkill: (a, o, x) => dev.agent.callSkill(a, o, x), sendPeerRedeem: dev.sendPeerRedeem,
      handle: 'buurman', rulesAccepted: true, persona: personaId,
      circleAddressFor: (cid) => dev.agent.circleAddressFor(cid), signCircleLink: (s, d, a) => dev.agent.signCircleLink?.(s, d, a) ?? null,
    });
    expect(joined?.error ?? null, JSON.stringify(joined)).toBe(null);
    for (const n of [cor, dev]) {
      await bindCircleAddresses([n], X, Y);
      for (const c of [X, Y]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: c });
    }
  }, 120_000);

  afterAll(async () => {
    await teardown(dev, cor);
    await relay?.close?.();
  });

  it('Cor sees two members: two webids, two addresses, two commitments — nothing of A in B\'s row', async () => {
    const A = dev.agent.identity.chat.pubKey;
    expect(B.chatId.pubKey).not.toBe(A);
    const inX = await until(async () => rowOf(await readRoster(cor, X), A), { timeout: 15_000 });
    const inY = await until(async () => rowOf(await readRoster(cor, Y), B.chatId.pubKey), { timeout: 15_000 });
    expect(inX, 'the default is in X').toBeTruthy();
    expect(inY, 'B is in Y, as B').toBeTruthy();
    expect(rowOf(await readRoster(cor, Y), A), 'the default is NOT in Y').toBe(null);
    expect(dev.agent.circleAddressFor(Y)).not.toBe(dev.agent.circleAddressFor(X));
    expect(dev.agent.circleAddressFor(Y)).toBe(B.circleAddressFor(Y));
    const bRow = JSON.stringify(inY);
    for (const a of [A, dev.agent.circleAddressFor(X), dev.agent.persona('default').authorityPubKeyB64]) {
      if (a) expect(bRow.includes(a), `B's row carries none of A's public material (${a.slice(0, 8)}…)`).toBe(false);
    }
    expect(dev.agent.ceremonyCommitmentFor?.(Y) ?? null).not.toEqual(dev.agent.ceremonyCommitmentFor?.(X) ?? null);
  }, 60_000);

  it('the default\'s name reaches the default\'s circle and never B\'s', async () => {
    const A = dev.agent.identity.chat.pubKey;
    expect((await dev.agent.callSkill('stoop', 'setMyDisplayName', { displayName: 'Anne Standaard' }))?.error ?? null).toBe(null);
    const told = await until(async () => (rowOf(await readRoster(cor, X), A)?.displayName === 'Anne Standaard' ? true : null), { timeout: 15_000 });
    expect(told, 'X hears the default\'s name').toBe(true);
    // given the same time X needed and more, Y still has not heard it — on Cor's roster or on the device's own
    const leaked = await until(async () => {
      const there = JSON.stringify(await readRoster(cor, Y)) + JSON.stringify(await dev.agent.callSkill('stoop', 'listGroupMembers', { groupId: Y }));
      return there.includes('Anne Standaard') ? true : null;
    }, { timeout: 8_000, step: 250 });
    expect(leaked, 'Y never hears the default\'s name').toBe(null);
  }, 60_000);

  it('the device holds a relay socket per persona', () => {
    const sa = dev.agent.sa;
    expect(sa.relays.list({ identity: B.chatId.pubKey }).map((r) => r.url)).toEqual([relay.url]);
    expect(sa.relays.list().map((r) => r.url)).toEqual([relay.url]);
  });

  it('stoop\'s "me" in Y is B', async () => {
    expect((await dev.agent.callSkill('stoop', 'whoAmI', { groupId: Y }))?.webid).toBe(B.chatId.pubKey);
    expect((await dev.agent.callSkill('stoop', 'whoAmI', { groupId: X }))?.webid).toBe(dev.agent.identity.chat.pubKey);
  });

  it('B without a connection of its own: nothing leaves, and the bubble says why (retryable)', async () => {
    await dev.agent.sa.relays.remove(relay.url, { identity: B.chatId.pubKey });
    expect(dev.agent.sa.relays.list({ identity: B.chatId.pubKey })).toEqual([]);
    const map = createDeliveryStateMap();
    const rawCallSkill = (app, op, args) => dev.agent.callSkill(app, op, args);
    const msgId = `m-${Date.now()}`;
    const ts = Date.now();
    await broadcastCircleFanOut({
      rawCallSkill, circleId: Y, msgId, text: 'hallo buren', ts, deliveryStateMap: map,
      // the chat rail's sign-the-appended-entry hook, as the shells hand it
      signStatement: async (cid, id) => (await dev.chatRail.appendMessage(cid, { msgId: id, ts, text: 'hallo buren', actor: B.chatId.pubKey }))?.statement ?? null,
    });
    expect(map.get(msgId)).toBe('failed');
    expect(map.reasonOf(msgId)).toBe('persona-no-connection');
  }, 60_000);
});
