// J-keys: the circle's group key is established and rotated — and only by someone entitled to.
//
// Frits asked for this one after the custody sitting: "I think we should add some user journeys to
// test this later on, as I'm afraid not everything is wired well if it was this hidden that you
// needed my instructions to find them." That is the right worry. The key lane was built days ago and
// its receive half lives in the shells; nothing until now put a rotation on a wire between people.
//
// The corridor is the one the sealing machinery actually drives: a key-event goes into the circle's
// key SINK, which signs it on the key lane, appends it to the device log, and fans the STATEMENT to
// the event's recipients — who verify signature, chain, and the rotateKey authority at their own rail
// before anything folds. The journey drives `sink.append(event)` exactly where the control agent
// does, so what is under test is the wiring, not a stand-in for it.
//
// Three claims:
//   1. ESTABLISH — the founding key reaches every member's key chain.
//   2. ROTATE    — a new version supersedes it, everywhere, and the chain keeps the old one (you must
//                  still be able to read what was sealed before the rotation).
//   3. AUTHORITY — a rotation signed by someone without the authority is REFUSED where it lands. Not
//                  hidden, not ignored by a UI: refused at the rail.
import { checker } from './_util.mjs';
import { bootAppCircle, keySinkFor, untilTrue } from './_app.mjs';
import { establishKeyEvent, rotateKeyEvent, foldKeyEvents }
  from '../../../packages/pod-client/src/sealing/keyEventsLog.js';
import { keyEventsFromRail } from '../../basis/src/v2/keyRail.js';
import { sealingPublicKeyFromNetworkKey } from '../../../packages/pod-client/src/index.js';

export const name = 'J-keys (the group key is established and rotated — and only by someone entitled)';

const CIRCLE = 'e2e-key-rotation';

/**
 * The sealing public keys a key-event is sealed to.
 *
 * [F-012] The roster does NOT carry them. A member's sealing key is a deterministic function of
 * their network key (`sealingPublicKeyFromNetworkKey`), and several places in the codebase derive
 * it that way — but the roster row never stores it and `recipientAddrsFromRoster` never derives it,
 * so it is derived HERE to get a well-formed event at all. That the journey has to do this is the
 * finding, and the checks below measure what it costs.
 */
async function sealingKeys(node, circleId) {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
  return (r?.members ?? [])
    .map((m) => {
      const stored = m?.sealingPublicKey ?? m?.sealingPubKey ?? m?.publicKey;
      if (stored) return stored;
      const net = m?.circleAddress ?? m?.pubKey ?? m?.webid;
      try { return net ? sealingPublicKeyFromNetworkKey(net) : null; } catch { return null; }
    })
    .filter(Boolean);
}

/** What the sink's OWN recipient resolver would return — the production fan, measured. */
async function fanReach(node, circleId, event) {
  const { recipientAddrsFromRoster } = await import('../../../packages/kring-host/src/keyEventLogSink.js');
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
  return recipientAddrsFromRoster(event, Array.isArray(r?.members) ? r.members : []);
}

/** The key versions THIS device holds, folded from statements its rail actually verified. */
async function versionsAt(node, circleId) {
  const events = await keyEventsFromRail(node.agent.keyRail, circleId).catch(() => []);
  return (events ?? []).map((e) => e?.version).filter(Number.isInteger).sort((a, b) => a - b);
}

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({
      relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'], outsiders: ['zus'],
    });
    const [anne, bram, cato] = circle.people;
    const [zus] = circle.outsiders;

    check('every device has a key rail', circle.people.every((p) => !!p.agent.keyRail));
    check('and an emitter to sign with', !!anne.agent.keyEmit);

    const recipients = await sealingKeys(anne, CIRCLE);
    check('there are sealing keys to seal a group key to (derived — see F-012)',
      recipients.length >= 2, `${recipients.length} recipient(s)`);

    const adminSink = keySinkFor(anne, CIRCLE);

    // ── 1. ESTABLISH — version 1 ─────────────────────────────────────────────────────────────────
    const { event: v1 } = establishKeyEvent({ groupId: CIRCLE, recipients });

    // [F-012] THE FAN, measured before anything else: `recipientAddrsFromRoster` reads
    // `sealingPublicKey ?? sealingPubKey ?? publicKey` off each roster row, and a row carries none
    // of the three — 27 fields, no sealing key. Both shells pass raw `listGroupMembers` rows to it,
    // so a key rotation is signed, chained, appended, and fanned to NOBODY, on every platform.
    const reach = await fanReach(anne, CIRCLE, v1);
    check('[F-012] a key-event fans to the circle\'s members', reach.length >= 2,
      `the production resolver returns ${reach.length} recipient address(es)`);

    await adminSink.sink.append(v1);

    check('the establisher records its own key-event locally', adminSink.recorded.length === 1);
    check('…and signs it onto its own key lane',
      await untilTrue(async () => (await versionsAt(anne, CIRCLE)).includes(1)));

    for (const [who, node] of [['the second member', bram], ['the third member', cato]]) {
      check(`[F-012] ${who}'s rail verifies and folds the founding key`,
        await untilTrue(async () => (await versionsAt(node, CIRCLE)).includes(1)));
    }

    // ── 2. ROTATE — version 2, without losing version 1 ──────────────────────────────────────────
    const { event: v2 } = rotateKeyEvent({
      groupId: CIRCLE, priorEvents: [v1], fromVersion: 1, recipients,
    });
    await adminSink.sink.append(v2);

    check('[F-012] the rotation reaches the second member',
      await untilTrue(async () => (await versionsAt(bram, CIRCLE)).includes(2)));
    check('[F-012] …and the third',
      await untilTrue(async () => (await versionsAt(cato, CIRCLE)).includes(2)));

    const catoVersions = await versionsAt(cato, CIRCLE);
    check('[F-012] the OLD version is still in the chain — history sealed before the rotation stays readable',
      catoVersions.includes(1) && catoVersions.includes(2), JSON.stringify(catoVersions));

    const folded = foldKeyEvents(await keyEventsFromRail(cato.agent.keyRail, CIRCLE), { groupId: CIRCLE });
    const current = Array.isArray(folded) ? folded[folded.length - 1] : folded?.current ?? folded;
    check('[F-012] the newest version is the one the circle now seals with',
      (current?.version ?? 0) === 2, JSON.stringify(current?.version ?? current));

    // ── 3. AUTHORITY — a rotation nobody authorised must be refused where it lands ───────────────
    // Both attempts are asked of the OTHER devices' rails. What the attacker's own device believes
    // is irrelevant; what matters is whether anyone else adopts their key.
    //
    // HONEST CAVEAT while F-012 stands: these two pass VACUOUSLY. Nothing reaches anyone, so "the
    // bystander did not adopt it" is true of the admin's legitimate rotation too. They become real
    // evidence the moment the fan is repaired — and until then they are not evidence of anything.
    const memberSink = keySinkFor(bram, CIRCLE);
    const { event: v3 } = rotateKeyEvent({
      groupId: CIRCLE, priorEvents: [v1, v2], fromVersion: 2, recipients,
    });
    await memberSink.sink.append(v3).catch(() => {});
    const memberRotationTook = await untilTrue(
      async () => (await versionsAt(cato, CIRCLE)).includes(3), 5000);
    check('an ORDINARY MEMBER\'s rotation is refused at the other members\' rails', !memberRotationTook,
      `bystander holds ${JSON.stringify(await versionsAt(cato, CIRCLE))}`);

    const strangerSink = keySinkFor(zus, CIRCLE);
    const { event: v4 } = rotateKeyEvent({
      groupId: CIRCLE, priorEvents: [v1, v2], fromVersion: 2, recipients,
    });
    await strangerSink.sink.append(v4).catch(() => {});
    const strangerRotationTook = await untilTrue(
      async () => (await versionsAt(cato, CIRCLE)).length > catoVersions.length, 5000);
    check('a STRANGER\'s rotation is refused too', !strangerRotationTook,
      `bystander holds ${JSON.stringify(await versionsAt(cato, CIRCLE))}`);

    check('and the circle is still on the key its admin set',
      (await versionsAt(anne, CIRCLE)).includes(2));

    // ── 4. The admin can still rotate afterwards — a refused attempt must not wedge the lane ─────
    const { event: v3ok } = rotateKeyEvent({
      groupId: CIRCLE, priorEvents: [v1, v2], fromVersion: 2, recipients,
    });
    await adminSink.sink.append(v3ok);
    check('[F-012] the admin can rotate again — a refused attempt does not wedge the chain',
      await untilTrue(async () => (await versionsAt(cato, CIRCLE)).includes(3)));
  } catch (err) {
    check('the key corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
