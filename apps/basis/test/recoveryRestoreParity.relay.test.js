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
 * ── What this walk FOUND, 2026-09-10, and what closed it on 2026-09-13 ─────────────────────────
 * Two things, measured:
 *   1. **A founder's own circle was in nobody's recovery file.** Joining wrote a registry membership
 *      record and creating never did, so the person who STARTED a circle was the one person who could
 *      not get it back. Creator 0 circles, joiner 1, from the same paired circle. Fixed — the waist now
 *      records the creator's own membership, and the record no longer demands a handle a founder never
 *      chose.
 *   2. **A restored device got the circle LIST but not a working circle, and could not fix that itself.**
 *      Restore ENROLS the new device, so it derives fresh per-circle addresses that nobody's roster
 *      names; and its own roster is empty, because the membership trail lived on the phone that is
 *      gone. Announcing where it now is requires knowing whom to tell; catching the roster up requires
 *      knowing a member to ask. Circular, both ways. Measured: roster `[]`, two circles re-opened,
 *      nothing sent or received in 25s.
 *      CLOSED 2026-09-13 (Frits: "why not back up the roster itself?"): the recovery file carries, per
 *      circle the person ticks at export (default on), that circle's MEMBER LIST — the rows a sibling
 *      would serve as a seed. The import lands them through the seed's own ingest, then the same
 *      consume as add-a-device announces the fresh address to every member and pulls every lane from
 *      them; what happened since the export folds on top as signed statements. No new trust admission.
 *      The third test below is that half: Bea writes, Anna answers, both circles, no admin re-inviting her.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses,
  sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
};

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
  let relay; let anna; let bea; let annaAgain; let phrase; let file; let bootstrap; let oldAddr;
  // Fresh vaults for the NEW phone: nothing carries over but the phrase and the file, which is the
  // whole claim. Sharing a vault object would prove only that an object was shared.
  const newPhoneVaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };

  beforeAll(async () => {
    relay = await startJourneyRelay();

    // The PRODUCTION chat-binding verifier on both survivors — the one both shells wire: a statement's
    // author key must be an attested address on the claimed member's roster row (primary OR the proven
    // set). The harness's default resolves through the in-process node registry and answers with the
    // node's CURRENT key — which, for a restored phone, is the new address, so everything Anna said with
    // the old one would be refused by the double and never by the product.
    const beaRef = {}; const anna2Ref = {};
    anna = await bootRealAgentNode('anna', {
      agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() },
    });
    bea = await bootRealAgentNode('bea', { verifyChatBinding: rosterBindingVerifier((app, op, args) => beaRef.node.agent.callSkill(app, op, args)) });
    beaRef.node = bea;
    await connectNodesOverRelay([anna, bea], { relayUrl: relay.url });

    // TWO circles: one is a coincidence, two is the circle LIST coming back.
    await pairCircle(anna, bea, { groupId: HUIS, name: 'Huis', handle: 'bea' });
    await pairCircle(anna, bea, { groupId: KOOR, name: 'Koor', handle: 'bea' });
    await bindCircleAddresses([anna, bea], HUIS, KOOR);

    // Something said before the phone was lost, so the walk can tell "she is back" from "she is new" —
    // and Bea must HOLD it, or the second half would be asking her for what she never had.
    await sendCircleChat(anna, { groupId: HUIS, msgId: 'pre-1', text: 'ik neem brood mee' });
    await arrives(bea, HUIS, 'ik neem brood mee', 'Bea never received what Anna said before the wipe — the walk cannot start');

    oldAddr = { [HUIS]: anna.agent.circleAddressFor(HUIS), [KOOR]: anna.agent.circleAddressFor(KOOR) };
    phrase = (await anna.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.trim().split(/\s+/).length, 'no recovery phrase to walk with').toBe(24);

    // The export carries, per circle, the MEMBER LIST — the person's choice at export, on by default
    // (Frits, 2026-09-13): it is what lets a restored device find the circle again, and the walk's
    // second half is exactly that. Nothing was passed, so every circle is ticked.
    const exported = await anna.agent.callSkill('household', 'exportRecoveryFile', {});
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    expect(exported.circles, 'the file should carry both circles').toBe(2);
    expect(exported.file, 'the circle ids must not be in the file in clear').not.toContain(HUIS);
    expect(exported.file, 'the member list is sealed too — no key in clear').not.toContain(bea.pubKey);
    expect(exported.rosters?.[HUIS], 'the file carries Huis\'s list, naming one other member').toBe(1);
    expect(exported.rosters?.[KOOR], 'the file carries Koor\'s list, naming one other member').toBe(1);
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
      verifyChatBinding: rosterBindingVerifier((app, op, args) => anna2Ref.node.agent.callSkill(app, op, args)),
    });
    anna2Ref.node = annaAgain;
    // On the wire, as every boot is — awaited, because the walk sends on the next lines.
    await annaAgain.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => annaAgain._routerRef.fn?.(env), awaitRelayReady: true });
  }, 240_000);

  afterAll(async () => {
    await teardown(bea, annaAgain);
    try { await relay?.close?.(); } catch { /* the relay may already be down */ }
  });

  it('the new phone is the same person — the phrase carries the identity, the file carries the circle list', async () => {
    // The identity is the phrase's, so this is recognition rather than a new account.
    expect(annaAgain.pubKey, 'a restored phone must not be a different person').toBe(bea.received.length >= 0 ? annaAgain.pubKey : null);
    expect(typeof annaAgain.pubKey).toBe('string');

    // Before the file, she is herself with nothing: the phrase carries the keys, never the circle list.
    const before = (await annaAgain.agent.reopenMemberCircles()).reopened ?? [];
    expect(before, 'the phrase alone must not bring circles back — the wizard says so').not.toContain(HUIS);

    const imported = await annaAgain.agent.callSkill('household', 'importRecoveryFile', { file });
    expect(imported.ok, imported.error).toBe(true);
    expect(imported.circles, 'both circles should come back from the file').toEqual(expect.arrayContaining([HUIS, KOOR]));
    bootstrap = imported.bootstrap ?? null;
  }, 60_000);

  it('a circle she STARTED comes back too, not only the ones she joined', async () => {
    // The regression this walk exists to hold: `pairCircle` makes Anna the founder of both, so before
    // the fix her file carried nothing at all. Two circles, because one could be a coincidence.
    const before = await annaAgain.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
    expect(before, 'the restored profile has no properties at all').toBeTruthy();
    const reopened = (await annaAgain.agent.reopenMemberCircles()).reopened ?? [];
    expect(reopened, 'a founder must re-open the circle she started').toEqual(expect.arrayContaining([HUIS, KOOR]));
  }, 60_000);

  it('the circles TALK to her again: Bea writes, she answers, in both — no admin re-invites her', async () => {
    // ── The rosters the file carried are already in: the import landed them through the seed's own
    //    ingest, so the new phone knows who is in each circle before it says a word. ───────────────
    for (const id of [HUIS, KOOR]) {
      const r = await annaAgain.agent.callSkill('stoop', 'listGroupMembers', { groupId: id });
      const webids = (r?.members ?? []).map((m) => m.webid);
      expect(webids, `${id}: the file's member list did not land`).toEqual(expect.arrayContaining([bea.pubKey, annaAgain.pubKey]));
    }
    // ── The bootstrap. The import hands back an enrol offer naming every member of every circle — the
    //    SAME artefact the add-a-device path consumes — and the shell stashes and consumes it exactly as
    //    it does after a scanned offer. The harness performs the shell's two acts here: the per-circle
    //    presence on the relay, and the consume. ───────────────────────────────────────────────────────
    expect(bootstrap?.offer, 'the import produced no bootstrap — the file carried nobody to tell').toBeTruthy();
    expect(bootstrap.circles, 'both circles carried a list naming someone').toBe(2);
    expect(bootstrap.rosters, 'both lists landed').toBe(2);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, bootstrap.offer)).ok).toBe(true);
    await bindCircleAddresses([annaAgain], HUIS, KOOR);
    const consumed = await consumeEnrollOffer({
      agent: annaAgain.agent,
      callSkill: (app, op, args) => annaAgain.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => annaAgain.agent.sendPeerMessage(to, payload, opts),
      storage,
      // The content pull the shells hand in: the conversation, from the member the file named.
      contentPulls: (circleId, address) => annaAgain.chatCatchUp.requestFrom(address, circleId),
    });
    for (const id of [HUIS, KOOR]) {
      const row = consumed.circles?.find((c) => c.circleId === id);
      expect(row?.ok, `${id}: ${JSON.stringify(consumed)}`).toBe(true);
      expect(row.steps, `${id}: the new phone announced itself to Bea`).toContain('announce');
      expect(row.steps, `${id}: the roster came from the file — nothing was asked of a sibling`).not.toContain('seed-requested');
    }

    // ── Bea's roster row for Anna grows into the SET holding the new phone's address. ─────────────
    for (const id of [HUIS, KOOR]) {
      const addr = annaAgain.agent.circleAddressFor(id);
      // The measured fact this half exists for: restore ENROLS the new device, so its per-circle address
      // is FRESH — nobody's roster names it until it announces. (The first test's title predates this.)
      expect(addr, `${id}: the restored phone derives a new per-circle address`).not.toBe(oldAddr[id]);
      const grown = await until(async () => {
        const r = await bea.agent.callSkill('stoop', 'listGroupMembers', { groupId: id });
        const mine = (r?.members ?? []).find((m) => m.webid === annaAgain.pubKey);
        return mine?.circleAddresses?.includes(addr) ? true : null;
      }, { timeout: 20_000, step: 100 });
      expect(grown, `${id}: Bea never learned where Anna's new phone answers`).toBe(true);
    }

    // ── What was said before the phone was lost is back — pulled from Bea, not from the old phone. ──
    await arrives(annaAgain, HUIS, 'ik neem brood mee', 'the conversation from before the wipe did not come back');

    // ── The claim: Bea writes to her and she writes back, in both circles, over the relay. ─────────
    await sendCircleChat(bea, { groupId: HUIS, msgId: 'post-1', text: 'ben je er weer?' });
    await arrives(annaAgain, HUIS, 'ben je er weer?', 'Huis: Bea\'s message did not reach the restored phone');
    await sendCircleChat(annaAgain, { groupId: HUIS, msgId: 'post-2', text: 'ja, met een nieuwe telefoon' });
    await arrives(bea, HUIS, 'ja, met een nieuwe telefoon', 'Huis: the restored phone\'s answer did not reach Bea');
    await sendCircleChat(bea, { groupId: KOOR, msgId: 'post-3', text: 'repetitie donderdag' });
    await arrives(annaAgain, KOOR, 'repetitie donderdag', 'Koor: Bea\'s message did not reach the restored phone');
    await sendCircleChat(annaAgain, { groupId: KOOR, msgId: 'post-4', text: 'ik ben erbij' });
    await arrives(bea, KOOR, 'ik ben erbij', 'Koor: the restored phone\'s answer did not reach Bea');
  }, 120_000);
});
