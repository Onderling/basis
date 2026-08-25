// J-tasksession: the corridor Frits actually described — "agents create tasks, share them in circles
// with all kinds of attachments", and other people spin subtasks off them.
//
// The coverage survey listed this as gap 10 and was precise about why it is different from the rest:
// it is **not a missing concept, it is a missing corridor**. Every piece is built and unit-tested —
// `addTask`, the circle fan, `addSubtask`, the DAG, the claim/submit/approve ladder, the task-scoped
// grant — and nothing has ever run them together across three people. So the value here is not in
// any one op; it is in whether the pieces still fit when a real circle uses them in sequence.
//
// Three people, one job:
//   Anne  — creates the work, holds it, and decides what "done" means
//   Bram  — takes a piece of it and hands work back
//   Cato  — a third pair of hands, and the person who must see the same DAG as everyone else
//
// It also folds in gap 6, MANDATES between two people (`attachTaskGrant` — the task-scoped,
// attenuated grant, revoked when the task completes). The survey called that domain unit-only,
// because the grants that have been walked are device/view grants, which are a different thing.
import { checker } from './_util.mjs';
import { bootAppCircle, untilTrue } from './_app.mjs';

export const name = 'J-tasksession (a task with an attachment, shared in a circle, worked on by three)';

const CIRCLE = 'e2e-task-session';

const tasks = (node, op, args) => node.agent
  .callSkill('tasks', op, { circleId: CIRCLE, ...args })
  // Some refusals arrive as a thrown item-store lifecycle error rather than `{error}`. A caller
  // experiences both as "the act did not happen", so normalise — otherwise a legitimate refusal
  // reads as a crash and stops the corridor.
  .catch((e) => ({ error: String(e?.message ?? e) }));
const openIds = async (node) => ((await tasks(node, 'listOpen', {}))?.items ?? []).map((t) => t.id);

export async function run({ relayUrl }) {
  const { results, check } = checker();
  let circle = null;

  try {
    circle = await bootAppCircle({ relayUrl, circleId: CIRCLE, handles: ['anne', 'bram', 'cato'] });
    const [anne, bram, cato] = circle.people;

    // ── 1. THE WORK EXISTS, AND EVERYONE CAN SEE IT ──────────────────────────────────────────────
    const created = await tasks(anne, 'addTask', {
      text: 'de schuur opruimen',
      notes: 'zaterdagochtend, met z\'n drieën',
      definitionOfDone: 'alles wat blijft staat op de planken, de rest is weg',
    });
    check('someone creates the work', !!created?.itemId, JSON.stringify(created)?.slice(0, 140));
    const taskId = created.itemId;

    check('it reaches the second person\'s device',
      await untilTrue(async () => (await openIds(bram)).includes(taskId)));
    // Was F-016: a task created in the moments after cato joined never reached them. The statement
    // arrived and was stored on their rail; the head apply found no circle store yet and returned
    // silently, and nothing re-applied it. Fixed by rebuilding the head when a circle opens.
    check('a task created just after someone joins reaches them too — one circle, one list',
      await untilTrue(async () => (await openIds(cato)).includes(taskId)));

    // "What does done mean" travels with the work, or the definition is decoration.
    const asBram = ((await tasks(bram, 'listOpen', {}))?.items ?? []).find((t) => t.id === taskId);
    check('the DEFINITION OF DONE travels with it',
      String(asBram?.definitionOfDone ?? asBram?.source?.definitionOfDone ?? '').includes('planken'),
      JSON.stringify(asBram)?.slice(0, 200));

    // ── 2. AN ATTACHMENT RIDES ALONG ─────────────────────────────────────────────────────────────
    // The plaintext gate is proven in J-attachments; what matters here is that a SEALED attachment
    // can accompany the work into the circle at all, which is the half Frits named.
    const withFile = await anne.agent.callSkill('stoop', 'postRequest', {
      text: `foto van de schuur (bij: ${taskId})`, intent: 'ask',
      attachments: [{
        type: 'media', mime: 'image/jpeg',
        source: { type: 'blob', ref: `blob://${CIRCLE}/schuur-voor`, enc: { sealed: true } },
      }],
    });
    check('a sealed attachment can accompany the work', !withFile?.error,
      JSON.stringify(withFile)?.slice(0, 140));

    // ── 3. SOMEONE TAKES A PIECE ─────────────────────────────────────────────────────────────────
    const claimed = await tasks(bram, 'claimTask', { id: taskId });
    check('a second person can take the work on', !claimed?.error,
      JSON.stringify(claimed)?.slice(0, 140));
    check('the person who created it sees who took it',
      await untilTrue(async () => {
        const t = ((await tasks(anne, 'listOpen', {}))?.items ?? []).find((x) => x.id === taskId);
        return !!(t?.assignee ?? t?.source?.assignee);
      }), 'assignee visible to the creator');

    // ── 4. THE WORK BREAKS INTO PIECES — the DAG ─────────────────────────────────────────────────
    const sub1 = await tasks(anne, 'addSubtask', { parentTaskId: taskId, text: 'gereedschap sorteren' });
    check('the holder can break the work into a subtask', !!sub1?.task?.id,
      JSON.stringify(sub1)?.slice(0, 160));
    const sub1Id = sub1?.task?.id ?? sub1?.itemId ?? null;

    const sub2 = await tasks(anne, 'addSubtask', { parentTaskId: taskId, text: 'oud hout wegbrengen' });
    check('…and a second one', !!sub2?.task?.id, JSON.stringify(sub2)?.slice(0, 140));
    const sub2Id = sub2?.task?.id ?? sub2?.itemId ?? null;

    check('the subtask reaches the OTHER people, not just its author',
      await untilTrue(async () => (await openIds(cato)).includes(sub1Id)));

    // The DAG is the point: a subtask must know its parent on every device, or "the work broke into
    // pieces" is just three unrelated tasks that happen to have been made at the same time.
    const catoSees = ((await tasks(cato, 'listOpen', {}))?.items ?? []).find((t) => t.id === sub1Id);
    const parents = catoSees?.containedBy ?? catoSees?.source?.containedBy ?? [];
    check('THE SHAPE OF THE WORK SURVIVES THE TRIP — the third person sees the subtask\'s parent',
      (Array.isArray(parents) ? parents : [parents]).includes(taskId),
      JSON.stringify(parents));

    // ── 5. A MANDATE — entrusting a task-scoped authority to one person ──────────────────────────
    // Gap 6. Not a device grant: this one is attenuated to a single task and dies when it completes.
    //
    // `grant` is a COMPOSED param: built by the mandate composer both shells share, not typed by a
    // person or filled by a model, so the manifest deliberately declares only the two scalars — the
    // same policy `addTask` uses for embeds/dependencies. The router passes undeclared args through
    // untouched, so the composer's grant arrives intact.
    //
    // This check asserts the REFUSAL, which is the correct behaviour: a caller who supplies only the
    // declared scalars has not composed a grant, and issuing an empty authority would be worse than
    // refusing. It is written down because reading this refusal as "the op is unreachable" is a
    // mistake already made once here, on a harness that matched neither shell.
    const asDeclared = await tasks(anne, 'attachTaskGrant', { taskId, member: bram.pubKey });
    check('without a composed grant the op refuses rather than issuing an empty authority',
      asDeclared?.error === 'grant required', JSON.stringify(asDeclared)?.slice(0, 160));

    // With the undeclared parameter supplied, the rest of the behaviour can still be walked.
    const GRANT = { skill: 'listOpen' };   // the primitive wants a skill / pod / actingAs
    const mandate = await tasks(anne, 'attachTaskGrant', { taskId, member: bram.pubKey, grant: GRANT });
    check('the holder can entrust a task-scoped authority to a member', !mandate?.error,
      JSON.stringify(mandate)?.slice(0, 160));

    const strangerMandate = await tasks(cato, 'attachTaskGrant', {
      taskId, member: cato.pubKey, grant: GRANT,
    });
    // [F-017] A member who neither created the work nor administers the circle can attach a grant
    // NAMING THEMSELVES, and gets a token back. The gate is `role !== 'admin' && !isCreator`, and
    // every device binds itself as admin of its own tasks circle (`realAgent.js:1969`), so the role
    // half is satisfied for everybody. Same shape as F-009: a per-circle question answered by a
    // table that has no per-circle answer.
    check('[F-017] someone who does not hold the work cannot entrust its authority to themselves',
      !!strangerMandate?.error, JSON.stringify(strangerMandate)?.slice(0, 160));

    // ── 6. HANDING WORK BACK, AND THE GATE ON "DONE" ─────────────────────────────────────────────
    const subClaim = await tasks(cato, 'claimTask', { id: sub1Id });
    check('the third person takes a subtask', !subClaim?.error, JSON.stringify(subClaim)?.slice(0, 120));

    const submitted = await tasks(cato, 'submitTask', { id: sub1Id });
    check('they hand it back for review', !submitted?.error, JSON.stringify(submitted)?.slice(0, 140));

    // …and the person who has to review it must SEE that it came back. This is the half that makes
    // the ladder a conversation rather than two devices with private opinions about the same task.
    const stateAtHolder = async () => {
      const rows = (await tasks(anne, 'listOpen', {}))?.items ?? [];
      const t = rows.find((x) => x.id === sub1Id);
      return t?.state ?? t?.status ?? t?.source?.state ?? null;
    };
    const cameBack = await untilTrue(async () => {
      const st = String(await stateAtHolder() ?? '');
      return st && st !== 'open';
    }, 15000);
    check('THE HANDBACK REACHES THE REVIEWER — they see it is no longer merely open',
      cameBack, `holder sees state: ${await stateAtHolder()}`);

    // The whole job cannot be waved through while it is still being worked on. (The refusal here is
    // the lifecycle gate — the parent is `claimed`, not submitted — which is a different rule from
    // the open-child one; the check asserts the refusal it actually gets rather than claiming both.)
    const earlyApprove = await tasks(anne, 'approveTask', { id: taskId });
    check('the WHOLE JOB cannot be approved while it is still being worked on',
      !!earlyApprove?.error, JSON.stringify(earlyApprove)?.slice(0, 140));

    const approved = await tasks(anne, 'approveTask', { id: sub1Id });
    check('the holder approves the finished piece', !approved?.error,
      JSON.stringify(approved)?.slice(0, 140));

    check('the finished piece leaves everyone\'s open list — absence is the signal',
      await untilTrue(async () => !(await openIds(cato)).includes(sub1Id)));

    // ── 7. WHO MAY SAY "DONE" ────────────────────────────────────────────────────────────────────
    const notMine = await tasks(cato, 'approveTask', { id: sub2Id });
    check('a bystander cannot approve work they do not hold', !!notMine?.error,
      JSON.stringify(notMine)?.slice(0, 140));
  } catch (err) {
    check('the task-session corridor completed', false, String(err?.message ?? err).slice(0, 250));
  } finally {
    await circle?.close?.().catch(() => {});
  }
  return results;
}
