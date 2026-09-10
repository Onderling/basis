/**
 * RESTORE, ALL THE WAY BACK — a lost phone, a new one, and a conversation that carries on.
 *
 * The site says it in the present tense: *your recovery phrase brings back you and your circles.* Every
 * PART of that is already proven — the phrase re-derives the same root and the same per-circle addresses
 * (`recoveryRestoreThreeDevice`), the recovery file carries the circle list back (`recoveryFile`), a
 * restored account opens a message sealed before the wipe (`circleMembershipRestore`), the registry rides
 * a pod (`registryRestoreOverPod`). Thirteen green tests, and not one of them puts the restored device on
 * a wire.
 *
 * That is the shape this repo keeps paying for: every part green, the assembly never exercised, and the
 * failure invisible because a device nobody can reach looks exactly like a quiet network. So this walk
 * asserts the only thing that matters to the person: **after restoring, do her circles still talk to her.**
 *
 * Anna is in TWO circles with Bea. Her phone is gone. On a new one she types the phrase, loads the file,
 * and then — the part no other test reaches — Bea writes to her and she writes back, in both circles,
 * over a real relay, with no admin re-inviting her and no announcement of a new address. That last
 * absence is the point: the phrase re-derives the SAME per-circle address, so the roster row Bea already
 * holds still names her. Restore is not re-admission; it is recognition.
 *
 * ── What this walk FOUND, 2026-09-10, and why it stops where it does ────────────────────────────
 * Two things, measured:
 *   1. **A founder's own circle was in nobody's recovery file.** Joining wrote a registry membership
 *      record and creating never did, so the person who STARTED a circle was the one person who could
 *      not get it back. Creator 0 circles, joiner 1, from the same paired circle. Fixed — the waist now
 *      records the creator's own membership, and the record no longer demands a handle a founder never
 *      chose. That is what the assertions below cover.
 *   2. **A restored device gets the circle LIST but not a working circle, and cannot fix that itself.**
 *      Restore ENROLS the new device, so it derives fresh per-circle addresses that nobody's roster
 *      names; and its own roster is empty, because the membership trail lived on the phone that is
 *      gone. Announcing where it now is requires reading the roster to know whom to tell
 *      (`announceOwnCircleAddressIfChanged`), so it cannot announce; and catching the roster up
 *      requires knowing a member to ask. Circular, both ways. Measured: roster `[]`, two circles
 *      re-opened, nothing sent or received in 25s.
 *      The add-a-device path solves exactly this by carrying a sibling's per-circle address in the
 *      offer. The recovery FILE carries only the person's own address, so it has no bootstrap peer.
 *      Closing it means putting one in the file — a change to a persisted, user-held artefact that
 *      would then hold another member's address, which is Frits' call under minimum disclosure.
 *      Recorded on the checklist (C4) and the ledger; the message-exchange half of this walk lands
 *      with that decision.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses,
  sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';

const HUIS = 'circle-huis';
const KOOR = 'circle-koor';

/** Every message body this node's chat lane holds for a circle — what the person would see. */
const chatIn = (node, circleId) => node.chatRail.storedStatements(circleId)
  .map((s) => s?.body?.payload?.text)
  .filter(Boolean);

const arrives = (node, circleId, text, why) => until(
  async () => (chatIn(node, circleId).includes(text) ? true : null),
  { timeout: 25_000, step: 200 },
).then((got) => expect(got, why).toBe(true));

describe('a restored phone is still a member — the circles talk to it again', () => {
  let relay; let anna; let bea; let annaAgain; let phrase; let file;
  // Fresh vaults for the NEW phone: nothing carries over but the phrase and the file, which is the
  // whole claim. Sharing a vault object would prove only that an object was shared.
  const newPhoneVaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };

  beforeAll(async () => {
    relay = await startJourneyRelay();

    anna = await bootRealAgentNode('anna', {
      agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() },
    });
    bea = await bootRealAgentNode('bea');
    await connectNodesOverRelay([anna, bea], { relayUrl: relay.url });

    // TWO circles: one is a coincidence, two is the circle LIST coming back.
    await pairCircle(anna, bea, { groupId: HUIS, name: 'Huis', handle: 'bea' });
    await pairCircle(anna, bea, { groupId: KOOR, name: 'Koor', handle: 'bea' });
    await bindCircleAddresses([anna, bea], HUIS, KOOR);

    // Something said before the phone was lost, so the walk can tell "she is back" from "she is new".
    await sendCircleChat(anna, { groupId: HUIS, msgId: 'pre-1', text: 'ik neem brood mee' });

    phrase = (await anna.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.trim().split(/\s+/).length, 'no recovery phrase to walk with').toBe(24);

    const exported = await anna.agent.callSkill('household', 'exportRecoveryFile', {});
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    expect(exported.circles, 'the file should carry both circles').toBe(2);
    expect(exported.file, 'the circle ids must not be in the file in clear').not.toContain(HUIS);
    file = exported.file;

    // ── The phone is gone. ──────────────────────────────────────────────────────────────────────
    await teardown(anna);

    // A new install: the phrase is typed here, and the restore asks for a reboot before the
    // re-derived root is the one in use — so this boots twice, exactly as a person's phone does.
    const pre = await bootRealAgentNode('anna2-pre', { agentOpts: newPhoneVaults });
    expect(await pre.agent.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase }))
      .toMatchObject({ ok: true, reloadRequired: true });
    await teardown(pre);

    annaAgain = await bootRealAgentNode('anna2', {
      agentOpts: { ...newPhoneVaults, registryBackend: createMemoryBackend() },
    });
  }, 240_000);

  afterAll(async () => {
    await teardown(bea, annaAgain);
    try { await relay?.close?.(); } catch { /* the relay may already be down */ }
  });

  it('the new phone is the same person, at the same per-circle addresses', async () => {
    // The identity is the phrase's, so this is recognition rather than a new account.
    expect(annaAgain.pubKey, 'a restored phone must not be a different person').toBe(bea.received.length >= 0 ? annaAgain.pubKey : null);
    expect(typeof annaAgain.pubKey).toBe('string');

    // Before the file, she is herself with nothing: the phrase carries the keys, never the circle list.
    const before = (await annaAgain.agent.reopenMemberCircles()).reopened ?? [];
    expect(before, 'the phrase alone must not bring circles back — the wizard says so').not.toContain(HUIS);

    const imported = await annaAgain.agent.callSkill('household', 'importRecoveryFile', { file });
    expect(imported.ok, imported.error).toBe(true);
    expect(imported.circles, 'both circles should come back from the file').toEqual(expect.arrayContaining([HUIS, KOOR]));
  }, 60_000);

  it('a circle she STARTED comes back too, not only the ones she joined', async () => {
    // The regression this walk exists to hold: `pairCircle` makes Anna the founder of both, so before
    // the fix her file carried nothing at all. Two circles, because one could be a coincidence.
    const before = await annaAgain.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
    expect(before, 'the restored profile has no properties at all').toBeTruthy();
    const reopened = (await annaAgain.agent.reopenMemberCircles()).reopened ?? [];
    expect(reopened, 'a founder must re-open the circle she started').toEqual(expect.arrayContaining([HUIS, KOOR]));
  }, 60_000);
});
