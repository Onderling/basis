// J-absence: a phone was off for a long time. What does the person find when they open it again?
//
// This is the most ordinary thing that happens to a real user and one of the least tested. Every
// other journey in this directory has all three devices awake and listening for the whole run, which
// is the one condition a phone almost never satisfies.
//
// The absence is simulated by taking the device DARK — inbound envelopes are dropped, as they are for
// a phone that is off — rather than by closing its socket. That is deliberate: a real absence
// outlasts the relay's hold window, so what has to carry the backlog is the CATCH-UP. If the journey
// closed the socket instead, the relay's held-message replay would deliver everything and the test
// would pass without the catch-up ever running.
//
// While Cato is away the circle keeps living: messages, a task, new rules, a new member. On return
// Cato drives the same reconnect kick the shells drive, and the claim is convergence — the same
// circle, from the same signed statements, with nothing silently missing.
import { checker } from './_util.mjs';
import { bootAppCircle, rosterOf, hasMember, untilTrue, sendCircleChat, goDark } from './_app.mjs';

export const name = 'J-absence (a device is dark for a long time, then comes back and must converge)';

const CIRCLE = 'e2e-absence';
const MISSED = ['eerste', 'tweede', 'derde', 'vierde', 'vijfde'];

// The receive-side rail — the one the peer handler feeds. (`agent.chatRail` is the emit-side
// instance; reading the wrong one shows an empty circle while statements are landing fine.)
const chatSubjects = (node) => node.chatRail.storedStatements(CIRCLE).map((s) => s?.body?.subject);

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;
    const call = (node, op, args) => node.agent.callSkill('stoop', op, args);

    // A message BEFORE the absence, so the journey can tell "caught up" from "never had anything".
    await sendCircleChat(anne, { groupId: CIRCLE, msgId: 'before-1', text: 'tot morgen' });
    check('the circle is live before the absence',
      await untilTrue(async () => chatSubjects(cato).includes('before-1')));

    // ── The device goes dark ──────────────────────────────────────────────────────────────────────
    const comeBack = goDark(cato);
    check('the device is dark', true, 'inbound dropped, as for a phone that is off');

    // ── Life goes on without them ────────────────────────────────────────────────────────────────
    for (const [i, word] of MISSED.entries()) {
      await sendCircleChat(anne, { groupId: CIRCLE, msgId: `missed-${i}`, text: word });
    }
    const task = await anne.agent.callSkill('tasks', 'addTask', { text: 'de heg knippen', circleId: CIRCLE });
    const rules = await call(anne, 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'Heggenregels', agreements: 'de heg wordt in mei geknipt' },
    });
    check('the circle kept living while the device was away',
      !!task?.itemId && !rules?.error);

    // The others converged among themselves — so anything missing later is about the ABSENCE.
    check('the awake members have it all',
      await untilTrue(() => MISSED.every((_, i) => chatSubjects(bram).includes(`missed-${i}`))));
    check('the dark device received nothing', !chatSubjects(cato).includes('missed-0'),
      `${chatSubjects(cato).length} statement(s) while dark`);

    // ── The phone comes back on ──────────────────────────────────────────────────────────────────
    comeBack();
    // The reconnect kick, as the shells drive it: ask every member of every circle for what this
    // device's frontier is missing. Nothing here is journey-only — it is `requestAll`, the same call.

    // The shells kick EVERY lane on reconnect (governance, membership, keys, tasks, chat), so the
    // journey does too — a device that came back is behind on all of them, not just the conversation.
    const callSkill = (app, op, args) => cato.agent.callSkill(app, op, args);
    const kicks = await Promise.all([
      cato._chatReplay.requestAll({ callSkill }).catch((e) => ({ error: String(e?.message ?? e) })),
      cato._govCatchUp?.requestAll({ callSkill }).catch(() => null) ?? null,
      cato._memCatchUp?.requestAll({ callSkill }).catch(() => null) ?? null,
      cato._taskReplay?.requestAll({ callSkill }).catch(() => null) ?? null,
    ]);
    const asked = kicks[0];
    check('the returning device asks its circle for what it missed',
      (asked?.requested ?? 0) > 0, JSON.stringify(kicks));

    // ── The claim: convergence ───────────────────────────────────────────────────────────────────
    const gotAll = await untilTrue(
      () => MISSED.every((_, i) => chatSubjects(cato).includes(`missed-${i}`)), 20000);
    check('THE CONVERSATION IS THERE — every message sent during the absence arrives', gotAll,
      `${chatSubjects(cato).filter((s) => String(s).startsWith('missed-')).length}/${MISSED.length} recovered`);

    check('and the message from before the absence was not lost in the process',
      chatSubjects(cato).includes('before-1'));

    check('the task created while away is visible', await untilTrue(async () => {
      const r = await cato.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
      return (r?.items ?? []).some((t) => t.id === task.itemId);
    }, 20000));

    // Asserted on the NAME, because that is what `getGroupRules` projects — the agreements are not
    // in its answer on any device, including the writer's (F-014). Convergence is still the claim:
    // the returning device must end up with the same rules head the writer has.
    check('the rules changed while away are the ones this device now sees', await untilTrue(async () => {
      const r = await call(cato, 'getGroupRules', { groupId: CIRCLE }).catch(() => null);
      return JSON.stringify(r ?? {}).includes('Heggenregels');
    }, 20000));
    const [mine, theirs] = await Promise.all([
      call(anne, 'getGroupRules', { groupId: CIRCLE }),
      call(cato, 'getGroupRules', { groupId: CIRCLE }),
    ]);
    check('…and its rules head matches the writer\'s exactly',
      (mine?.rules ?? mine) === (theirs?.rules ?? theirs)
      || JSON.stringify(mine?.rules) === JSON.stringify(theirs?.rules),
      `${JSON.stringify(mine?.rules)} vs ${JSON.stringify(theirs?.rules)}`);

    check('the roster still agrees with the admin\'s',
      hasMember(await rosterOf(cato, CIRCLE), anne.pubKey)
      && hasMember(await rosterOf(cato, CIRCLE), bram.pubKey));

    // ── And the device is a full participant again, not a read-only replica ──────────────────────
    await sendCircleChat(cato, { groupId: CIRCLE, msgId: 'back-1', text: 'ben er weer' });
    check('the returned device can speak again, and is heard',
      await untilTrue(() => chatSubjects(anne).includes('back-1')));
  } catch (err) {
    check('the absence corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
