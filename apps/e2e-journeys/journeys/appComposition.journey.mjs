// J-app: the journey runner, running the APP's own composition — headless, no browser.
//
// This is the proof for finding F-002. The same act — a member leaving a circle — is invisible to the
// circle in the mirror-only harness (there is no membership lane for the statement to travel on) and
// works here, because this journey boots what the shells boot: the real agent factory, a device log,
// the signed lanes, per-circle identities, the waist.
//
// It also demonstrates the property that makes this worth having: it runs against WHATEVER relay the
// runner was given, so the same corridor can be pointed at a deployment:
//
//     node run.mjs app                       # local relay, started by the runner
//     node run.mjs wss://relay.example.com app
//
// Deliberately small. Its job is to prove the composition is available and faithful; the corridors
// that matter get written on top of it.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, untilTrue } from './_app.mjs';

export const name = 'J-app (the runner boots the APP composition: lanes, not just the mirror)';

const CIRCLE = 'e2e-app-composition';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;

    // The composition itself is the first claim: the rails only exist when a device log does.
    check('the app composition booted — the membership rail exists',
      !!anne.agent.membershipRail && !!bram.agent.membershipRail);
    check('…and so do the other lanes the shells register',
      !!anne.agent.taskRail && !!anne.agent.chatRail && !!anne.agent.keyRail);
    check('three people are on the relay', circle.people.every((p) => !!p.agent));

    // Everyone sees everyone: the roster is a FOLD of signed statements here, not a seeded list.
    const seeded = await rosterOf(anne, CIRCLE);
    check('the roster folded from the join statements',
      hasMember(seeded, bram.pubKey) && hasMember(seeded, cato.pubKey),
      `${seeded.length} members`);

    // ── The F-002 proof: a leave TRAVELS ─────────────────────────────────────────────────────────
    // In the mirror-only harness this is invisible to everyone but the leaver. Here the `leave`
    // statement rides the membership lane, is verified at each receiver's rail, and folds.
    const left = await bram.agent.callSkill('stoop', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    check('the member can leave (the act is gated as irreversible, and confirmed)',
      !left?.error, JSON.stringify(left)?.slice(0, 120));

    check('the leaver\'s own device drops the membership',
      await untilTrue(async () => !hasMember(await rosterOf(bram, CIRCLE), bram.pubKey)));

    check('THE ADMIN LEARNS THE PERSON LEFT — the half the mirror harness cannot show',
      await untilTrue(async () => !hasMember(await rosterOf(anne, CIRCLE), bram.pubKey)));

    check('and so does the bystander — one circle, one roster',
      await untilTrue(async () => !hasMember(await rosterOf(cato, CIRCLE), bram.pubKey)));

    check('the bystander is untouched by someone else\'s departure',
      hasMember(await rosterOf(anne, CIRCLE), cato.pubKey));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
