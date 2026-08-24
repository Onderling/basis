/**
 * THE COLLABORATIVE TASK CORRIDOR, across three people (cycle 4 of the testing programme).
 *
 * What Frits means by "task sessions": someone creates a task, it goes into a circle, and other
 * people work it — claiming, decomposing it into subtasks, proposing work back up, submitting and
 * approving. Every piece of that is built; what nothing covered is the pieces running TOGETHER with
 * more than two participants. The survey (2026-08-23) found no three-person task journey at all, and
 * neither the proposal protocol nor the submit/approve arc had ever crossed a wire.
 *
 * Three people, because two cannot show the thing that actually goes wrong in shared work:
 *   Anne — creates the task and owns it (the master)
 *   Bram — does the work: claims, decomposes, proposes, submits
 *   Cato — the THIRD person: never touches the task, and must nevertheless see the same truth
 *
 * The corridor:
 *   1. Anne posts a task into the circle          → all three see it
 *   2. Bram claims it                              → the claim is visible to Anne AND Cato
 *   3. Bram decomposes it (a subtask)              → the parent/child edge survives the wire
 *   4. Bram PROPOSES a subtask upward              → Anne approves it → it exists for everyone
 *   5. Bram submits the work → Anne approves       → the task closes for all three
 *
 * Each step asserts on the OTHER devices, not on the actor's own: a corridor that only checks the
 * writer's store proves nothing about a circle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';

const CIRCLE = 'shared-work-three';

/** Reinstall production's inbound routing so fanned envelopes drive each node's stores. */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return undefined; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

const tasksOf = async (node) => {
  const res = await node.agent.callSkill('tasks', 'listOpen', { circleId: CIRCLE });
  return Array.isArray(res?.items) ? res.items : [];
};
const findById = (rows, id) => rows.find((t) => t.id === id) ?? null;
/** Wait until `pred` sees the task on THAT node's store. */
const sees = (node, pred, label) => until(async () => {
  const rows = await tasksOf(node);
  return pred(rows) ? rows : null;
}, { timeout: 20000, step: 150 }).then((r) => {
  expect(r, label).toBeTruthy();
  return r;
});

describe('the collaborative task corridor — three people, one circle', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); });

  it('create → claim → decompose → the parent is blocked until the child closes → submit + approve, seen by all three', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
      bootRealAgentNode('C', { taskLane: true }),
    ]);
    await connectNodesOverBus([A, B, C]);
    for (const n of [A, B, C]) wireInboundLikeShell(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Gedeeld werk' });
    for (const [joiner, handle] of [[B, 'bram'], [C, 'cato']]) {
      const r = await joinExistingCircle(A, joiner, { groupId: CIRCLE, handle });
      expect(r.joined?.ok, JSON.stringify(r.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, C], CIRCLE);
    // Bind every member's circleAddress→pubKey (the half without which a send to a per-circle address
    // throws above the transport), then WARM each pair while everyone is online so first delivery is
    // deterministic rather than a first-contact handshake race.
    await Promise.all([A, B, C].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    for (const peer of [B, C]) {
      await A.agent.sendPeerMessage(peer.pubKey,
        { type: 'p2p-chat', subtype: 'chat-message', msgId: `warm-${peer.label}`, body: 'warm' },
        { hold: true, firstSendTimeoutMs: 2000, retryDelays: [] });
      await until(() => peer.received.find((m) => m.payload?.body === 'warm'), { timeout: 8000 });
    }
    // Each receiver OPENS the circle before anything is fanned: that is what wires its tasks store
    // inbound, so a fanned envelope has a listener to land in (the same thing a shell does on open).
    for (const n of [A, B, C]) expect(await tasksOf(n), `${n.label} starts empty`).toEqual([]);

    // ── 1. Anne posts the work ────────────────────────────────────────────────────────────────────
    const created = await A.agent.callSkill('tasks', 'addTask', { text: 'de heg snoeien', circleId: CIRCLE });
    const taskId = created?.itemId;
    expect(taskId, JSON.stringify(created)).toBeTruthy();

    await sees(B, (rows) => findById(rows, taskId), 'the worker sees the new task');
    await sees(C, (rows) => findById(rows, taskId), 'the THIRD person sees it too — a circle, not a DM');

    // ── 2. Bram claims it — and the claim must be visible to the people who did NOT claim ─────────
    const claim = await B.agent.callSkill('tasks', 'claimTask', { circleId: CIRCLE, id: taskId });
    expect(claim?.error, JSON.stringify(claim)).toBeUndefined();

    const claimed = (rows) => {
      const t = findById(rows, taskId);
      const who = t?.confirmedAssignee ?? t?.assignee ?? (t?.assignees ?? [])[0] ?? null;
      return !!who;
    };
    await sees(A, claimed, 'the owner sees that someone took the work');
    await sees(C, claimed, 'the bystander sees it too — nobody has to ask who is doing it');

    // ── 3. Bram decomposes the work — the parent/child edge has to survive the wire ───────────────
    const sub = await B.agent.callSkill('tasks', 'addSubtask', { circleId: CIRCLE, parentTaskId: taskId, text: 'takken afvoeren' });
    const subId = sub?.task?.id ?? sub?.itemId ?? sub?.id;   // the op returns the created task nested
    expect(subId, JSON.stringify(sub)).toBeTruthy();

    const hasChildOfParent = (rows) => {
      const child = findById(rows, subId);
      // `containedBy` is an ARRAY (an item can be contained by more than one parent).
      const parents = Array.isArray(child?.containedBy) ? child.containedBy
        : (child?.containedBy ? [child.containedBy] : []);
      return !!child && (parents.includes(taskId) || child.parentTaskId === taskId);
    };
    await sees(A, hasChildOfParent, 'the subtask arrives at the owner WITH its parent edge intact');
    await sees(C, hasChildOfParent, 'and at the third person — the tree is circle truth, not local');

    // ── 4. Bram offers the work as done ──────────────────────────────────────────────────────────
    const submitted = await B.agent.callSkill('tasks', 'submitTask', { circleId: CIRCLE, id: taskId, note: 'klaar' });
    expect(submitted?.error, JSON.stringify(submitted)).toBeUndefined();
    await sees(A, (rows) => {
      const t = findById(rows, taskId);
      return t && (t.submittedAt || t.state === 'submitted' || t.awaitingApproval || (t.reviewLog ?? []).some((r) => r.decision === 'submit'));
    }, 'the owner is told the work is offered for approval');

    // ── 5. …but the owner cannot CLOSE it while a subtask is still open ──────────────────────────
    // Decomposition has to mean something: approving the top while a child is outstanding would let
    // work disappear behind a tick. Submitting is allowed (the worker says "my part is done");
    // closing is not, and the refusal names exactly what is blocking it.
    const blocked = await A.agent.callSkill('tasks', 'approveTask', { circleId: CIRCLE, id: taskId, note: 'af?' });
    expect(blocked?.ok, `approving over an open child must be refused: ${JSON.stringify(blocked)?.slice(0, 160)}`).toBe(false);
    expect(String(blocked?.error ?? ''), 'the refusal names the open dependency').toContain(subId);

    // ── 6. Close the child, then the parent — and the whole circle ends in one state ──────────────
    const childDone = await B.agent.callSkill('tasks', 'completeTask', { circleId: CIRCLE, id: subId });
    expect(childDone?.error, JSON.stringify(childDone)).toBeUndefined();

    // The OWNER must actually see the child close before the parent can be approved — the guard reads
    // the approver's own store, so this is the honest sequencing a person experiences too.
    // `listOpen` lists OPEN work, so a closed child leaves it — that absence IS the signal.
    await sees(A, (rows) => !findById(rows, subId), 'the child\'s completion reaches the owner');

    const approved = await A.agent.callSkill('tasks', 'approveTask', { circleId: CIRCLE, id: taskId, note: 'mooi' });
    expect(approved?.error, JSON.stringify(approved)).toBeUndefined();
    await sees(C, (rows) => {
      const t = findById(rows, taskId);
      return !t || t.completedAt || t.state === 'done' || t.approvedAt;
    }, 'the third person sees the work close — one circle, one state, not three');
  }, 180_000);

  // The regression pin for the propose-flow. It was quarantined while `proposeSubtask` wrote an
  // item of type `subtask-proposal` that no registry knew, so `CircleItemStore.put` refused it —
  // and the manifest had been declaring `{type: 'inbox-item', kind: 'subtask-proposal'}` for these
  // ops the whole time. The noun is registered now and the writers, readers and gates all speak it.
  it('the owner proposes extra work on submitted work, and the assignee consents', async () => {
    // Its own task, carried to the SUBMITTED state the propose-flow applies to. The assertions below
    // were written against the sibling test's `taskId` while this one was quarantined and never ran,
    // so they never saw that a `const` in another `it()` is not in scope here.
    const made = await A.agent.callSkill('tasks', 'addTask', { circleId: CIRCLE, text: 'de heg snoeien' });
    const taskId = made?.itemId;
    expect(taskId, JSON.stringify(made)).toBeTruthy();
    await sees(B, (rows) => findById(rows, taskId), 'the worker sees the task to propose against');
    const claimed = await B.agent.callSkill('tasks', 'claimTask', { circleId: CIRCLE, id: taskId });
    expect(claimed?.error, JSON.stringify(claimed)).toBeUndefined();
    const handedIn = await B.agent.callSkill('tasks', 'submitTask', { circleId: CIRCLE, id: taskId, note: 'klaar' });
    expect(handedIn?.error, JSON.stringify(handedIn)).toBeUndefined();
    await sees(A, (rows) => findById(rows, taskId)?.state === 'submitted',
      'the owner sees the work handed in, which is what a proposal applies to');

    // ── 5. "Not quite done": the OWNER proposes extra work instead of approving ────────────────────
    // This is the propose-flow's real shape: `proposeSubtask` only applies to a SUBMITTED task with an
    // assignee, and only the master/admin may raise it — because it asks someone else to do more. The
    // assignee then has to consent, which is the journey "a subtask on someone else's task needs their
    // say-so". A proposal that took effect without that consent would be the finding.
    const proposal = await A.agent.callSkill('tasks', 'proposeSubtask', {
      circleId: CIRCLE, parentTaskId: taskId, text: 'ook het tuinpad aanvegen',
    });
    expect(proposal?.error, JSON.stringify(proposal)).toBeUndefined();
    const proposalId = proposal?.proposalId ?? proposal?.proposal?.id ?? proposal?.itemId ?? proposal?.id ?? null;
    expect(proposalId, `the proposal has an id: ${JSON.stringify(proposal)?.slice(0, 200)}`).toBeTruthy();

    // The ASSIGNEE consents — and only then is the extra work real. A retries until the proposal has
    // replicated to B: it is written on the owner's device and has to cross the circle first, so
    // "proposal not found" is a not-yet, not a no. Every other wait in this file is the same shape.
    const consent = await until(async () => {
      const r = await B.agent.callSkill('tasks', 'approveSubtaskProposal', { circleId: CIRCLE, proposalId });
      return r?.error === 'proposal not found' ? null : r;
    }, { timeout: 20000, step: 150 });
    expect(consent?.error, JSON.stringify(consent)).toBeUndefined();

    await sees(C, (rows) => rows.some((t) => (t.text ?? '').includes('tuinpad')),
      'once the assignee consents, the extra work is real for the whole circle');

  }, 180_000);
});
