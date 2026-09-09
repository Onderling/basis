/**
 * A DIRECT MESSAGE REACHES THE PERSON, NOT ONE OF THEIR DEVICES — over a real relay.
 *
 * The gap this walks: a contact card carries the PROFILE's chat address, which every device of the
 * profile derives from the same seed, and a relay maps one address to one socket. So a turn arrives
 * at ONE of a person's devices and the others never learn it happened — until the device that got it
 * hands it on, which is what this asserts, in both directions and over a real socket.
 *
 * Three parties, one relay: Anna's phone, Anna's always-on machine (a second device enrolled from her
 * one recovery phrase), and Bea, who is a contact. Both of Anna's devices share a circle with Bea,
 * because a sibling is reached at its proven per-circle address — a person in no circles has no
 * sibling addresses at all, which is the designed floor and the reason the setup pairs a circle
 * before it says anything about messages.
 *
 * ── One thing this walk deliberately does not paper over ────────────────────────────────────────
 * Two devices of one profile REGISTER THE SAME ADDRESS, and the relay keeps the last registration. A
 * contact who has already greeted the first device then sends to a socket belonging to the second,
 * which has never greeted them, and the security layer refuses the envelope as an unknown sender —
 * silently, because nothing anywhere listens for that refusal. The cost of two devices sharing one
 * address is therefore not "the other device misses a message", it is "the message is refused". That
 * is what naming ONE device as the always-on one is for, and it is a separate change; the order of
 * events here simply keeps both of Anna's devices known to Bea, which is what a running system looks
 * like once they have spoken once.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND } from '@onderling/core';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { CONTACT_TURN_BROADCAST } from '../src/v2/contactTurnFan.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'contact-turn-fan-circle';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

/** The turns the durable thread with one contact holds on this device — what the thread UI reads. */
const threadWith = async (node, contactId) => (await node.contactThreadChannel.rehydrate(contactId)) ?? [];
const textsIn = async (node, contactId) => (await threadWith(node, contactId)).map((t) => t.text);

describe('a contact-thread turn reaches the person\'s other devices', () => {
  let relay; let relayUrl; let phone; let alwaysOn; let bea;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;

    const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
    phone = await bootRealAgentNode('phone', {
      contactChannel: true,
      agentOpts: { ...vaults(), deviceLog: new EventLog({ initial: [], muted: [] }) },
    });
    bea = await bootRealAgentNode('bea', { contactChannel: true });
    await connectNodesOverRelay([phone, bea], { relayUrl });
    await pairCircle(phone, bea, { groupId: GROUP, name: 'Contact turn walk', handle: 'bea' });
    await bindCircleAddresses([phone, bea], GROUP);

    // Anna's second device: the ceremony runs on the NEW device (the phrase is typed there, never
    // sent), then it boots as her — one person, its own per-circle keys.
    const secondVaults = vaults();
    const pre = await bootRealAgentNode('always-on-pre', { agentOpts: secondVaults });
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'always-on' });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);
    alwaysOn = await bootRealAgentNode('always-on', {
      contactChannel: true,
      agentOpts: { ...secondVaults, deviceLog: new EventLog({ initial: [], muted: [] }) },
    });
    expect(alwaysOn.pubKey, 'the second device is not the same person').toBe(phone.pubKey);
    await connectNodesOverRelay([alwaysOn], { relayUrl });
    await bindCircleAddresses([alwaysOn], GROUP);

    // Each device announces its proven per-circle address into the other's roster row, which is what
    // grows the address SET the sibling lookup reads. Without this they are two strangers who happen
    // to hold the same key.
    const announce = async (from, to) => {
      await from.agent.sendPeerMessage(to.agent.circleAddressFor(GROUP), {
        type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: GROUP,
        msgId: `announce-${from.label}`, ts: Date.now(),
        announcements: [ownAnnouncementFor({ agent: from.agent, circleId: GROUP })],
      }, SEND);
    };
    await announce(alwaysOn, phone);
    await announce(phone, alwaysOn);

    const knows = async (node, otherAddr) => until(async () => {
      const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      const row = (res?.members ?? []).find((m) => m.webid === node.pubKey);
      return row?.circleAddresses?.includes(otherAddr) ? row : null;
    }, { timeout: 20000, step: 100 });
    expect(await knows(phone, alwaysOn.agent.circleAddressFor(GROUP)),
      'the phone never learned the always-on device\'s address').toBeTruthy();
    expect(await knows(alwaysOn, phone.agent.circleAddressFor(GROUP)),
      'the always-on device never learned the phone\'s address').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await teardown(phone, alwaysOn, bea);
    try { await relay?.close?.(); } catch { /* the relay may already be down */ }
  });

  it('what Anna writes on her always-on device is in the thread on her phone', async () => {
    await alwaysOn.contactThreadChannel.sendTurn({
      peerAddr: bea.pubKey, threadId: bea.pubKey, text: 'ik ben er morgen', messageId: 'anna-1',
    }).sent;

    // Bea got it: the fan is an addition to the send, never a detour around it.
    const arrived = await until(async () =>
      (await textsIn(bea, phone.pubKey)).includes('ik ben er morgen') ? true : null,
    { timeout: 20000, step: 100 });
    expect(arrived, 'Bea never received the message at all').toBe(true);

    // …and so did Anna's other device, which took no part in that send.
    const carried = await until(async () =>
      (await textsIn(phone, bea.pubKey)).includes('ik ben er morgen') ? true : null,
    { timeout: 20000, step: 100 });
    expect(carried, 'the phone never saw what the always-on device sent').toBe(true);
    expect(phone.contactTurnsSeen.at(-1).origin, 'a message Anna sent is her own side of the thread').toBe('user');
  }, 120_000);

  it('Bea\'s reply arrives at one device and is readable on the other', async () => {
    await bea.contactThreadChannel.sendTurn({
      peerAddr: phone.pubKey,            // the PERSON's address — what a contact card carries
      threadId: bea.pubKey,
      text: 'fijn, tot morgen',
      messageId: 'bea-1',
    }).sent;

    // WHICH device received it — established, not assumed. The relay resolves the profile address to
    // ONE socket, so a later failure cannot be misread as "the fan is broken".
    const landedOn = await until(async () => {
      if ((await textsIn(alwaysOn, bea.pubKey)).includes('fijn, tot morgen')) return alwaysOn;
      if ((await textsIn(phone, bea.pubKey)).includes('fijn, tot morgen')) return phone;
      return null;
    }, { timeout: 20000, step: 100 });
    expect(landedOn, 'the reply reached neither of Anna\'s devices').toBeTruthy();

    const other = landedOn === alwaysOn ? phone : alwaysOn;
    const carried = await until(async () =>
      (await textsIn(other, bea.pubKey)).includes('fijn, tot morgen') ? true : null,
    { timeout: 20000, step: 100 });
    expect(carried, `the reply landed on ${landedOn.label} and never reached ${other.label}`).toBe(true);
    expect(other.contactTurnsSeen.map((t) => t.text)).toContain('fijn, tot morgen');
    expect(other.contactTurnsSeen.at(-1).origin, 'a message FROM Bea is the other side of the thread').toBe('bot');
  }, 120_000);

  it('the same turn arriving twice is stored once', async () => {
    const before = (await threadWith(phone, bea.pubKey)).length;
    const seenBefore = phone.contactTurnsSeen.length;
    await alwaysOn.agent.sendPeerMessage(phone.agent.circleAddressFor(GROUP), {
      subtype: CONTACT_TURN_BROADCAST,
      turn: { direction: 'in', contactId: bea.pubKey, fromAddr: bea.pubKey, text: 'fijn, tot morgen', messageId: 'bea-1' },
    }, SEND);

    // Wait for the wire to go quiet rather than for a value: a dedup that is merely slow would pass a
    // bare "nothing yet" check.
    await new Promise((r) => setTimeout(r, 2500));
    expect((await threadWith(phone, bea.pubKey)).length, 'a replayed turn was stored a second time').toBe(before);
    expect(phone.contactTurnsSeen.length, 'a replayed turn was painted a second time').toBe(seenBefore);
  }, 60_000);

  it('a turn fanned by someone who is not one of Anna\'s devices is refused', async () => {
    const before = await textsIn(phone, bea.pubKey);
    await bea.agent.sendPeerMessage(phone.pubKey, {
      subtype: CONTACT_TURN_BROADCAST,
      turn: { direction: 'in', contactId: 'someone-else', fromAddr: 'someone-else', text: 'ik ben jouw laptop', messageId: 'forged-1' },
    }, SEND);

    const refused = await until(async () => {
      for (const n of [phone, alwaysOn]) {
        const hit = n.contactTurnsRefused.find((r) => r.reason === 'not-a-sibling');
        if (hit) return { node: n, hit };
      }
      return null;
    }, { timeout: 20000, step: 100 });
    expect(refused, 'a stranger\'s fan was not refused').toBeTruthy();
    expect(refused.hit.fromAddr).toBe(bea.pubKey);
    expect(await textsIn(refused.node, 'someone-else'), 'a refused turn still reached a thread').toEqual([]);
    expect(await textsIn(phone, bea.pubKey), 'a refused turn disturbed the real thread').toEqual(before);
  }, 60_000);
});
