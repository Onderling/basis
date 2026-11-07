# Tasks and dispatch

Area: a task from a word to a worked, approved piece of work — adding, claiming, co-owning, decomposing, submitting,
approving; the authority to act on one (roles, mandates); and dispatch: how a task reaches the people or bots that
can do it. First draft, Fable 2026-10-23, from the code on development; fact-checked by Opus the same evening (49 ops, 9 views, tests all present). Core or module: **module** (the task TYPE and
its verbs), over the core's one store per circle and the one `PolicyEngine`.

## What a person can do

- Add a task in a circle, with holders, a due time, labels; a plain line and a full task are one spectrum in the data plane
  (L200, open: Opus leans one rich type where a line is a task with nothing filled in; appointments stay their own type).
- Claim it (co-ownership: `assignees[]` capped by `maxAssignees`), be reassigned, complete it; or, where the circle
  asks for it, submit → approve/reject/revoke by an approver (definition-of-done lifecycle).
- Break it into subtasks (a tree with cycle guards); propose a subtask upward; the master approves or declines.
- See "mine" across every circle (a pure roll-up, stores never merged); an in-app inbox of what waits on you.
- Send a whole list (a container subtree) into another circle.
- Entrust (NL *toevertrouwen*) a task to someone or a bot: a task-scoped mandate token, attenuated, off by default,
  auto-revoked on completion.
- In the household circle, talk to the bot: add / done / list / claim / reassign by chat, nudges and digests.
- Advertise a skill with a posture (`always` | `negotiable`) and `humanInTheLoop`; be asked for input mid-run.

## Where

- **Engine:** `@onderling/item-store` — `CircleItemStore` (per circle, type-indexed) and, in `packages/item-store/src/`,
  `taskLifecycle.js` + `taskCrud.js` (pure functions), `createTaskStore.js` (emitter + audit + sync), `taskCtx.js`.
  In `apps/tasks-v0/src/`: `rolePolicy.js` (the five core roles admin · coordinator · member · observer · external from
  `@onderling/core` ROLES, plus the DoD gates), `dag.js` / `dag-tree.js` (dependencies, subtasks).
- **Basis surface:** `apps/basis/src/v2/tasksOps.js` (the task noun's verbs over the circle's one store, actor =
  the person the call is for, host key = authority); Vandaag/"+" sheet share a task like any item
  (`vandaagPlusShare`); dispatch waist `apps/basis/src/dispatch.js` (`runDispatch`) over `@onderling/app-manifest`
  (`dispatchAtom`, `dispatchCapability`, `capabilitiesOf`).
- **Bot:** `apps/household/manifest.js` nouns `task: {add, list, complete, remove, claim, reassign}`; ops `addTask`,
  `listTasks`, `claim`, `reassign`.
- **Mandates / skills:** `apps/basis/src/v2/mandate.js`, `packages/core/src/protocol/taskExchange.js` (`runGatedSkill`, input-required round-trip),
  `@onderling/offering-match` (the human "I can do X" datum is an offering).
- **Manifest ops, `apps/tasks-v0/manifest.js` (listed by hand until the guard runs):** addTask claimTask confirmClaim
  completeTask getTaskSnapshot removeTask attachTaskGrant reassignTask submitTask approveTask rejectTask revokeTask
  listOpen listMine listClaimable listClaimConflicts resolveClaim listAwaitingApproval listMyMasteredTasks
  listMyPendingClaims listMyInbox clearInboxItem approveSubtaskRequest declineSubtaskRequest approveSubtaskProposal
  declineSubtaskProposal clearInbox getDagTree archiveCircle unarchiveCircle editTask provisionMyCircle myInbox
  getMyAvailability setMyAvailability setAvailabilityOptIn suggestSchedule acceptSchedule getMyCircles
  listMyTasksAcrossCircles getCircleConfig listCircleMembers pauseCircle unpauseCircle issueInvite redeemInvite
  addSubtask proposeSubtask forceSpawnSubtask; pages open mine mastered pending-claims claimable review dag inbox
  pod-settings. The tasks-v0 web pages (`web/*.html`) are the pre-Basis shell: direction since 2026-06-11 is to
  dissolve into Basis; the manifest stays the source of truth.
- **Household manifest ops (task part):** addTask listTasks claim reassign (the rest of that manifest belongs to the
  household-bot and devices pages).

<!-- catalogue-ops
tasks: addTask claimTask confirmClaim completeTask getTaskSnapshot removeTask attachTaskGrant reassignTask submitTask approveTask rejectTask revokeTask listOpen listMine listClaimable listClaimConflicts resolveClaim listAwaitingApproval listMyMasteredTasks listMyPendingClaims listMyInbox clearInboxItem approveSubtaskRequest declineSubtaskRequest approveSubtaskProposal declineSubtaskProposal clearInbox getDagTree editTask myInbox listMyTasksAcrossCircles addSubtask proposeSubtask forceSpawnSubtask
-->

## Proof

- `apps/tasks-v0/test/` — 69 files: lifecycle (`phase10-lifecycle`, `phase5-dod`, `phase7-subtasks`), claims
  (`claim-partition`, `claim-resolve`), DAG (`dag-effectiveStatus`, `dagTreeContainment`), mandates
  (`j8-task-grant`), offline (`j-offline`), roles (`rolePolicy-*`, `rolesReadTheHead`), planner/skills (`v2_4-*`),
  page↔skill drift canary (`page-skill-drift`).
- `apps/basis/test/` — `tasksOps`, `tasksOverCircleStore`, `taskCollaborationThreeDevice` (Anne/Bram/Cato corridor:
  claim, decompose, propose, submit, approve across a wire), `appTaskFanTwoDevice`, `subtaskClaimConfirm.relay`,
  `subtaskClaimConfirmBus`, `atomDispatch`, `dispatch`, `realAgentGenericDispatch`, `vandaagPlusShare.dom`;
  `perTypeSyncMatrix` carries the task type among its 25.
- Walks: the household bot's chores on the tablet (L146, L219); no on-device three-person task walk yet (L409).

## Decided, not built

- **Skill dispatch across circles (L393, ? Needs Frits):** the push of a dependency-met task to the agents holding
  the skill, task auto-claim on posture `always`, request/invocation → task (P4b). Built underneath: posture +
  `humanInTheLoop`, `runGatedSkill`, posture tags, mandates. Pinboard's `claim` noun is a second lifecycle beside
  tasks: unify first (a task can be a CHILD of a request; items nest already).
- **Calendar free/busy over the network:** no — calendar data stays on the device (`iCalReader` is local-only).
- **A second dispatch path for bots:** no — token scoping does the work (architecture §2, "no second dispatch
  path is invented").
- **A separate tasks app/shell:** no — dissolves into Basis (2026-06-11); `tasks` is a navigation label.

## Open rows

L393 (skill dispatch, Needs Frits) · L200 (word ↔ task spectrum, Needs Frits: one rich type vs promotion) · L190 (fold the tasks app onto the
one mechanism; A1·A2 bot, D1·D2 web) · L219 (bot defects a–d) · L199 (role permissions on a bot are the admin's to
set) · L211 (own-devices store does not fan between a person's devices) · L409 (verification stories, incl. a
three-person task walk).

## Decisions that bind this area

- `docs/decisions.md` 2026-07-18 — task-scoped delegation: code term *mandate*, UI term *entrust* / *toevertrouwen*.
- `docs/decisions.md` 2026-07-30 — two token kinds only: role tokens for authority, mandate tokens for acting on
  someone's behalf.
- `docs/architecture.md` "Tasks, roles, and task-scoped grants" — the engine's shape (pure functions over the one
  store; co-ownership; cross-circle roll-up; sendable lists).
- L84 (2026-09-05) — launch shape: one person + assistant; the bot interprets add/done/list.
- Basis speaks no bot words (Frits 2026-10-15): chores/appointments are the bot's language, not Basis's.
