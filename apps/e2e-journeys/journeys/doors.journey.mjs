// J-doors: what a PEER is allowed to make my device do.
//
// Every other journey here acts through `callSkill` — the local waist, i.e. a person on their own
// device. That can never test this, because it never crosses the place where the question is
// decided. The door is `runGatedSkill` (@onderling/core protocol/taskExchange): it runs
// `PolicyEngine.checkInbound` — the caller's trust TIER against the skill's VISIBILITY — then the
// skill lookup, then the group-visibility gate.
//
// Two things make this worth a journey of its own.
//
// First, it is the only authority surface in the system that is not about circles. There is no
// roster here, no membership, no phrase: just "who are you to me, and what is this thing you are
// asking for". A mistake here is reachable by anyone who can address the device at all.
//
// Second, the code makes an unusually precise promise, and says why (2026-07-27):
//
//     "Unknown values fail CLOSED, in opposite directions. An unrecognised CALLER tier is treated as
//      the lowest (`public`): we do not know who they are, so they get the least. An unrecognised
//      SKILL visibility is treated as the highest (`private`): we do not know what it guards, so it
//      is guarded most. Both used to default to `authenticated` […] and the failure would have been
//      silent and OPEN: a skill nobody could name would have been reachable by any known peer."
//
// That is exactly the kind of claim that is easy to state and easy to regress, because when it
// breaks nothing fails — things merely become reachable. So it is asserted here in both directions.
import { checker, wait } from './_util.mjs';
import { bootDoorAgent, knockDirect, defineSkill, linkDoorAgents } from './_app.mjs';

export const name = 'J-doors (what a peer may make my device do — the trust-tier gate)';

/** A skill at each visibility tier, so the ladder can be walked rung by rung. */
const skillsUnderTest = () => [
  defineSkill('public-thing', async () => [{ kind: 'data', data: { reached: 'public-thing' } }],
    { description: 'anyone may call', visibility: 'public' }),
  defineSkill('authenticated-thing', async () => [{ kind: 'data', data: { reached: 'authenticated-thing' } }],
    { description: 'a known peer may call', visibility: 'authenticated' }),
  defineSkill('trusted-thing', async () => [{ kind: 'data', data: { reached: 'trusted-thing' } }],
    { description: 'only a trusted peer', visibility: 'trusted' }),
  defineSkill('private-thing', async () => [{ kind: 'data', data: { reached: 'private-thing' } }],
    { description: 'the owner only — a phrase-shaped secret would live behind this', visibility: 'private' }),
  // Registered legitimately here; its visibility is corrupted AFTER registration in the journey, to
  // stand in for the case the fail-closed rule was written for — a hand-built registry, a future
  // host, or a typo in a migration. It cannot be declared that way, as check 0 below shows.
  defineSkill('mystery-thing', async () => [{ kind: 'data', data: { reached: 'mystery-thing' } }],
    { description: 'visibility corrupted after registration', visibility: 'trusted' }),
];

const refused = (r) => !r.ok;
const reached = (r, id) => r.ok && r.result?.reached === id;

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let door = null;
  let stranger = null;
  let friend = null;

  try {
    stranger = await bootDoorAgent({ relayUrl });
    friend = await bootDoorAgent({ relayUrl });
    // The door knows one of them and has never heard of the other.
    door = await bootDoorAgent({
      relayUrl, skills: skillsUnderTest(), trust: { [friend.pubKey]: 'trusted' },
    });
    linkDoorAgents(door, friend, stranger);
    await wait(1200);   // the relay sockets settle, as in the reachability journey
    check('a device with a policy engine is listening', !!door.agent.policyEngine);

    // Every refusal below has to come from the GATE. A transport that cannot reach the door refuses
    // identically ("send HI first"), so the journey proves reachability FIRST — otherwise the whole
    // corridor passes for the wrong reason, which is the exact trap this suite keeps finding.
    const reachability = await knockDirect(stranger.agent, door.address, 'public-thing');
    check('the door is actually REACHABLE — refusals below are the gate, not the wire',
      reachability.ok, JSON.stringify(reachability)?.slice(0, 160));

    // ── 0. THE FIRST GATE — a bad tier cannot even be DECLARED ───────────────────────────────────
    // Found while writing this journey: `defineSkill` validates visibility against the four tiers
    // and throws. So the fail-closed rule tested in §3 is the SECOND line of defence, behind a
    // declaration-time refusal — worth pinning, because it is what keeps §3's case rare.
    let declaredBadTier = null;
    try {
      defineSkill('bad-tier', async () => [], { visibility: 'not-a-real-tier' });
      declaredBadTier = 'accepted';
    } catch (e) { declaredBadTier = String(e?.message ?? e); }
    check('a skill CANNOT be declared with a visibility outside the vocabulary',
      declaredBadTier !== 'accepted', String(declaredBadTier).slice(0, 120));

    const knock = (who, skillId) => knockDirect(who.agent, door.address, skillId);

    // ── 1. THE LADDER, from someone the device has never heard of ────────────────────────────────
    const s1 = await knock(stranger, 'public-thing');
    check('a stranger may call something declared PUBLIC', reached(s1, 'public-thing'),
      JSON.stringify(s1)?.slice(0, 140));

    // WORTH KNOWING, and not what a reader would guess: an unknown peer is `authenticated`, not
    // `public`. `TrustRegistry.getTier` returns `rec.tier ?? 'authenticated'`, and realAgent's own
    // wiring says so out loud ("unknown peers → 'authenticated'"). So ANY peer that can address this
    // device clears every `authenticated` skill without being known to it. That is a deliberate
    // default rather than a gap — being addressable already requires holding the address — but it is
    // the line above which a skill needs a real decision, so it is pinned here rather than assumed.
    //
    // It is also a DIFFERENT rule from the fail-closed one below, which is about an unrecognised
    // tier VALUE. Conflating the two is easy: the first draft of this journey did.
    const s2 = await knock(stranger, 'authenticated-thing');
    check('an unknown peer is treated as `authenticated` — the documented default, not `public`',
      reached(s2, 'authenticated-thing'), JSON.stringify(s2)?.slice(0, 140));

    const s3 = await knock(stranger, 'trusted-thing');
    check('…and at `trusted`', refused(s3), JSON.stringify(s3)?.slice(0, 140));

    const s4 = await knock(stranger, 'private-thing');
    check('…and at `private` — the tier a secret would sit behind', refused(s4),
      JSON.stringify(s4)?.slice(0, 140));

    // ── 2. THE SAME LADDER, from someone the device trusts ───────────────────────────────────────
    // Without this half, every check above would pass on a door that simply refuses everyone.
    const f1 = await knock(friend, 'public-thing');
    const f2 = await knock(friend, 'authenticated-thing');
    const f3 = await knock(friend, 'trusted-thing');
    check('a TRUSTED caller gets through the rungs it is entitled to',
      reached(f1, 'public-thing') && reached(f2, 'authenticated-thing') && reached(f3, 'trusted-thing'),
      `${f1.ok}/${f2.ok}/${f3.ok}`);

    const f4 = await knock(friend, 'private-thing');
    check('…but `private` is still not for a peer, however trusted', refused(f4),
      JSON.stringify(f4)?.slice(0, 140));

    // ── 3. FAIL-CLOSED, THE OTHER DIRECTION ──────────────────────────────────────────────────────
    // An unrecognised VISIBILITY must be guarded as the highest, not waved through as the middle.
    // If this regresses, nothing errors — a skill nobody could name simply becomes reachable.
    //
    // The registry entry is corrupted here rather than declared corrupt, because §0 shows it cannot
    // be declared. This is the migration-typo shape the rule names.
    const mystery = door.agent.skills.get('mystery-thing');
    if (mystery) mystery.visibility = 'not-a-real-tier';
    check('the corrupted skill really is registered with an unknown tier',
      door.agent.skills.get('mystery-thing')?.visibility === 'not-a-real-tier');

    const m1 = await knock(stranger, 'mystery-thing');
    const m2 = await knock(friend, 'mystery-thing');
    check('AN UNDECLARED VISIBILITY IS GUARDED MOST — a stranger is refused',
      refused(m1), JSON.stringify(m1)?.slice(0, 140));
    check('…and so is a trusted peer, because nobody knows what it guards',
      refused(m2), JSON.stringify(m2)?.slice(0, 140));

    // ── 3b. FAIL-CLOSED FOR AN UNRECOGNISED CALLER TIER ─────────────────────────────────────────
    // The other half of the same rule: a tier VALUE nobody declared must drop the caller to the
    // lowest rung, not leave them where the default put them.
    await door.setTier(stranger.pubKey, 'not-a-real-tier');
    const badTierAuth = await knock(stranger, 'authenticated-thing');
    check('A CALLER WITH AN UNRECOGNISED TIER DROPS TO THE LEAST — refused at `authenticated`',
      refused(badTierAuth), JSON.stringify(badTierAuth)?.slice(0, 150));
    const badTierPublic = await knock(stranger, 'public-thing');
    check('…but still gets what is public to everyone', reached(badTierPublic, 'public-thing'),
      JSON.stringify(badTierPublic)?.slice(0, 140));

    // ── 4. A SKILL THAT DOES NOT EXIST ───────────────────────────────────────────────────────────
    const unknown = await knock(friend, 'no-such-skill');
    check('an undeclared op is refused, and says so', refused(unknown),
      JSON.stringify(unknown)?.slice(0, 140));
    check('…naming the skill rather than failing vaguely',
      /unknown skill/i.test(String(unknown.error ?? '')), String(unknown.error).slice(0, 120));

    // ── 5. TRUST IS REVOCABLE, AND THE DOOR NOTICES ──────────────────────────────────────────────
    // A grant that cannot be taken back is not a grant. Demote the friend and knock again.
    await door.setTier(friend.pubKey, 'public');
    const afterDemotion = await knock(friend, 'trusted-thing');
    check('DEMOTING A PEER CLOSES THE DOOR AGAIN', refused(afterDemotion),
      JSON.stringify(afterDemotion)?.slice(0, 140));
    const stillPublic = await knock(friend, 'public-thing');
    check('…without shutting them out of what anyone may call',
      reached(stillPublic, 'public-thing'));
  } catch (err) {
    check('the door corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await door?.stop?.();
    await friend?.stop?.();
    await stranger?.stop?.();
  }
  return results;
}
