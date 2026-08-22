// J-custody: the acts that decide WHO IS ME — the recovery phrase, adding a device, and taking one
// away. The stolen-phone corridor.
//
// Frits asked for this after the custody sitting, on the worry that the key work was "this hidden"
// and might not be wired well. The key LANE turned out to have a dead fan (F-012, since fixed);
// these are the acts on the other side of it — the ceremonies a person performs when they buy a new
// phone, or lose one.
//
// What makes this corridor worth its own journey is that every op here is deliberately unreachable
// from chat and has no GUI surface in the manifest (`surfaces: {}`), because "a phrase does not
// belong in a chat box". That is the right call, and it also means these ops have almost no way of
// being exercised by anything else — no slash command, no gate, no screen test. If the phrase check
// stopped working, nothing in the suite would notice.
//
// The claims:
//   1. THE PHRASE — stable across reveals (a recovery phrase that changes is worthless) and a real
//      24-word phrase, not a placeholder.
//   2. THE OFFER — the add-a-device QR is public by design, so it must carry NO part of the secret.
//   3. THE GATE — the phrase is the authority. A wrong one, or none, enrolls nothing and revokes
//      nothing.
//   4. THE ACT — the right phrase does add a device.
//   5. THE BOUNDARY — someone else's phrase does not reach my circles.
//   6. CONNECTIONS — a granted surface may do exactly the ops that were ticked, and revoke wins.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember } from './_app.mjs';
import { bootRealAgentNode, teardown } from '../../basis/test/support/pairRealAgents.js';

export const name = 'J-custody (the recovery phrase, adding a device, and taking one away)';

const CIRCLE = 'e2e-custody';
// A valid BIP39 phrase that is not this account's — the "wrong key" every gate below is tried with.
const SOMEONE_ELSES = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;
  const spares = [];

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram'] });
    const [anne, bram] = circle.people;
    const call = (node, op, args = {}) => node.agent.callSkill('household', op, args);

    // ── 1. THE PHRASE ────────────────────────────────────────────────────────────────────────────
    const first = await call(anne, 'revealOwnerPhrase');
    check('the owner can see their recovery phrase — holding the unlocked device is the authority',
      typeof first?.mnemonic === 'string' && first.mnemonic.length > 0);

    const words = String(first?.mnemonic ?? '').trim().split(/\s+/);
    check('it is a real recovery phrase, not a placeholder', words.length === 24,
      `${words.length} words`);

    const second = await call(anne, 'revealOwnerPhrase');
    const third = await call(anne, 'revealOwnerPhrase');
    check('THE PHRASE IS STABLE — the same words every time, or it recovers nothing',
      first.mnemonic === second.mnemonic && second.mnemonic === third.mnemonic);

    // ── 2. THE OFFER — public by design, so it had better be ─────────────────────────────────────
    const offer = await call(anne, 'buildEnrollOffer', { relayUrl });
    check('the existing device can produce an add-a-device offer', !!offer?.uri,
      JSON.stringify(offer)?.slice(0, 120));

    const uri = String(offer?.uri ?? '');
    check('the offer carries NO part of the recovery phrase', !uri.includes(first.mnemonic));
    const leaked = words.filter((w) => w.length >= 5 && uri.toLowerCase().includes(w.toLowerCase()));
    check('…not even one of its words', leaked.length === 0, leaked.join(' '));
    check('the offer does carry the circle the new device must reach', (offer?.circles ?? 0) >= 1);

    // ── 3. THE GATE — the phrase is the authority ────────────────────────────────────────────────
    const thief = await bootRealAgentNode('thief', { taskLane: true });
    spares.push(thief);

    const wrongEnroll = await call(thief, 'enrollDevice', { mnemonic: SOMEONE_ELSES, label: 'stolen' });
    check('a WRONG phrase enrolls nothing', wrongEnroll?.ok === false,
      JSON.stringify(wrongEnroll)?.slice(0, 120));

    const noEnroll = await call(thief, 'enrollDevice', { label: 'stolen' });
    check('NO phrase enrolls nothing either', noEnroll?.ok === false,
      JSON.stringify(noEnroll)?.slice(0, 120));

    const wrongRevoke = await call(anne, 'revokeDevice', { mnemonic: SOMEONE_ELSES, deviceId: 'whatever' });
    check('a WRONG phrase revokes nothing — the ceremony is phrase-proven both ways',
      wrongRevoke?.ok === false, JSON.stringify(wrongRevoke)?.slice(0, 120));

    // ── 4. THE ACT — the right phrase does add a device ──────────────────────────────────────────
    const laptop = await bootRealAgentNode('anne-laptop', { taskLane: true });
    spares.push(laptop);
    const enrolled = await call(laptop, 'enrollDevice', { mnemonic: first.mnemonic, label: 'laptop' });
    check('THE RIGHT PHRASE ADDS THE DEVICE', enrolled?.ok === true,
      JSON.stringify(enrolled)?.slice(0, 140));
    check('…and the new device gets an identity of its own to be revoked by later',
      typeof enrolled?.deviceId === 'string' && enrolled.deviceId.length > 0);

    // Revoking an unknown device is honest about it rather than reporting a removal that did not
    // happen — the distinction a person needs when they are not sure which phone they still hold.
    const unknown = await call(anne, 'revokeDevice', { mnemonic: first.mnemonic, deviceId: 'never-existed' });
    check('revoking a device that was never enrolled says so', unknown?.known === false,
      JSON.stringify(unknown)?.slice(0, 140));

    // ── 5. THE BOUNDARY — someone else's phrase is not a way into my circles ─────────────────────
    const bramPhrase = (await call(bram, 'revealOwnerPhrase'))?.mnemonic;
    check('two people do not share a recovery phrase', !!bramPhrase && bramPhrase !== first.mnemonic);

    const impostor = await bootRealAgentNode('impostor', { taskLane: true });
    spares.push(impostor);
    const asBram = await call(impostor, 'enrollDevice', { mnemonic: bramPhrase, label: 'other-account' });
    check('a device enrolled with ANOTHER person\'s phrase joins THAT account', asBram?.ok === true,
      JSON.stringify(asBram)?.slice(0, 120));
    // …and that is exactly why the interesting question is what it can reach: nothing of Anne's.
    const reach = await impostor.agent.callSkill('stoop', 'listGroupRoster', { groupId: CIRCLE });
    check('…and reaches nothing of the FIRST person\'s circle',
      !!reach?.error || (reach?.members ?? []).length === 0,
      JSON.stringify(reach)?.slice(0, 140));
    check('the circle\'s own roster is unchanged by any of it',
      hasMember(await rosterOf(anne, CIRCLE), bram.pubKey));

    // ── 6. CONNECTIONS — the ops you tick ARE the grant ──────────────────────────────────────────
    const grant = await call(anne, 'grantSurface', {
      viewPubKey: 'screen-in-the-kitchen', ops: ['listOpen'], label: 'keukenscherm',
    });
    check('a surface can be granted a NARROW set of ops', grant?.ok === true,
      JSON.stringify(grant?.ops));
    check('the grant carries exactly the ops that were ticked, and nothing else',
      JSON.stringify(grant?.ops) === JSON.stringify(['listOpen']));

    const listed = await call(anne, 'listSurfaceGrants');
    const rows = listed?.surfaces ?? [];
    check('the connection is visible in the list of what may act as me',
      rows.some((s) => s.viewPubKey === 'screen-in-the-kitchen' && s.label === 'keukenscherm'),
      JSON.stringify(rows)?.slice(0, 160));

    const revoked = await call(anne, 'revokeSurface', { viewPubKey: 'screen-in-the-kitchen' });
    check('unpairing works', revoked?.ok === true && revoked?.revoked === true);
    const after = await call(anne, 'listSurfaceGrants');
    check('REVOKE WINS — the connection is gone from the list',
      !(after?.surfaces ?? []).some((s) => s.viewPubKey === 'screen-in-the-kitchen'),
      JSON.stringify(after?.surfaces));

    check('one person\'s connections are their own — the other person has none of them',
      !((await call(bram, 'listSurfaceGrants'))?.surfaces ?? [])
        .some((s) => s.viewPubKey === 'screen-in-the-kitchen'));
  } catch (err) {
    check('the custody corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await teardown(...spares).catch(() => {});
    await circle?.close?.().catch(() => {});
  }
  return results;
}
