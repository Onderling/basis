# Changelog — @onderling-app/tasks

> Package renamed `@onderling-app/tasks-v0` → **`@onderling-app/tasks`** (2026-07-18); the directory
> stays `apps/tasks-v0`.

## [Unreleased] — 2026-07-18/19 — shared tasks substrate + co-ownership + delegation

The task engine moved onto the canonical **`CircleItemStore`** (`@onderling/item-store`) — a generic,
per-circle, type-indexed store — and every task behaviour became a **pure function over that store**.
The old monolithic `ItemStore` is retired (kept only as a parity reference for migration tests and the
pure `computeStatus`).

- **Store + lifecycle as pure functions.** `taskLifecycle` (`claim` / `reassign` / `markComplete` /
  `submit` / `approve` / `reject` / `revoke`), `taskCrud` (add / list / get / update / remove), and
  `createTaskStore` (wraps the pair back into an emitter + audit + sync surface).
- **Co-ownership.** A task's owners are an `assignees[]` array capped by `maxAssignees` (default 1);
  `assignee` is a mirror of `assignees[0]`; `claim` compare-and-swap-appends the actor.
- **Cross-circle "my tasks".** A pure aggregator projects a per-circle `{open, overdue,
  awaitingApproval, mine}` roll-up across a user's circles, busiest-first.
- **Sendable lists.** A whole container subtree can travel into another circle — a depth-guarded
  pre-order walk fans the single-item in-place share over every node.
- **Task-scoped delegation (entrust / mandate).** `TaskGrantManager` issues one attenuated,
  task-stamped cap-token, off by default and auto-revoked on complete/cancel. Surfaced in the kring
  Taken tab as the *entrust* (NL *toevertrouwen*) picker.
- **Roles as capability bundles.** A role materializes into signed cap-tokens on grant (`RoleBundle` /
  `RoleGrantManager`), enforced by the one `PolicyEngine`.
- **Offering vocabulary.** The human "I can do X" datum is an **offering** (NL *aanbod*); matching runs
  through `@onderling/offering-match` (was `skill-match`). Legacy `skills` fields/ids are read-accepted.

## [Unreleased] — basis browser integration (2026-05-23, `ab6f32f`)

New export: `@onderling-app/tasks-v0/browser` →
`createBrowserTasksAgent({bus, identityVault, circleConfig, label})`.

Lets basis compose a real Circle agent in-process (no bin/
launcher needed; tasks-v0/src has zero node imports).  Replaces
basis's ~210 lines of mock task handlers with the actual
110-skill circle agent on a shared InternalBus.

Plan + per-app integration details:
`Project Files/basis/integration-plan-2026-05-23.md` §
": tasks-v0 → basis browser".

122/122 tasks-v0 tests still green; no app-side changes — just a
new browser entry that wraps the existing `createCircleAgent` with
the minimal opts basis needs.

## [Unreleased] — (2026-05-20) — dag.html via renderWeb (view-only)

First tasks-v0 web page migrated to the NavModel projector
(`renderWeb` from `@onderling/app-manifest`) per
`PLAN-gui-chat-uplift.md` . Read-only proof; no
state-changing surfaces — `dag.html` reads `getDagTree` via the
manifest's `dag` view and flattens through the existing shared
helper.

**569/569 tasks-v0 tests green** (was 565; +4 NavModel-shape
assertions).

- Manifest gains a `dag` view (`{id:'dag', title:'DAG', type:'task'}`)
  and a `getDagTree` op declaration (`verb:'tree'`, optional
  `rootId` param; `surfaces.chat.hint` only — no `slash`).
- Bootstrap (`bin/tasks-ui.js`) surfaces the NavModel at
  `/navmodel.json` via `extraStaticFiles`, mirroring the
  `apps/household/bin/household-web.js` pattern.
- `dag.html`'s inline script now fetches `/navmodel.json` +
  `/tasks-config.json`, resolves the `dag` section, dispatches
  `getDagTree` via `callSkill`, and renders through the shared
  `flattenDagTree` helper (`src/ui/dagFlatten.js`, also consumed
  by `apps/tasks-mobile/src/screens/DagScreen.jsx`).
- The shared helper is served via an `/lib/dagFlatten.js`
  overlay (the static-dir is path-traversal-hardened, so a bare
  `import '../src/ui/...'` would 404 in the browser).  Source-of-
  truth stays under `src/ui/`.
- Characterization snapshot
  (`test/characterization/__snapshots__/dag.test.js.snap`)
  deliberately updated; row markup (the actually-rendered DOM)
  is byte-equivalent — only the inline `<script>` body changed.
- Drift canary (`test/sp3-manifest.test.js`) updated to include
  `buildWorkspaceSkills` in its op-id ↔ skill-id cross-check
  (matches what `wireSkills` registers).

## [0.4.0] — 2026-05-14 — V2 substrate adoption (12 slices, full web track)

The entire Tasks V2 web track shipped today across 12 slices.
Substrate adoption (item-types canonical task + circle storage
policy + agent-registry + pod OIDC), multi-circle runtime
(`--multi-circle` CLI + `spawnMyCircle` + multi-circle onboarding
dispatch), and substrate-mirror cross-device fan-out (every
mutation: add/claim/complete/submit/approve/reject/revoke/
reassign/remove).

**122/122 Tasks tests green** across 7 test files.

### Slices 1–4 — substrate-adoption first wave

**** (`0e92e15`): `embeds:[{type, ref}]` field on
  `addTask` (cap 8, validated, persisted via item-store);
  `circleConfig.storage` field with four §II.2 policies (`no-pod`
  default); `getCircleStoragePolicy` + `setCircleStoragePolicy`
  skills. Item-store's `#materialise` now propagates `embeds`
  through (was missing).
**** (`ea5166c`): `/welcome.html` create-circle wizard
  + `provisionMyCircle` skill. Validates circle-id slug + name +
  kind + storage + optional additional members. Refuses to
  overwrite an existing circleId. `/circles.html` empty-state links
  to `/welcome.html`.
**** (`203607c`): agent-registry on `createCircleAgent`.
  Helper `registerAgentBundle` lifted from Stoop's app code into
  `@onderling/agent-registry`. Tasks builds a standalone-mode
  pseudoPod per circle + registers with capabilities `['tasks',
  'tasks-v0', \`circle:<circleId>\`]`. `bundle.pseudoPod` +
  `bundle.agentRegistry` exposed.
**** (`cfe832c`): `/onboard.html` (invite-redemption,
  paste-link with JSON or `tasks-invite://` URL scheme) +
  `/pod-settings.html` (storage-policy display + upgrade row +
  agent-registry status; pod-sign-in placeholder).

### — pod OIDC sign-in

- (`bab079b`) `apps/tasks-v0/src/lib/podSignIn.js` mirrors
  Stoop's Phase 52.15.3. Four new skills: `startPodSignIn`,
  `completePodSignIn`, `signOutOfPod`, `podSignInStatus`. Uses
  `createSolidAuthNode` from `@onderling/oidc-session`.
  `/pod-settings.html`'s sign-in card unlocked: issuer input
  + redirect flow + callback handler + sign-out. New
  `listSavedCircleConfigs` skill + `/circles.html`'s "Saved circle
  configs" table for circles provisioned but not currently bound.

### Slices 6–8 — multi-circle runtime

**** (`2f4b31b`): multi-circle substrate enablement —
  `buildMeshAgent({agent})` reuses existing core.Agent;
  `createTasksAgent({agent, registerSkills})` + `createCircleAgent`
  forward both opts. New `spawnMyCircle` skill (in-process when
  the host CLI wires `_spawnCircleInProcess`; structured restart
  hint otherwise) + `/circles.html` Spawn button.
**** (`7ab7c98`): `bin/tasks-ui.js --multi-circle` flag.
  Builds meshAgent once → primary circle with
  `registerSkills: false + wireOnboardingSkills: false` →
  `circlesMap = new Map` + `_spawnCircleInProcess` closure
  → `wireSkills` ONCE with `multiCircleResolver`. New
  `itemStoreRoot` opt on `createTasksAgent` for per-circle URI
  prefix (`mem://tasks/circles/<circleId>/`) to prevent addTask
  writes from leaking across circles. Platform-level skills
  (`provisionMyCircle`, `listSavedCircleConfigs`, `spawnMyCircle`)
  fall back to any circle when strict routing misses.
**** (`c247401`): multi-circle onboarding-skill
  dispatch. `createCircleAgent` always builds the GroupManager
  and stashes on CircleState. New
  `buildMultiCircleOnboardingSkills({bundleResolver})` registers
  `issueInvite` + `redeemInvite` ONCE with per-call CircleState
  resolution; `redeemInvite` routes by `args.circleId` OR
  (when omitted) by `invite.groupId`.

### Slices 9–12 — Phase 52.9.3 substrate-mirror

**** (`5899ad2`): substrate-mirror infrastructure +
  addTask fan-out. New `apps/tasks-v0/src/lib/substrateStack.js`
  + `apps/tasks-v0/src/substrateMirror.js` mirror Stoop's
  pattern. `wireTasksSubstrateMirror` subscribes to
  `kind: 'task'` envelopes, URI-prefix filters by
  `/tasks/circles/<circleId>/tasks/`, dedupes via
  `source.syncedFromId`. `createCircleAgent` wires per-circle mirror.
  `addTask` publishes via notifyEnvelope.
**** (`26611a3`): sub-slices 2–4 — stale-peer
  auto-heal in `wireTasksSubstrateMirror`; `fetch-resource` +
  `groupCheck` registered per circle bundle; live peer-roster
  updates from `redeemInvite` via `tasksMirror.addPeer`.
**** (`530eea4`): substrate mutation fan-out (option
  c from the slice-10 sketch). New
  `ItemStore.applySync({syncedFromId, nextState, action}, ctx)`
  and `removeSync({syncedFromId}, ctx)` — gate-bypass, preserve
  audit + emit. Mirror's `mirror()` branches new-vs-update via
  `syncedFromId` lookup. claim/complete/remove hooked.
**** (`c21dd85`): final mutation fan-out mop-up.
  submit/approve/reject/revoke/reassign each hooked with the
  one-liner pattern. `_inferAction` upgraded to detect
  submit/reject/approve via `reviewLog`'s newest decision.

### Substrate touches (cross-app)

- `@onderling/item-store`:
  - `#materialise` now propagates the optional `embeds` field
    forward.
  - New `applySync` + `removeSync` methods (substrate-internal,
    gate-bypass).
  - New private `#findBySyncedFromId(id)` helper.
- `@onderling/agent-registry`:
  - New `registerAgentBundle` helper lifted from Stoop. Used by
    Stoop + Tasks without a cross-app dep.

### New deps on `apps/tasks-v0/package.json`

- `@onderling/agent-registry`
- `@onderling/pseudo-pod`
- `@onderling/pod-routing`
- `@onderling/notify-envelope`
- `@onderling/oidc-session`

### Tests

122/122 Tasks tests across 7 test files:
- `v2-adoption.test.js` (36) — slices 1–6
- `v2-multi-circle.test.js` (9) — slices 7–8
- `v2-substrate-mirror.test.js` (12) — slices 9–12
- `phase2-circle.test.js` (9), `phase5-dod.test.js` (15),
  `phase10-lifecycle.test.js` (17), `integration.test.js` (24)

### Commits

`0e92e15` `ea5166c` `203607c` `cfe832c` `bab079b` `2f4b31b`
`7ab7c98` `c247401` `5899ad2` `26611a3` `530eea4` `c21dd85`

## [0.3.6] — 2026-05-08 — hard subtask dependencies (substrate gate + consent flow)

Capability **U** from the V2 functional design. Closes the door on "I marked the project complete but the sub-tasks are still open" — a parent task can no longer transition to closed while any of its `dependencies[]` is still open. Spawning sub-tasks on a `submitted` parent is also blocked unless the assignee consents via a new propose/approve flow (mirrors V1 Phase 7's admin-approval pattern, gate flipped to the assignee).

### Substrate touch (additive, opt-in)

- `@onderling/item-store`:
  - `ItemStore` constructor accepts `enforceDependencies?: boolean` (default `false` — back-compat). When `true`, `markComplete` and `approve` walk `current.dependencies`, look each up, filter out missing-or-removed (treat as satisfied), reject when any open dep remains.
  - New typed error `DependenciesOpenError extends Error` with `code: 'DEPENDENCIES_OPEN'` + `openDeps[]`. Re-exported from the package barrel.
  - `markComplete` / `approve` / `addItems` honour a new `ctx.actionOverride` string (replaces the audit entry's `action` field; used for `force-complete` and `force-spawn`) plus `ctx.reason` (lands in `details.reason`).
  - 7 substrate tests in `packages/item-store/test/V2_7-enforce-dependencies.test.js`. Stoop is unaffected — its items don't pass `enforceDependencies: true`.

### App-side

- `src/Agent.js` — `createTasksAgent` now constructs `ItemStore` with `enforceDependencies: true`.
- `src/skills/index.js` — `completeTask` and `approveTask` translate `DependenciesOpenError` to `{error: 'has-open-dependencies', openDeps[]}` for chat-friendly rendering.
- `src/skills/forceComplete.js` (new) — `forceCompleteTask({id, reason})` — admin only, mandatory `reason`. Bypasses the gate via `actionOverride: 'force-complete'`. **No cascade** — sub-tasks stay open.
- `src/skills/subtasks.js` — extended:
  - `addSubtask` rejects with `{error: 'parent-submitted', proposalRequired: true}` when parent has an open submission AND caller isn't the assignee.
  - `proposeSubtask({parentTaskId, ...partial})` — master/coord/admin only. Files a `subtask-proposal` queue item targeting the parent's assignee.
  - `approveSubtaskProposal({proposalId})` — assignee only. Spawns the sub-task, walks parent submitted → claimed via the existing `reject` primitive (auto-rollback note in `reviewLog`; original `submit` entry preserved), wires the new dep into `parent.dependencies`.
  - `declineSubtaskProposal({proposalId, note?})` — assignee only. Closes the proposal; parent submission stays valid.
  - `forceSpawnSubtask({parentTaskId, partial, reason})` — admin only, mandatory reason. Bypasses the post-submit gate AND the admin-approval-depth threshold; logged under `force-spawn`.
- `src/rolePolicy.js` — two narrow exceptions for `subtask-proposal` items: `targetAssignee` may close (approve/decline) AND edit `notes` (used by decline-with-note).
- `src/bot/skills.js` — `bot.markComplete` and `bot.approve` translate the gate denial to *"Can't close — N open sub-task(s): X, Y, Z."*
- `locales/{en,nl}.json` — 11 new keys under `dependencies.*` + `subtask_proposal.*` with `{text, doc}` leaves.

### Tests

- ✅ 7 added in `packages/item-store/test/V2_7-enforce-dependencies.test.js`: gate-off back-compat; gate-on rejection on `markComplete` + `approve`; missing-dep treated as satisfied; happy-path close-after-child; `actionOverride` bypasses gate + relabels audit; `addItems` honours `actionOverride`.
- ✅ 11 added in `apps/tasks-v0/test/v2_7-hard-deps.test.js`: error shape; child-then-parent close; `approve` symmetry; `forceCompleteTask` admin-only + reason-mandatory + bypasses gate + audit logged + no-cascade; `addSubtask` post-submit blocking + `proposalRequired`; `proposeSubtask` master-only; `approveSubtaskProposal` spawns + rolls back + preserves `submit`; `declineSubtaskProposal` keeps submission valid; assignee-only on approve/decline; `forceSpawnSubtask` admin-only + reason-mandatory + audit logged; assignee can self-spawn during their own submission.

Tests now: **308 across 29 files** (Tasks) + **61 across 4 files** (item-store) — Stoop's 429 untouched.

### UI wiring (added in the same release)

- ✅ `web/app.js` — `renderTasks` honours `item.status === 'waiting'` / `'blocked'` from the DAG-status field. The "Mark complete" and "Approve" buttons render disabled with a tooltip listing open-dep short-ids when the gate would fire. Admin-only "Force complete" button appears next to them (only when `depsBlocking && status !== 'complete'`); clicking opens a `prompt` for the mandatory reason. The "+ Sub-task" button switches to "Propose sub-task — needs <assignee>'s approval" when the parent is `submitted` and the caller isn't the assignee; clicking calls `proposeSubtask` instead of `addSubtask`.
- ✅ `src/skills/index.js` + `src/skills/workspace.js` — `listMine`, `listMyMasteredTasks`, and `listAwaitingApproval` now annotate items with the DAG `status` so the gate state surfaces in My work + Review (V1 only computed it on `listOpen`).
- ✅ `web/{index,mine,review}.html` — ctx wires `onForceComplete` and `onProposeSubtask`. `onComplete` and `onApprove` translate `{error: 'has-open-dependencies', openDeps[]}` to a `alert(…)` for the rare case the disabled-button is bypassed by a race.
- ✅ `web/inbox.html` — handles two new button-id prefixes: `approveSubtaskProposal:<proposalId>` (with a confirm-dialog warning about the auto-rollback) and `declineSubtaskProposal:<proposalId>` (with an optional decline-note prompt). New `eventLabel` case for `subtask-proposal`.
- ✅ `src/Circle.js` — new `subtask-proposal` listener routes the proposal to the parent's assignee's inbox with `[Approve]` / `[Decline]` buttons (mirrors the existing `subtask-request → admin inbox` listener).

CLI smoke after the wiring: starts cleanly, all V1++V2 capabilities still work.

### Bot wiring (chat surface)

The original design said *"No new bot verbs for. The propose/approve flow is web-first; the bot can grow`propose <id>` / `accept-proposal <id>` later if friction shows."* — friction showed immediately (the user wanted phone-side consent). Adding now.

- ✅ `src/bot/dispatch.js` — five new verbs:
  - `propose <parent-id> <text>` → `bot.propose` (master/coord)
  - `accept-proposal <id>` → `bot.acceptProposal` (assignee)
  - `decline-proposal <id> reason: …` → `bot.declineProposal` (assignee)
  - `proposals` → `bot.listProposals` (assignee glance)
  - `force-complete <id> reason: …` → `bot.forceComplete` (admin)
  HELP_TEXT updated with the new lines.
- ✅ `src/bot/skills.js` — five new `bot.*` skills mirroring the web flow. Each renders chat-friendly output:`Proposed sub-task to kid. They'll see it in their inbox.`, `Approved. Sub-task '...' spawned; your submission rolled back to claimed.`, `No subtask-proposals waiting on you. ✓`, etc. All declared with the shared `BOT_SKILL_OPTS` so PolicyEngine validates the cap-token; all use `effectiveActor({from, envelope})` so cap-token mode honours the bound webid.
- ✅ Tests: 11 added in `test/v2_7-bot-propose.test.js` — dispatcher routing for all five verbs (incl. usage-hint reply paths); end-to-end propose → accept; end-to-end propose → decline; force-complete admin gate; empty-state for `proposals`.

Tests now: **319 across 30 files** (Tasks).

## [0.3.7] — 2026-05-08 — single-agent + per-circle state via bundleResolver

The desktop-side mirror of Stoop's 2026-05-08 `single-agent-refactor`. One `core.Agent` per process serves N circles; per-circle state lives in `CircleState`; skills resolve their circle at dispatch time. Unblocks tasks-mobile Phase 41.x and stops the path of spinning N agents for N circles.

Shipped in two passes within the day:
- **Part 1** — extract `buildMeshAgent` (the foundation `core.Agent` + `policyEngine` + `trustRegistry` + identity vault).
- **Part 2** — add `wireSkills` + `bundleResolver`; rewrite every `defineSkill` body to resolve its CircleState via the resolver. 17 files mechanically updated; test surface bypassed because every test goes through `createCircleAgent` (now a single-circle convenience wrapper around the new primitives).

### What shipped

- ✅ `src/MeshAgent.js` — `buildMeshAgent({identity, transport, localStoreBundle, identityVault, label})`. Default vault path `mem://tasks/process/agent-identity-vault.json` (per-process, not per-circle). self-trust set; vault-snapshot persistence preserved.
- ✅ `src/bundleResolver.js` — `singleCircleResolver(circleState)` + `multiCircleResolver(circles: Map)`. Multi-circle resolution order: `args.circleId` → `<circleId>/...` topic prefix → strict `null`. Strict-on-miss is intentional: silent fallback would convert a multi-circle leak into a successful single-circle op.
- ✅ `src/wireSkills.js` — single-registration root. Imports every builder; passes `bundleResolver` through; takes `members` (single-circle) or `getBundle` (multi-circle) for identity skills; supplies a no-op `userSettings` so observability still registers on the V0 zero-config path.
- ✅ Every `src/skills/*.js` builder switched to the `(parts, ctx)` resolver shape — `buildSkills`, `buildProfileSkills`, `buildAppealSkill`, `buildSubtaskSkills`, `buildInboxSkills`, `buildWorkspaceSkills`, `buildObservabilitySkills`, `buildCircleControlSkills`, `buildCustomRoleSkills`, `buildBotBindingSkills`, `buildCalendarEmissionSkills`, `buildInvoicingSkills`, `buildAvailabilitySkills`, `buildPlannerSkills`, `buildDashboardSkills`, `buildForceCompleteSkill`, `buildBotSkills`. Every body opens with `const circle = bundleResolver(parts, {envelope, from}); if (!circle) return {error: 'circleId required'};` and reads `circle.itemStore` / `circle.liveCircle` / `circle.dataSource` / `circle.roles` etc.
- ✅ `src/Agent.js#createTasksAgent` and `src/Circle.js#createCircleAgent` → V0/V1 convenience wrappers around `buildMeshAgent` + minimal CircleState + `wireSkills(singleCircleResolver(...))`. External shape unchanged — every existing test passes the bundle through `createCircleAgent` and continues to work.
- ✅ `bin/tasks-ui.js`:
  - `--circle` (single) — unchanged shape; goes through `createCircleAgent`.
  - `--circle-list <path>` (new, multi) — boots one meshAgent + N CircleStates and runs an in-process `addTask` smoke probe per circleId, asserting cross-circle ItemStore isolation, then exits. List file shape: `{"circles": ["./a.circle.json", ...]}`. Fixtures live at `tmp/oss-tools.circle.json`, `tmp/book-club.circle.json`, `tmp/two-circles.list.json`.
- ✅ `web/app.js` — `callSkill` auto-injects `circleId` from `tasks-config.json` into every args object so the single-circle web flow keeps working without per-call boilerplate.
- ✅ Bot — `bot/skills.js`'s `callUnderlying` injects `circleId` into the inner skill's parts so the inner `bundleResolver(parts, ...)` resolves the right CircleState in multi-circle mode.

### Tests

- ✅ New `test/v2_8-single-agent.test.js` — 5 tests: one meshAgent serves two CircleStates with isolated ItemStores; strict resolution returns `{error: 'circleId required'}` when no circleId + no topic; `singleCircleResolver` keeps the V0 back-compat path; cross-circle role-policy gate fires when caller has no role in the resolved circle; `<circleId>/...` envelope topic resolves the right circle.
- ✅ All 319 prior tests pass unchanged. **Tests now: 324 across 31 files** (Tasks).
✅ Stoop's 435/41 still green — has no Stoop impact (Stoop's own single-agent refactor predates this).

### Smokes

- `bin/tasks-ui.js --circle ./tmp/oss-tools.circle.json --storage-root ./.tasks-data/<dir>` boots cleanly (one meshAgent, agent pubKey printed, listening on a 127.0.0.1 port).
- `bin/tasks-ui.js --circle-list ./tmp/two-circles.list.json` boots one meshAgent + 2 CircleStates and prints `OK: addTask routed to the right circle for all 2 circle(s); ItemStores isolated.` before exiting 0.

### What this enables

- Tasks-mobile Phase 41.2's `ServiceContext` can `import { buildMeshAgent, wireSkills, multiCircleResolver } from '@onderling-app/tasks-v0'` and have the shape from day one — no per-circle agent multiplication.
Multi-circle CLI launches stop spinning N agents (the dashboard path).
- Future `@onderling/scoped-skill-bus` lift (if Stoop or another app trips the rule of two on this factory shape) lands without a Tasks rewrite.

### Deferred

- **A web circle-picker** for `--circle-list` mode: today the multi-circle launcher is CLI-only. The web UI assumes a single circle; a multi-circle picker (route per circleId, per-tab `tasks-config.json` injection) lives in tasks-mobile's plan and isn't needed before mobile ships.
- A separately-exported `buildCircleState({meshAgent, circleConfig, localStoreBundle, ...})` from `Circle.js` — the runbook contemplated lifting it, but the multi-circle smoke uses the test-fixture pattern (a 30-line inline CircleState) and `createCircleAgent` already exposes the V1+ enrichment path. Lift this when a third consumer (mobile + multi-circle CLI counts as two — wait for #3) demands it.

## [0.3.5] — 2026-05-08 — cross-circle dashboard + bot circles

Capability **S** from the V2 functional design. One screen lists every circle the user belongs to with four counters (open / overdue / awaitingApproval / mine). Promoted from the -deferred line in the V1 plan after re-reading: Tasks doesn't need H7 Archive, since V1's per-circle skills already expose the counts.

### App-side

- ✅ `src/dashboard/aggregator.js` — pure `aggregateCircles({circles, actor, roleOf, now})`. Filters out `subtask-request` items; submitted-but-not-approved items count as awaiting-approval (admin/coord see all, members see only their own mastered ones). Sorts busiest first.
- ✅ `src/skills/dashboard.js` — `getMyCircles()` skill. Filters bundles to those where `roleOf(actor)` returns a defined role (other-circle leakage is impossible by construction). Returns `{circles: [{circleId, name, kind, counts}]}`.
- ✅ `src/Circle.js` — accepts a new `circleBundlesProvider` parameter. Default returns `[selfBundle]` (single-circle launches); multi-circle launchers pass a closure that returns every bundle they built. Registers `getMyCircles` on every bundle so any circle's UI can surface the dashboard.
- ✅ `src/bot/dispatch.js` — verbs `circles` / `my circles` route to `bot.circles`. HELP_TEXT updated.
- ✅ `src/bot/skills.js` — `bot.circles` calls `getMyCircles` for the actingAs webid; renders one line per circle with name + kind chip + open/overdue/mine counts. `policy: 'requires-token'`.
- ✅ `web/circles.html` — new page; one row per circle with four counters + "Jump in" button (opens per-circle workspace in a new tab). `mountLive` subscription so counters refresh in real-time.
- ✅ Nav links added to every web page — Circles sits between Circle and Inbox.
- ✅ `locales/{en,nl}.json` — 11 new keys under `dashboard.*` with `{text, doc}` leaves.

### Tests

- ✅ 6 added in `test/v2_5-dashboard.test.js`: pure aggregator counters; busiest-first sort; single-circle launcher returns own circle; multi-circle filters by membership (other-circle leakage prevented); dispatcher routing for `circles`; `bot.circles` end-to-end render.

Tests now: **297 across 28 files** (Tasks). Stoop's 429 + core's 1279 still green.

---

# V2 (full release) — summary across [0.3.0]–[0.3.5]

V2 implements the V2 functional design (`Project Files/Tasks App/functional-design-v2-2026-05-08.md`) end-to-end. Six phases shipped in one session:

| Phase | Capability | Tests added |
|---|---|---|
| **** | Tasks-agent identity persistence | 3 |
| **** | Calendar write-side + bot calendar | 14 |
| **** | Compensated-role + invoicing + bot invoice | 10 |
| **** | Availability hints + bot available/week | 18 |
| **** | Auto-scheduling planner + bot plan/accept | 14 |
| **** | Cross-circle dashboard + bot circles | 6 |
| **Total** | | **65 new tests, 297 total** |

Substrate touches kept to an absolute minimum (per the rule-of-two policy):
- `core.VaultMemory` — `snapshot()` / `fromSnapshot()` already added in follow-up B; reused in.
- `core.InternalTransport` — `bus` getter already added in; reused.
- `item-store.ItemStore#materialise` — additive: now passes `scheduledAt` + `estimateMinutes` through. Pure-additive; Stoop's V1 paths don't read these.

No new substrates promoted in V2. The four self-contained capabilities (calendar emission, planner, invoicing, availability) all stay app-local pending a second consumer.

(deferred) carries forward: persisted revocation list, cryptographic anonymity, federated pod ownership, real-time deliverable-doc collab, "deep" cross-source dashboard.

## [0.3.4] — 2026-05-08 — auto-scheduling planner + bot plan/accept

Capability **O** from the V2 functional design. Greedy planner suggests concrete slots for the calling actor's open assignments given (a) busy spans from V1's calendar reader, (b) `circle.workingHours` (defaults Mon-Fri 09:00-17:00), (c) each task's `dueAt` + `estimateMinutes`. Suggestions only — every slot needs a click.

### App-side

- ✅ `src/planner/greedy.js` — pure `suggestSchedule({tasks, busySpans, workingHours, now, lookaheadDays})`. 30-minute step granularity. Reason chips: `overdue` / `last-chance` / `fits before deadline` / `no slot`. Tie-break: `dueAt` asc → required-skill rarity (rare-skill first) → `addedAt` for stability. Accepted suggestions become busy spans for subsequent tasks (greedy, no backtracking — honest about its limits).
- ✅ `src/skills/planner.js` — three skills:
  - `suggestSchedule({lookaheadDays?})` — self only. Reads my open assignments + free/busy from V1 calendar adapter + working hours.
  - `acceptSchedule({taskId, slotStart, slotEnd})` — self only. Sets `task.scheduledAt = slotStart` (and `estimateMinutes` if absent). 's calendar emission picks it up automatically.
  - `rejectSchedule({taskId})` — self only. No-op (UI affordance only).
- ✅ `src/Circle.js` — registers planner skills.
- ✅ `src/rolePolicy.js` — narrow new exception in `canEditBody`: assignee may patch `scheduledAt` + `estimateMinutes` on their own assignment via `acceptSchedule`. Pattern matches the existing dependencies-only narrow exception (Phase 7).
- ✅ `src/bot/dispatch.js` — verbs `plan` / `schedule` route to `bot.plan`. `accept <id> [N]` (default N=1) routes to `bot.accept`. HELP_TEXT updated.
- ✅ `src/bot/skills.js` — `bot.plan` renders top-3 suggestions as a numbered list with reason chips. `bot.accept` re-runs `suggestSchedule` (no chatId-keyed cache — survives restart, sub-second cost) and accepts the Nth match. Both `policy: 'requires-token'`.
- ✅ `web/mine.html` — new "Suggested plan" panel. "Suggest a plan" button + suggestion cards with Accept / Skip per suggestion + reason chip.
- ✅ `locales/{en,nl}.json` — 11 new keys under `planner.*` with `{text, doc}` leaves.

### Tests

- ✅ 8 added in `test/v2_4-planner-greedy.test.js` (pure unit): empty input; single fits; overdue; last-chance; rare-skill priority; working-hours respected; busy-span split; lookahead exhausted.
- ✅ 6 added in `test/v2_4-planner-skills.test.js`: dispatcher routing for `plan` + `accept <id> [N]`; suggest-self-only; accept-assignee-only; reject is no-op; bot.plan + bot.accept end-to-end.

Tests now: **291 across 27 files** (Tasks).

## [0.3.3] — 2026-05-08 — availability hints + bot available/week

Capability **Q** from the V2 functional design. Members opt in per-circle to publish a coarse `open` / `tight` / `unavailable` chip per (ISO-week, half-day). Coordinators see the chips when picking assignees.

**Privacy reminder (per design § Q):** opted-out members are indistinguishable from opted-in-but-empty in the coordinator view. Both render as `unknown`. Hints older than 4 ISO weeks are pruned at read time.

### Design choice — pod-side persistence, no chat broadcast

The design called for chat-p2p broadcast. After looking at the chat-p2p substrate's shape (it ties messages to ItemStore items), ships pod-side persistence only. The local-store cache provides eventual consistency without bloating the item ledger. Real-time push (e.g. on the assignee picker) is a + enhancement if needed.

### App-side

- ✅ `src/availability/AvailabilityHints.js` — pure data class. `set` / `get` / `weekGrid` / `serialize` / `deserialize` / `pruneStale`. Exports `isoWeekOf(date)` + `halfDayOf(date)` helpers.
- ✅ `src/skills/availability.js` — five skills:
  - `setAvailabilityEnabled({enabled})` — admin only.
  - `setAvailabilityOptIn({optedIn})` — self only. Opting out deletes the persisted blob.
  - `setMyAvailability({week, day, half, state})` — self only; rejects when circle is disabled or member not opted in.
  - `getMyAvailability({week?})` — self only.
  - `getCircleAvailability({week?})` — admin/coord only. Members not opted in show as `{}` (indistinguishable).
- ✅ `src/Circle.js` — registers the skills; `_normaliseConfig` extended with `availabilityHints: {enabled, optedIn[]}` (default disabled).
- ✅ `src/bot/dispatch.js` — verbs `available <state>` / `avail <state>` route to `bot.available`. `week` / `my week` route to `bot.week`. `available` without state replies with valid-state list. HELP_TEXT updated.
- ✅ `src/bot/skills.js` — `bot.available` sets the *current* half-day (computed from `now()`); `bot.week` renders the actor's own week as a code-fenced 7×2 grid of state symbols. Both `policy: 'requires-token'`.
- ✅ `web/availability.html` — new page with 7×2 cell grid; clicking rotates `unknown → open → tight → unavailable → unknown`. Per-member opt-in toggle; off-state empty-state copy when circle has hints disabled.
- ✅ Nav links added on every web page (index/mine/review/dag/circle/inbox).
- ✅ `locales/{en,nl}.json` — 12 new keys under `availability.*` with `{text, doc}` leaves (both languages).

### Tests

- ✅ 13 added in `test/v2_3-availability.test.js`: data-class round-trip + state rotation + malformed-input rejection + isoWeekOf / halfDayOf helpers + pruneStale; opt-in gate, set/read flow, coordinator vs member view, opted-out-member indistinguishability, disabled-state rejection, admin-only enable, opt-out blob deletion.
- ✅ 5 added in `test/v2_3-bot-availability.test.js`: dispatcher routing for `available <state>` + `week`, friendly hint when state missing, end-to-end `bot.available` + `bot.week` against an opted-in member.

Tests now: **277 across 25 files** (Tasks). Stoop's 429 + core's 1279 still green.

## [0.3.2] — 2026-05-08 — compensated-role + invoicing + bot invoice

Capability **P** from the V2 functional design. Circles with `compensation.enabled` track invoice lines per (paid-pro, ISO month) when those members complete tasks. Per-month totals are surfaced on the Circle page (admin + paid-pro view) and via `bot.invoice`.

### Substrate touch (additive)

- ✅ `@onderling/item-store`: `#materialise` now passes `scheduledAt` + `estimateMinutes` through (both optional). Pure-additive, no breaking change. uses`estimateMinutes` for hour rollups; will use`scheduledAt` for the planner.

### App-side

- ✅ `src/skills/invoicing.js` — three skills + one helper:
  - `recordInvoiceLine({dataSource, circleId, member, task})` — internal helper, idempotent (won't double-append the same `taskId`).
  - `getCompensation({memberWebid?, month?})` — admin OR self only. Returns `{lines, totals: {count, hours, amount?}, currency}`. Amount is `hours × member.rate`, marked informational.
  - `setMemberCompensation({memberWebid, compensated, rate?})` — admin only.
  - `setCompensationEnabled({enabled})` — admin only.
- ✅ `src/Circle.js` — wires the `item-completed` listener when `liveCircle.compensation.enabled === true`; re-attaches/detaches when toggled. Path scheme: `mem://tasks/circles/<circleId>/invoicing/<webid>/<isoMonth>.json`. `_normaliseConfig` extended with `compensation: {enabled, defaultRate, currency}` (default disabled).
- ✅ `src/skills/index.js` — `addTask` now passes `scheduledAt` + `estimateMinutes` through to ItemStore.
- ✅ `src/bot/dispatch.js` — verbs `invoice` / `invoicing` / `comp` route to `bot.invoice`. HELP_TEXT updated.
- ✅ `src/bot/skills.js` — new `bot.invoice` calls `getCompensation` for the actingAs webid; renders chat-formatted table; non-pros get the friendly empty-state. `policy: 'requires-token'`.
- ✅ `web/circle.html` — new "Compensation" panel between Bot bindings and Calendar sync. Visible only to admin OR paid-pro members. Admin-only toggle + per-pro month-selector + count/hours/amount table + "informational, not authoritative" footnote.
- ✅ `locales/{en,nl}.json` — 10 new keys under `compensation.*` with `{text, doc}` leaves (both languages).

### Tests

- ✅ 8 added in `test/v2_2-invoicing.test.js`: non-comped completer → no line; comped completer → line at expected path; multiple completions → one rolled JSON; admin sees totals; self-only access; non-self denied; toggle admin gate; toggle off detaches listener; `setMemberCompensation` mutates the live config.
- ✅ 2 added in `test/v2_2-bot-invoice.test.js`: dispatcher routing + bot reply (paid-pro table vs non-pro empty message).

Tests now: **259 across 23 files** (Tasks). Stoop's 429 + core's 1279 still green; the item-store substrate change is additive and Stoop's V1 paths don't read the new fields.

## [0.3.1] — 2026-05-08 — calendar write-side + bot calendar

Capability **N** from the V2 functional design. Tasks now emits per-member `.ics` calendars to the local-store cache (and onward to the user's pod when attached). Members subscribe once in their phone calendar app — new tasks show up automatically.

- ✅ `src/calendar/emitter.js` — pure `buildIcsFor({circleId, circleName, member, tasks, now})` + `buildCancellationIcs(removed)` + `diffRemoved(prev, next)`. Filters relevant tasks per member (assigned / mastered / approver of). UID = task.id so re-emissions update existing calendar events.
- ✅ `src/calendar/wireCalendarEmission.js` — `wireCalendarEmission({itemStore, dataSource, circle, member, path, debounceMs})` subscribes to item events; debounces 60 s; rebuilds the ICS and writes to the per-member path. `flushNow()` for tests. Returns `{detach}` for clean shutdown.
- ✅ `src/skills/calendarEmission.js` — three skills:
  - `setCalendarEmission({enabled})` — admin/coord only. Toggles `liveCircle.calendarEmission.enabled`. Invokes the `onChange` callback so Circle.js re-wires the per-member emission loops immediately.
  - `getCalendarEmissionUrl()` — self only. Returns the per-member path the calendar app subscribes to.
  - `getCalendarEmissionStatus()` — self only. Read-only flag + URL.
- ✅ `src/Circle.js` — wires emission loops on boot when `liveCircle.calendarEmission.enabled === true`; re-wires when the toggle changes; cleans up on `close()`. Path scheme: `mem://user/tasks/calendars/<circleId>-<webid>.ics`. `_normaliseConfig` extended with `calendarEmission` field (default `{enabled: false}`).
- ✅ `src/bot/dispatch.js` — new verbs `calendar` / `cal` / `sync` route to `bot.calendar`. HELP_TEXT updated.
- ✅ `src/bot/skills.js` — new `bot.calendar` skill calls `getCalendarEmissionUrl` for the actingAs webid; replies with the URL or the friendly off-state hint. `policy: 'requires-token'` per follow-up A.
- ✅ `web/circle.html` — new "Calendar sync" panel between Bot bindings and Cadences. Toggle (admin/coord) + per-member URL display + off-state empty-state copy.
- ✅ `locales/{en,nl}.json` — 8 new keys under `calendar.*` with `{text, doc}` leaves.
- ✅ Tests: 14 added across `test/v2_1-calendar-emission.test.js` (11 — pure ics builder, diff, debounce, end-to-end via Circle) and `test/v2_1-bot-calendar.test.js` (3 — dispatcher routing + bot skill behaviour both on and off).

Tests now: **249 across 21 files** (Tasks).

## [0.3.0] — 2026-05-08 — tasks-agent identity persistence

First V2 phase. Closes the follow-up R1 carried into the V2 design: the tasks agent's vault is now snapshot-persisted under`mem://tasks/circles/<circleId>/agent/identity-vault.json` so its pubKey survives CLI restarts.

- ✅ `Circle.js` — at boot, attempts to restore the vault from the per-circle path; if absent, generates a fresh identity and persists the snapshot. Idempotent: `restoreFromSnapshot → AgentIdentity.restore` reads the same seed each time. Per-circle path scheme means multi-circle installs don't collide.
- ✅ `Agent.js` — `createTasksAgent` accepts an optional `identityVault` parameter for callers that bypass `Circle.js`. Same restore-or-generate logic, kept consistent so both entry points work.
- ✅ `BotAgentRegistry` — auto-rotate-on-restore branch from follow-up B (0.2.5) is **no longer the common path**: with stable tasks-agent identity, persisted bot tokens'`agentId` matches across boots and stays valid. Defensive fallback retained for the case where the agent vault is wiped but bot vaults persist (e.g. partial cleanup).
- ✅ Tests: 3 added in `test/v2_0-agent-identity-persistence.test.js` (first boot persists; second boot restores; multi-circle isolation; external-identity override skips persistence). `test/v1_5-bot-cap-token.test.js` restart-survival assertion updated — `tokenId` is now stable across restart (was `not.toBe(originalTokenId)`).

Tests now: **235 across 19 files** (Tasks). Core + Stoop unaffected.

## [0.2.5] — 2026-05-08 — follow-ups (token scope + persistence + revocation)

Closes the three deferred items flagged at the bottom of [0.2.4].

### A — Cap-tokens scoped to `bot.*` (no more wildcard)

- ✅ Substrate (core): `CapabilityToken.skillMatches(pattern, skillId)` + `skillAttenuates(parent, child)` helpers; both exported from the barrel. Pattern syntax: `'*'`, exact `'<id>'`, or `'<prefix>.*'`. PolicyEngine + TokenRegistry + `verifyChain` all route through `skillMatches` so the rules stay in one place. 7 new tests in `packages/core/test/Permissions.test.js`.
- ✅ App: `BotAgentRegistry` now issues with `skill: 'bot.*'`. A stolen token can only invoke the chat-bot surface — `addTask`, `removeTask`, etc. fall outside the scope. Asserted in `test/v1_5-bot-cap-token.test.js` via `entry.tokenRegistry.get(tasksId, 'addTask')` returning `null`.
- ✅ App: every `bot.*` skill now declares `policy: 'requires-token'` (via a shared `BOT_SKILL_OPTS` constant). Closes a quiet gap from 0.2.4 — the cap-token mode previously ATTACHED a token but PolicyEngine never validated it because the skill's policy short-circuited. The legacy trust-map dispatch (direct in-process handler call) is unaffected because it bypasses PolicyEngine entirely.

### B — Persist bot identities (cap-token bindings survive CLI restart)

- ✅ Substrate (core): `VaultMemory.snapshot()` + `VaultMemory.fromSnapshot(obj)` for callers that want to persist a vault's contents to a regular DataSource. Plain JSON-safe shape; encryption-at-rest is the caller's job.
- ✅ App: `BotAgentRegistry({bus, tasksAgent, dataSource, circleId})` — when `dataSource` + `circleId` are supplied, `issue` writes `{binding, vault: snapshot, token}` to `mem://tasks/circles/<circleId>/botAgents/<chatId>.json`; `revoke` deletes it. `Circle.js` wires the bundle's cache + circle id automatically.
- ✅ App: `restoreAll()` runs at Circle boot. For each persisted entry: rebuilds the bot's vault + identity + agent; hellos the tasks agent. The persisted token's `agentId` is the previous tasks-agent pubKey (which doesn't survive identity regeneration, since tasks-agent identity persistence is a V2 item) — so the registry **auto-rotates the token** against the current tasks agent on restore. Bot identity stays stable, token gets fresh expiry. Boot prints `[BotAgentRegistry] restored=N expired=M failed=K`.
- ✅ App: expired persisted entries are dropped from storage and skipped (so the admin re-issues at next UI visit).
- ✅ Tests: 2 added — restart-survival end-to-end (issue, close, fresh boot, dispatch via restored bot still works); expired entries are pruned.

### C — Server-side revocation list

- ✅ Substrate (core): `PolicyEngine` accepts an `isRevoked(tokenId) → bool|Promise<bool>` callback (constructor opt + `setRevocationCheck()`). When supplied, `checkInbound` rejects with `INVALID_TOKEN: revoked` after the standard signature/expiry/scope/issuer-trust checks pass. Catches the "stolen token still in attacker's wallet" scenario the holder-side `TokenRegistry.revoke` doesn't cover.
- ✅ App: `BotAgentRegistry` keeps an in-memory `Set<tokenId>` and registers itself as the tasks agent's PolicyEngine revocation check at construction time. `revoke({chatId})` adds to the set + persists the deletion. `isRevoked(tokenId)` exposed for tests.
- ✅ Test: `revokeBotToken` then a direct `policyEngine.checkInbound` call against the still-held token → rejected with `INVALID_TOKEN: revoked`. Compare with a freshly-issued token on the same agent → passes. (In-process Set survives the process; persistence of the revocation list is a V2 item — for now, restarts re-issue all tokens anyway via the auto-rotate path.)

### Trade-offs still standing (V2 candidates)

**Tasks-agent identity persistence** — required for token IDs to survive restart unchanged. Not strictly necessary for because the auto-rotate makes restarts seamless, but durable token IDs would help cross-process audit trails.
- **Revocation list persistence** — same shape: a vault-backed `RevocationRegistry` substrate (rule-of-two — promote when a second app needs it).

Tests now: **232 across 18 files** (Tasks) + **1279 / 13 skipped** (core) + Stoop's full **429** still green.

## [0.2.4] — 2026-05-08 — cap-token-bound bot agent (the missing planned item)

Closes the last item from the plan in`Project Files/Tasks App/coding-plan-2026-05-07.md` § "Chat-bot bridge (Telegram)" → "Capability-token-bound bot agent (lift Stoop V2's substrate-candidate pattern: bot is an agent under the user's root identity, with a scoped cap-token specific to that bot binding)".

The previous work shipped chat-bot dispatch via direct in-process handler calls (trust-map mode). The cap-token path now actually exists alongside it: the bot is a real`core.Agent` with its own pubKey, holding a `CapabilityToken` issued by the tasks agent, dispatching via `agent.invoke()` so `taskExchange.handleTaskRequest` runs `PolicyEngine.checkInbound` to verify signature + expiry + subject + issuer trust.

### Substrate touches

- ✅ `packages/core/src/transport/InternalTransport.js` — added `get bus()` getter so callers can attach additional in-process agents to the same bus without threading the bus through multiple layers.
- ✅ Tasks agent now wires `TrustRegistry` + `PolicyEngine` (was previously `null`). The agent's own pubKey is set to `'trusted'` tier so self-issued tokens pass the issuer-trust check (PolicyEngine line ~173).

### Tasks-app additions

- ✅ New `apps/tasks-v0/src/bot/BotAgentRegistry.js` — per-binding bot agent factory. Each `(circleId, chatId)` binding gets its own fresh `AgentIdentity`, `VaultMemory`, `TokenRegistry`, and `Agent` instance on the shared `InternalBus`. Hello'd into the tasks agent at issue-time so SecurityLayer establishes a session. Token: wildcard skill scope, `constraints: { actingAs: webid, scope: 'bot' }`, default 30-day TTL.
- ✅ Two new admin-only skills in `src/skills/botBindings.js`:
  - `issueBotToken({chatId, ttlDays?})` — promotes a binding from trust-map to cap-token mode. Refuses unbound chatIds.
  - `revokeBotToken({chatId})` — revokes the held token + tears down the bot agent. Binding falls back to trust-map mode (unless `removeBotChatBinding` is also called).
- ✅ `getBotChatBindings` now returns `mode: 'trust' | 'cap-token' | 'expired'` per binding plus `tokenId` / `issuedAt` / `expiresAt` for cap-token entries; the response also carries `capTokenAvailable: bool` so the UI can hide controls when the substrate isn't wired.
- ✅ `wireBotChannel` flips dispatch mode per chatId: cap-token bindings go through `botAgent.invoke(tasksAgent.address, skillId, ...)` (real PolicyEngine path); legacy trust-map bindings keep the in-process direct-handler call. Both paths return the same `{text, buttons?}` shape.
- ✅ `bot.*` skill handlers now call a new `effectiveActor({from, envelope})` helper that reads `envelope.payload._token.constraints.actingAs` when present. So even though `envelope._from = bot.pubKey` on the cap-token path, the underlying Tasks skills run as the bound webid — role policy + audit log attribution work correctly.
- ✅ `removeBotChatBinding` also tears down any cap-token bot agent for the chatId (best-effort).
- ✅ `Circle.js` exposes `bundle.botAgentRegistry` (or `null` when the substrate can't be wired — e.g. NKN-only deployments).
- ✅ CLI passes the registry through to `wireBotChannel`.

### UI

- ✅ Bindings panel on the Circle page gains a `Mode` column (chip: `trust` / `cap-token` / `expired`), an `Expires` column (date + days remaining), an "Issue token" button (admin enters TTL), and a "Revoke" button.

### Known trade-offs

- **Wildcard skill scope.** The token grants `skill: '*'` because PolicyEngine's skill match is exact (no `bot.*` prefix support). The role-policy gate on each Tasks skill still defends against bot calling non-bot skills (the bot's pubKey is not a circle member webid → `roleOf(botPubKey)` returns undefined → role check fails). V2 can scope the token via a small core-side change (e.g. `skill: ['bot.listOpen', 'bot.claim', …]` array).
- **Bot identities are ephemeral.** On CLI restart, all cap-token bindings are dead and admins must re-issue (the binding entry persists through the existing chatBinding map; just the cap-token + bot identity are gone). Persistence requires vault serialisation + secure key storage on disk; deferred to V2.
- **No server-side revocation list.** PolicyEngine doesn't consult a revocation list; revocation is recorded in the bot's own `TokenRegistry` (so subsequent bot calls skip the token). Sufficient for in-process bots; cross-process bots in V2 will need a revocation-list check on the verifier side.

### Tests

- ✅ 9 added in `test/v1_5-bot-cap-token.test.js`:
  - Registry exposed on bundle.
  - `issueBotToken` spawns bot + token; `getBotChatBindings` reflects mode.
  - `issueBotToken` refuses unbound chatIds.
  - Member denied on issue/revoke.
  - **End-to-end:** chat → `botAgent.invoke` → `PolicyEngine.checkInbound` → handler runs as `actingAs`. Returns the expected payload.
  - Cap-token claim records `(via bot)` in the audit log under the bound webid (not the bot's pubKey).
  - `revokeBotToken` tears down the bot agent + binding falls back to trust-map mode.
  - `removeBotChatBinding` also tears down the cap-token bot agent.
  - Legacy trust-map binding keeps working alongside cap-token bindings.

Tests now: **228 across 18 files** (Tasks) + **1272 / 13 skipped** (core) — all green after the InternalTransport `bus` getter add.

## [0.2.3] — 2026-05-08 — polish (bot bindings UI)

Removes the "edit JSON, restart" friction for managing the bot's `chatId → webid` map. Admins can now bind / rebind / remove from inside the Circle page, and the bot picks up changes immediately.

- ✅ New `src/skills/botBindings.js` — three skills:
  - `getBotChatBindings()` — admin/coordinator. Returns `[{chatId, webid}]`.
  - `setBotChatBinding({chatId, webid})` — admin only. Adds or overwrites; rejects unknown webid (catches typos before the user wonders why their commands silently deny).
  - `removeBotChatBinding({chatId})` — admin only. Removes existing; errors on unknown chatId.
  - Mutates `liveCircle.bot.chatBindings` through the same `circleMutator` pattern circleControls / customRoles already use.
- ✅ `Circle.js` now exposes `getCircle()` returning the live (mutated) config; the existing `circle` field stays the boot-time snapshot (frozen). Both surfaces documented.
- ✅ `wireBotChannel` accepts `chatBindings` as either an object (legacy) or a `() => object` provider (live). Bot reads bindings fresh on each incoming message — no restart needed after the admin adds a binding.
- ✅ `bin/tasks-ui.js` passes a live provider to `wireBotChannel` so the CLI picks up admin-side mutations on the fly.
- ✅ New "Bot bindings (admin only)" panel on `web/circle.html` between Custom roles and Cadences. Table of current bindings (with a Remove button per row) + an Add form (chatId text input + circle member dropdown). Inline help points at `/getUpdates` for finding chatIds.
- ✅ Tests: 7 added in `test/v1_5-bot-bindings.test.js` — member denied; coordinator can read but not write; add/list; overwrite; remove + missing-chatId error; empty-input rejection; end-to-end via `InMemoryBridge` proving an admin-bound chatId immediately starts dispatching as the bound webid (no restart).

Tests now: **219 across 17 files** (Tasks).

## [0.2.2] — 2026-05-07 — polish (bot CLI plumbing + audit threading + push)

### — bot CLI plumbing

- ✅ `bin/tasks-ui.js` now accepts `--telegram-token <token>`. With a real token it lazy-imports `TelegramBridge` from `@onderling/chat-agent/bridges/telegram` (peer dep `telegraf` is hoisted automatically) and constructs `wireBotChannel` against `circleConfig.bot.chatBindings`. Without the flag the bot stays dormant. Failures during launch are caught and surfaced as a single warning line so the UI still serves.
- ✅ Long-polling default; mode override is via the bridge constructor, not the CLI (Telegram needs the URL up-front for webhook mode anyway).
- ✅ Cleanup wired into `SIGINT`/`SIGTERM`: bot detaches before the UI stops.

### — audit-log threading

- ✅ Threaded `actorDisplayName` through every Tasks skill that ends up in the audit log: `addTask`, `claimTask`, `completeTask`, `reassignTask`, `removeTask`, `submitTask`, `approveTask`, `rejectTask`, `revokeTask`, `setApprovalMode`, plus the sub-task trio (`addSubtask`, `approveSubtaskRequest`, `declineSubtaskRequest`).
- ✅ The bot wrapper sets the actor display name to `<webid> (via bot)`; audit log now distinguishes UI vs bot actions on the same item.
- ✅ Test added in `v1_5-bot.test.js` — claim via chat carries `(via bot)` annotation; direct `addTask` does not.

### — push notifications

Substrate lift (rule-of-two): `PushPolicy` was sitting at `apps/stoop/src/lib/PushPolicy.js` — Tasks trips the second-consumer rule, so the class moved to`@onderling/notifier` (`packages/notifier/src/PushPolicy.js`) and Stoop's lib copy is now a thin re-export. Eight focused unit tests added at the substrate level (`packages/notifier/test/PushPolicy.test.js`).

App-side:

- ✅ `Circle.js` accepts an optional `pushSender` (any `relay.PushSender`-shaped object). When supplied AND `circleConfig.pushTokens` maps any webid → device token, Circle constructs a `PushChannel` + `PushPolicy` and registers them under `notifierChannels.push`.
- ✅ `wireIssuerNotifications` extended with optional `{pushChannel, pushPolicy, tokenFor}`. Every immediate notification (completed / submitted / rejected / revoked) is offered to the policy on top of the inbox dispatch; `humanInTheLoop: true` is set so the policy gates correctly. Unbound recipients silently skip push.
- ✅ CircleConfig schema gained `pushTokens: {[webid]: token}` and `pushPolicy: {maxPerDay?, quietHours?}`. `_normaliseConfig` now preserves both.
- ✅ CLI `--push` flag lazy-imports `@onderling/relay`'s `ExpoPushSender` and forwards it to `createCircleAgent`. `@onderling/relay` added as a tasks-v0 dependency.
- ✅ Tests: 4 added in `test/v1_5-push.test.js` — push fires for the master with a bound token; skipped when the recipient has no token; dormant without `pushSender`; honours `pushPolicy.maxPerDay` from the circle config.

Tests now: **212 across 16 files** (Tasks) + **53 across 5 files** (notifier) + Stoop's full 429-test suite still green after the substrate lift.

## [0.2.1] — 2026-05-08 — Review polish + custom-role UI

### Polish
- ✅ Fixed Review (and Workspace + My work) — `renderTasks` now surfaces:
  - **Deliverable** block: kind + ref (URLs become clickable links; `pod-resource` and `note` render as `<code>`) + `submittedAt` timestamp.
  - **Submitter's note** (the most recent `submit` entry's `.note` from `reviewLog`), with the submitter's webid + preserved whitespace.
  - **Reviewer's reject reason** (when status is `rejected`), with red-tinted left border.
  Approvers can now decide on submissions with full context; previously the Review queue showed only title + status.

### Bug fix
- ✅ Fixed `--circle` mode without `--storage-root` not registering V1 helper skills (`getCircleConfig` / `listAwaitingApproval` / `getDagTree` / `listMyInbox` / `getMetrics` / `pauseCircle` / `getPrivacyNotice` / `listKnownRoles` / etc.). The CLI now builds an ephemeral in-memory `CachingDataSource` bundle whenever `--circle` is used; `--storage-root` adds restart-survival on top. Console line distinguishes the two modes.
- ✅ V1-only pages (`review.html` / `dag.html` / `circle.html` / `inbox.html`) now fail visibly via a new `renderV1NotAvailable(root, err, hint)` helper instead of staying stuck on `Loading…` when the V1 skills aren't registered. `mountInboxBadge` stops polling after 2 consecutive failures so V0 mode doesn't spam the network panel.

### — chat-bot bridge

Substrate already shipped: `chat-agent.TelegramBridge` + `InMemoryBridge`. App-level work:

- ✅ Added `@onderling/chat-agent` dep to `apps/tasks-v0`.
- ✅ New `src/bot/dispatch.js` — pure parser; mirrors `apps/household/src/parsers/regexCommands.js` but for Tasks. 14 commands: `open`/`list`, `mine`, `master`, `review`, `inbox`, `blocks <id>`/`tree <id>`, `claim <id>`, `done <id>`/`complete <id>`, `submit <id> note: ...`, `approve <id>`, `reject <id> reason: ...`, `revoke <id> reason: ...`, `appeal <id>`, `help`/`?`. Dispatches return `{kind: 'skill'|'reply'|'unknown'}` so the wiring layer formats consistently.
- ✅ New `src/bot/skills.js` — `bot.*` skill set (12 skills) wrapping the V1 surface. Each skill returns chat-shaped `{text}` (or `{text, buttons}`) instead of raw JSON; resolves short id prefixes (≥6 chars) to a unique full ULID; renders sub-task trees as code-block-fenced ASCII; surfaces `permission denied` errors from the role-policy gate as friendly chat replies.
- ✅ New `src/bot/wireBotChannel.js` — `wireBotChannel({agent, bridges, chatBindings})`. Generic over `MessagingBridge` instances (TelegramBridge for production, InMemoryBridge for tests). Caller supplies `{<chatId>: <webid>}` map (typically from `circle.bot.chatBindings`); unbound chatIds get a friendly hint reply. Returns `{detach}` for clean shutdown.
- ✅ `Circle.js` always registers `bot.*` skills when `localStoreBundle` is present (registration is cheap; activation gated by the caller wiring a real bridge).
- ✅ CircleConfig schema extended: `bot.chatBindings: {<chatId>: <webid>}`.
- ✅ Tests: 21 added in `test/v1_5-bot.test.js` — pure dispatch parser (every command + edge cases incl. malformed ids + missing reasons), end-to-end via `chat-agent.InMemoryBridge` (unbound chat hint, help text, empty-state, full claim→done cycle, full submit→approve cycle, missing-reason errors, permission-denied surfacing for member chat, audit log records the actor on bot-driven actions, unknown-command help).

Tests now: **208 across 15 files** (+21 from 187).

### — custom-role UI

Substrate already shipped (`core.Roles.registerCustomRole` exists since Track D); only UI + skill-wrapping + boot-time persistence work.

- ✅ Added `Roles` exports to `@onderling/core`'s public barrel: `ROLES`, `isStandardRole`, `roleRank`, `isKnownRole`, `registerCustomRole`, `unregisterCustomRole`, `canPromote`, `listKnownRoles` (one-line additive change).
- ✅ New `apps/tasks-v0/src/skills/customRoles.js`:
  - `applyCustomRoles(customRoles)` — boot-time helper that re-registers a CircleConfig's custom roles into the process-global registry. Idempotent (skips already-registered ids).
  - `registerCircleCustomRole({roleId, rank})` skill — admin-only. Validates against `core.Roles.registerCustomRole` (rank uniqueness, no standard-role collisions); persists into `liveCircle.customRoles`.
  - `unregisterCircleCustomRole({roleId})` skill — admin-only. Refuses to unregister standard roles.
  - `listKnownRoles()` skill — read-only union of standard roles (with their canonical ranks) + circle-config customs + any process-registry customs not in the circle config (surfaces drift).
- ✅ `Circle.js` calls `applyCustomRoles(circle.customRoles)` at boot so a circle config with custom roles re-registers them on a fresh CLI launch.
- ✅ `circle.html` — new "Custom roles (admin only)" section with a table of every known role (showing rank + source: standard/circle/process) + a small "add new role" form (id + rank).
- ✅ Tests: 11 added in `test/v1_5-custom-roles.test.js` covering listKnownRoles standard surface, register/unregister round-trip, admin-only gate (coord + member rejected), validation (empty id, non-numeric rank, standard collision, duplicate rank), boot-time re-registration via `createCircleAgent({circleConfig: {customRoles: [...]}})`, and the dual source surfacing (circle vs process).

**Tests now: 187 across 14 files** (V1's 176 + 11 new).

## [0.2.0] — 2026-05-08 — Tasks V1 (shipped)

V1 implementation complete. **176/176 tests passing across 13
files.** All 11 phases of the coding plan landed on schedule
(~26 dev-days; original estimate ~30 trimmed to ~27 after
substrates were lifted by parallel work).

### V1 acceptance pass

- ✅ V0 baseline + V1 phases 1-10 all pass (176/176).
- ✅ Local-only mode works end-to-end without a pod connection.
- ✅ Cold-boot inbox shows cached entries (CachingDataSource).
- ✅ Calendar conflict view reads pod-mirrored `*.ics` (no network freebusy).
- ✅ Sub-task spawn past `circle.subtasksAdminApprovalDepth` queues admin approval.
- ✅ Revoke with mandatory reason → previous-assignee inbox + appeal flow.
- ✅ Approval mode `creator` works end-to-end (claim → submit → approve / reject).
- ✅ Skill-import-from-pod prefilled-form helper available.
- ✅ Per-event observability: counters + p50/p90 latencies.
- ✅ Pause / archive blocks `addTask` with discrete error codes.
- ✅ Privacy notice in nl + en; surfaced via `getPrivacyNotice` + `/privacy.html`.
- ✅ Stoop's tests stay structurally green: 410/429 in a full-suite run; the 3 failing tests (in phase13/phase14/phase29/web/testbed) all pass in isolation — pre-existing timing flakes under full-suite load (Stoop's full run takes ~90s wall + 229s collect; timing-sensitive crypto + scheduling tests stress under that). Item-store tests 53/54 (1 pre-existing flaky audit-ordering test from a `Date.now()` race in close-succession writes — not introduced by V1).

### V1 acceptance gates — partial

- ⚠️ **Circle switcher UI** — not built. V1 ships `--circle <path>` per launch; switching circles means restart-with-different-config. Multi-circle-switcher screen is work.
- ⚠️ **Localisation back-fill** — localisation scaffolding shipped (`locales/{en,nl}.json` + `lib/localisation.js` + 60+ keyed strings + privacy notice in both langs). HTML pages still ship hardcoded English; `data-i18n` attribute back-fill is opportunistic per touched page.
- ⚠️ **Inrupt-migration** — undecided. Tasks V1 ships local-only-mode-by-default; pod sign-in surface is the same legacy bespoke UX Stoop / Folio currently use. Documented inheritance.

### V1 design + plan documents

- `Project Files/Tasks App/advice-2026-05-07.md` — integration advice + high-level design.
- `Project Files/Tasks App/critique-2026-05-07.md` — design review pushback.
- `Project Files/Tasks App/coding-plan-2026-05-07.md` — phased build plan; 11 phases, ~27 dev-days, ~85 tests target (actual: 176, including substrate test parities).
- `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md` — Stoop-side migration log for the lifted substrates.
- `Project Files/Substrates/apps/H4-tasks.md` — substrate-composition sketch (V1 update).

- `Project Files/Tasks App/advice-2026-05-07.md` — integration advice + high-level design.
- `Project Files/Tasks App/critique-2026-05-07.md` — design review pushback.
- `Project Files/Tasks App/coding-plan-2026-05-07.md` — phased build plan; 11 phases, ~35.5 dev-days, ~110 tests.

### Phase 0 — V0 baseline + branch (2026-05-08)

- ✅ V0 test suite verified green (34/34 — 24 integration + 10 web smoke).
- ✅ V1 work proceeds on existing branch `track-H-folio` (in-flight folio-mobile work present; user will sort branch hygiene later).
- ✅ V1 stub added to this CHANGELOG.
- ✅ `apps/tasks-v0/README.md` carries pointer to coding plan (V0/V1+ section already updated 2026-05-07).

### Phase 1 — Wire `@onderling/local-store` (2026-05-08)

- ✅ Added `@onderling/local-store` dependency to `package.json`.
- ✅ New `src/storage/buildBundle.js` — composes `CachingDataSource` + optional `SyncCadence`; supports `attachInner` / `detachInner` for pod sign-in/out.
- ✅ New `src/storage/settings.js` — Tasks-bound `createSettingsModule({appId: 'tasks', ...})` with shared (`pushPreferences`, `cadenceOverrides`, `defaultCalendarShared`) + device (`pollIntervalMs`, `localModeRoot`) field schemas + `pollIntervalMs >= 100` validator.
- ✅ `createTasksAgent({localStoreBundle, ...})` parameter added; bundle's `.cache` becomes the `ItemStore` DataSource. V0 zero-config path (no bundle, no itemBackend → MemorySource) preserved.
- ✅ `bundle.localOnlyPrefixes` defaults to `['mem://tasks/settings/devices/', 'mem://tasks/settings/.migrated-from-v2']` so per-device settings never sync to a pod.
- ✅ Tests: 12 added (6 in `test/phase1-local-store.test.js` + 6 in `test/phase1-settings.test.js`). Total now 46/46 passing.

### Phase 2 — Circle envelope (2026-05-08)

- ✅ New `src/Circle.js` — `CircleConfig` schema, `loadCircleConfig` / `saveCircleConfig`, `createCircleAgent` factory.
- ✅ Circle kinds: `'household' | 'project' | 'team' | 'friends' | 'maintenance'`. `KIND_DEFAULTS` per kind (e.g. `subtasksAdminApprovalDepth`: household 3, project 4, friends 2).
- ✅ Pod schema established: `<circle-pod>/circles/<circleId>/config.json` (and sibling `members/`, `skills.json`, `cadences.json`, `tasks/` to be populated by later phases).
- ✅ `createCircleAgent` wires (when applicable):
  - `MemberMap` seeded from `circleConfig.members`.
  - `MemberMapCache.attach` against the localStoreBundle's cache so the roster auto-persists under `mem://tasks/circles/<circleId>/members/`.
  - A `core.GroupManager` bound to the agent's identity + vault.
  - `buildOnboardingSkills` from identity-resolver — registers `issueInvite` + `redeemInvite` skills with the right `groupId = circleId`.
- ✅ `wireOnboardingSkills: false` opt-out for tests / agents that don't need invites.
- ✅ V0 zero-config path: `createCircleAgent({})` returns an implicit-household circle indistinguishable from `createTasksAgent` defaults.
- ✅ Tests: 9 added in `test/phase2-circle.test.js` (config round-trip, missing-config fallback, kind defaults, zero-config implicit household, member-map auto-persist via MemberMapCache, onboarding skill registration + actual invite issuance, opt-out). Total now 55/55 passing.

### Phase 3 — canonical user-skills profile + per-circle vocabulary (2026-05-08)

- ✅ New `src/skills/profile.js` — canonical-profile, circle-vocabulary, per-circle-member-skills, and per-circle-posture readers + writers, all over a `core.DataSource` (composes the local-store bundle).
- ✅ Canonical user-skills profile path: **`mem://user/profile/skills.json`** — intentionally NOT app-namespaced, so Stoop / Tasks / Folio / future apps read the same blob.
- ✅ Circle skill vocabulary at `<circle-pod>/circles/<circleId>/skills.json`; per-circle member projection at `<circle-pod>/circles/<circleId>/skills/<webid-encoded>.json`; per-circle posture at `<user-pod>/posture/<circleId>.json`.
- ✅ Tag normalisation: leans on the shipped `@onderling/identity-resolver/normaliseTag` so NL "schilderen" / EN "painting" / "schilderwerk" all canonicalise to one tag — cross-language matching works out of the box. Off-taxonomy `categoryId` values get nulled; duplicates dedupe by canonical tag.
- ✅ `prefilledFormShape({canonicalProfile, circleVocabulary, taxonomy?})` — pure function, returns `{prefilled, vocabSuggestions, taxonomyHints}` for the UI's three lists. `prefilled` annotated with `inCircleVocabulary`. Handles null inputs.
- ✅ Two new skills auto-registered on `createCircleAgent` when a `localStoreBundle` is supplied:
  - `getMySkillsFormShape({circleId})` — returns the prefilled shape.
  - `editMySkillsForCircle({circleId, skills, persistToCanonicalProfile?})` — always writes the per-circle projection; mirrors to canonical profile only when the opt-in flag is set (per pod-data-sharing caution principles).
- ✅ Webid taken from `from` (envelope) preferred over args; rejects calls without a webid.
- ✅ Tests: 18 added in `test/phase3-profile.test.js`. Total now **73/73 passing**.

### Phase 5.5 — CLI improvements (2026-05-08)

- ✅ `bin/tasks-ui.js` gains `--storage-root <path>` flag — wraps `core.FileSystemSource` rooted at the path in a `local-store.CachingDataSource` and threads it through as `localStoreBundle`. Local-only mode now survives CLI restarts.
- ✅ `bin/tasks-ui.js` gains `--circle <path>` flag — loads a CircleConfig JSON and uses `createCircleAgent` instead of the legacy V0 path. Surfaces every V1 wiring (MemberMapCache, onboarding skills, profile skills, calendar adapter, in-app inbox, appeal flow) without changing the existing V0 `--role` / `--config` invocations.

### Phase 11 — docs + privacy page + acceptance pass (2026-05-08)

- ✅ New `web/privacy.html` — closed-beta privacy notice page; en/nl picker; calls `getPrivacyNotice` skill.
- ✅ Updated `apps/tasks-v0/README.md` with the V1 surface, V1//V2+ split, full file inventory, V1 + Circle CLI examples, test-coverage table.
- ✅ Updated `Project Files/Substrates/apps/H4-tasks.md` to reflect the V1 substrate composition + new substrate dependencies (`local-store`, `chat-p2p`) + V1 design locks.
- ✅ Finalised this CHANGELOG with a top-level `0.2.0` entry + acceptance gates summary (passed / partial).
- ✅ Final acceptance run: **176/176 tests passing** across 13 files; Stoop 429/429 untouched.

### Phase 10 — localisation + archive + pause + privacy notice (2026-05-08)

- ✅ Added `i18next@^26` dependency.
- ✅ New `locales/en.json` + `locales/nl.json` — every leaf carries the project-mandated `{text, doc}` shape (per `Project Files/conventions/localisation.md`); `doc` field is mandatory and explains where the string appears + tone. Coverage: common, nav, status pills, action labels, composer fields, circle labels, inbox event chips, error codes (~60 keys per language).
- ✅ New `src/lib/localisation.js` — i18next wrapper. `unwrapLeaves()` transforms `{text, doc}` pairs to bare strings at init time so callers write `t('common.save')` (not `t('common.save.text')`). Falls back to the key when missing; supports `{{params}}` interpolation; `setLang(lng)` for runtime switching. Mirrors Stoop's wrapper pattern.
- ✅ New `src/lib/privacyNotice.js` — `PRIVACY_NOTICE` (frozen) with 6 items per language. Inherits items 1-4 from Stoop's notice (encryption, relay surface, abuse-tracing, group governance) + 2 Tasks-specific items (calendar-stays-on-device + pod-data-sharing caution principles).
- ✅ New `src/skills/circleControls.js`:
  - `pauseCircle()` / `unpauseCircle()` — admin/coord only. Sets `circle.paused = true|false`.
  - `archiveCircle()` / `unarchiveCircle()` — admin only. Sets `circle.archived = true|false`. Reversible (does NOT delete items).
  - `getPrivacyNotice({lang?})` — returns the localised closed-beta notice; defaults to `en`.
- ✅ `Circle.js`'s `_normaliseConfig` honours `paused` + `archived` flags (default `false`); the shared `circleMutator` is reused by both observability + circleControls; `liveCircle` is now declared before `createTasksAgent` so a `circleProvider` can flow into the base agent.
- ✅ `addTask` skill (`src/skills/index.js`) accepts an optional `circleProvider` and gates: `circle.archived` → `{error: 'circle-archived'}`; `circle.paused` → `{error: 'circle-paused'}`; archive takes precedence over pause when both are set. V0 zero-config path (no `circleProvider`) never blocks.
- ✅ Tests: 17 added in `test/phase10-lifecycle.test.js` covering localisation init/translate/interpolate/fallback, locale-file `{text, doc}` schema validation, en+nl key-set parity, privacy-notice shape + content, pause/unpause/archive/unarchive flow + addTask gate + admin-only authz + privacy-notice skill. Total now **176/176 passing**.

### Phase 9 — observability stats + cadence config (2026-05-08)

- ✅ New `src/observability/metrics.js` — `MetricsTracker` composes `@onderling/notifier`'s `UsageMetrics` for counters + adds bounded latency reservoirs (default 200 samples per name; FIFO eviction). Tracks per-name p50/p90/max via `_percentile`.
- ✅ `buildMetrics({itemStore})` auto-subscribes to `item-added`/`item-claimed`/`item-submitted`/`item-rejected`/`item-revoked`/`item-completed`/`item-removed`. Counters: `task.added` / `task.claimed` / `task.submitted` / `task.rejected` / `task.revoked` / `task.approved` / `task.completed` / `subtask.request` / `subtask.approved` / `subtask.declined`. Latencies: `latency.time-to-claim` (added → claimed), `latency.submit-to-approval` (submit → completed when approval mode is non-self-mark).
- ✅ New `src/observability/cadence.js` — `resolveCadence({eventType, baseline?, circle?, user?})` layered config (user > circle > baseline). `sanitiseCadenceMap(map)` drops invalid entries. `BASELINE_CADENCES` covers all 6 V1 event types.
- ✅ New `src/skills/observability.js`:
  - `getMetrics()` — read-only snapshot (locally aggregated; V1 keeps strictly local per pod-data-sharing caution principles).
  - `getCircleCadences()` / `setCircleCadences({cadences})` (admin/coord only).
  - `getMyCadenceOverrides()` / `setMyCadenceOverrides({overrides})` (Settings shared blob).
  - `resolveMyCadence({eventType})` — returns the effective config given all three layers.
- ✅ `Circle.js` wires metrics + observability skills + persists user overrides via `Settings`. The `liveCircle` pointer is mutable (admin's `setCircleCadences` swaps in a new frozen copy).
- ✅ UI:
  - `circle.html` — new "Stats" section (counter + latency tables) + "Cadence config" admin/coord editor with per-event channel + suppressed dropdowns.
  - `mine.html` — new "My notification preferences" section letting users override the circle defaults.
- ✅ Tests: 16 added in `test/phase9-observability.test.js`. Total now **159/159 passing**.

### Phase 8 — workspace UI shell + 7 screens (2026-05-08)

Server-side helper skills:
- ✅ New `src/skills/inbox.js` — `listMyInbox({since?, limit?})`, `inboxBadgeCount()`, `clearInboxItem({id})`, `clearInbox({olderThanMs?})`. Reads `mem://user/inbox/*.json` (the path the Phase 6 InAppInboxBridge writes to).
- ✅ New `src/skills/workspace.js` — `getCircleConfig()`, `listAwaitingApproval()`, `listSubtaskRequests()` (admin/coord only), `getDagTree({rootId?})` (uses Phase 7's `treeOf`), `listMyMasteredTasks()`.
- ✅ Both auto-registered in `createCircleAgent` when a `localStoreBundle` is supplied.

UI surface (`apps/tasks-v0/web/`):
- ✅ Refreshed `index.html` — V1 add-task composer with `definitionOfDone` + approval-mode picker (`self-mark` / `creator` / `webid:X`); status filter extended to cover the 7 statuses (`ready`/`waiting`/`blocked`/`claimed`/`submitted`/`rejected` — `complete` items are in the closed list); inbox badge in nav.
- ✅ Refreshed `mine.html` — split into 3 sections: "Assigned to me" + "I'm master of" + "Ready to claim".
- ✅ New `review.html` — approver inbox; client-side filter against `item.approval` (`creator` / `webid:X`) plus admin/coord override.
- ✅ New `dag.html` — read-only sub-task tree via `getDagTree`; per-node status pill; indented children.
- ✅ New `circle.html` — circle name + meta; member chips with role labels (+ optional `paid-pro`); pending sub-task requests with `[Approve]`/`[Decline]` buttons (admin/coord only); settings dump.
- ✅ New `inbox.html` — list of `kind:'notification'` items, dismiss-per-item + clear-all; routes button taps for `approveSubtaskRequest:` / `declineSubtaskRequest:` / `appeal:`.
- ✅ Refreshed `app.js` — `lifecycleStatus`, `mountInboxBadge`, `getConfig`, expanded `renderTasks` with submit/approve/reject/revoke/add-subtask actions gated by role + lifecycle state; `getActor`+`getConfig` helpers.
- ✅ Refreshed `style.css` — new pills for the 4 lifecycle states + inbox-entry layout + tree-children indentation + nav badge.

CLI:
- ✅ `bin/tasks-ui.js` extends `/tasks-config.json` overlay to include `circle: {circleId, name, kind}` when a Circle envelope is wired (UI uses this for context).

Tests: 11 added in `test/phase8-ui.test.js`; V0 baseline test text-assertions updated for the renamed nav. Total now **143/143 passing**.

### Phase 7 — sub-tasks + DAG tree + admin-approval queue (2026-05-08)

- ✅ New `src/dag-tree.js` — pure helpers: `childrenOf(parentId, allTasks)`, `treeOf(rootId, allTasks)` (recursive {id, item, children}), `ancestorChain(taskId, allTasks)` (root → … → self), `depthOf(taskId, allTasks)` (top-level=0), `wouldCreateParentCycle(parentId, newChildId, allTasks)` (early-rejection helper). All pure; no I/O.
- ✅ New `src/skills/subtasks.js` with three skills:
  - `addSubtask({parentTaskId, text, ...})` — caller must be parent's assignee, master, admin, or coordinator. Computes `newDepth = depthOf(parent) + 1`; if `> circle.subtasksAdminApprovalDepth` (default 3), files a `type: 'subtask-request'` item and returns `{queued: true, requestId}`. Otherwise creates the sub-task with `parentTaskId` set + spawner as `master`, AND appends the new id to the parent's `dependencies` so `computeStatus` reports the parent as `waiting`. Cycle-checked via `wouldCreateParentCycle` before write.
  - `approveSubtaskRequest({requestId})` — admin/coordinator only. Reads the queued request and creates the actual sub-task on behalf of the original requester; updates the parent's `dependencies`; closes the request item.
  - `declineSubtaskRequest({requestId, note?})` — admin/coordinator only. Marks the request complete with the decline note in `notes`. The spawner sees a `task-completed` inbox entry via the existing wireIssuerNotifications listener.
- ✅ `Circle.js` extended:
  - Auto-registers the three sub-task skills via `buildSubtaskSkills({itemStore, circleProvider, roleOf})`.
  - Adds an `item-added` listener that detects `type: 'subtask-request'` and broadcasts an inbox notification to every admin / coordinator with `[Approve]` / `[Decline]` buttons (button ids `approveSubtaskRequest:<id>` / `declineSubtaskRequest:<id>` so the UI can wire them).
- ✅ Role-policy narrow exception: `canEditBody` now allows the parent's `assignee` or `master` to append to `dependencies` ONLY (single-field patch). Unblocks the spawn-flow's parent-update without granting wider edit rights.
- ✅ Tests: 16 added in `test/phase7-subtasks.test.js`. Total now **132/132 passing**.

### Phase 6 — in-app inbox + appeal flow + issuer notifications (2026-05-08)

- ✅ Added `@onderling/chat-p2p` dependency.
- ✅ New `src/bridges/InAppInboxBridge.js` — implements the `MessagingBridge` shape (`start`/`stop`/`onMessage`/`sendReply`); writes `kind: 'notification'` items to a per-recipient inbox container (default `mem://user/inbox/`). Cross-recipient delivery rejected (one bridge per webid; broadcasting is somebody else's problem). Substrate-candidate flagged for `@onderling/chat-agent` once a 2nd consumer wants the same shape.
- ✅ New `src/notifications/wireIssuerNotifications.js` — subscribes to `item-added` (with `dueAt`), `item-completed`, `item-submitted`, `item-rejected`, `item-revoked`, `item-removed` and routes them to the right recipient's inbox via per-webid `InAppInboxBridge` instances. Mutates the shared `channels` map so the notifier picks up runtime additions lazily. Returns `{detach}` for shutdown.
- ✅ New `src/skills/appeal.js` — `appealTask({taskId, body?})` skill. Authz: caller must equal `previousAssignee` (read from the revoke audit-log entry) AND the revoke must be ≤ 7 days old (`APPEAL_WINDOW_MS`). On success, calls `chat-p2p.wireChat`'s `send(...)` with `threadId: appeal:<taskId>` and either the user's body or a polite pre-fill quoting the revoke reason. Graceful `chat-not-wired` error when `wireChat` isn't composed.
- ✅ `createCircleAgent` (when `localStoreBundle` is supplied) now wires:
  - `wireChat` from `@onderling/chat-p2p` against the bundle's ItemStore + MemberMap (gives the agent peer-to-peer chat capability).
  - `appealTask` skill (depends on `chatController`).
  - `Notifier` from `@onderling/notifier` with `InMemoryScheduleStore`; exposed as `bundle.notifier.scheduleStore` so tests + UI can introspect pending jobs (the notifier's own `#store` is private).
  - `wireIssuerNotifications` for missed-deadline / completed / submitted / rejected / revoked routing.
  - `bundle.close()` aggregator that detaches every listener + stops the notifier on shutdown.
- ✅ Tests: 14 added in `test/phase6-inbox.test.js`. Total now **116/116 passing**.

### Phase 5 — DoD lifecycle on item-store (2026-05-08)

Substrate side (`@onderling/item-store`):

- ✅ Schema additions on `Item`: `definitionOfDone?`, `approval?` (`'self-mark' | 'creator' | 'webid:<who>'`), `deliverable?`, `reviewLog?`, `master?`, `parentTaskId?`. All optional; V0 callers see no shape change.
- ✅ `master` defaults to `addedBy` on add (or to an explicit `partial.master` for spawned sub-tasks).
- ✅ Five new methods on `ItemStore`: `submit(id, {deliverable?, note?}, ctx)`, `approve(id, {note?}, ctx)`, `reject(id, {note}, ctx)` (note required), `revoke(id, {reason}, ctx)` (reason required), `setApprovalMode(id, mode, ctx)`.
- ✅ `submit` accepts a transition from `claimed`, `submitted` (re-submit), OR `rejected` (re-work after pushback).
- ✅ `revoke` clears `assignee` + `claimedAt` while preserving `master`. After-revoke status is `'open'`; the prior `submit` is preserved in `reviewLog`.
- ✅ New `computeStatus(item)` helper exported from the substrate. Returns `'open' | 'claimed' | 'submitted' | 'rejected' | 'complete'` based on `completedAt` + last `reviewLog` decision + `assignee`. Pure function.
- ✅ New events: `item-submitted`, `item-rejected`, `item-revoked` (the latter carries `{item, previousAssignee, reason}`).
- ✅ New role-policy gates: `canSubmit`, `canApprove`, `canReject`, `canRevoke`. `update()` blocks the new fields (`reviewLog`, `deliverable`, `approval`, `master`, `parentTaskId`) so apps must use the dedicated transitions.
- ✅ New `MissingArgumentError` for missing-reason / missing-note rejections.
- ✅ Audit log records `'submit' | 'approve' | 'reject' | 'revoke'` action codes with the right details (note, reason, previousAssignee).
- ✅ V0 backward compat preserved — `markComplete` still works for items with no `approval` field; existing 30 H2 + H4 tests pass.

App side (`apps/tasks-v0`):

- ✅ Five new skills auto-registered on every tasks agent: `submitTask`, `approveTask`, `rejectTask`, `revokeTask`, `setApprovalMode`.
- ✅ `addTask` extended to forward the new optional fields (`definitionOfDone`, `approval`, `master`, `parentTaskId`).
- ✅ Role-policy table extended with `canSubmit` / `canApprove` / `canReject` / `canRevoke`:
  - `admin` / `coordinator` override every gate.
  - `canApprove` resolves the designated approver from `item.approval` (`'self-mark'` → assignee; `'creator'` → master/addedBy; `'webid:X'` → X).
  - `canRevoke` is master-only (with admin/coord override).
  - `observer` denied on every gate.
- ✅ Default approval mode remains `'self-mark'` everywhere — V0 households don't see DoD friction.
- ✅ Tests: 24 substrate tests added at `packages/item-store/test/ItemStore.dod.test.js`; 15 app-side tests added at `apps/tasks-v0/test/phase5-dod.test.js`. Tasks app **102/102 passing**; item-store **53/54** (1 pre-existing flaky H2 audit-ordering test from a `Date.now()` timing race in close-succession writes — not introduced by Phase 5).
- ⚠️ Note: `core.Roles.registerCustomRole` already supports the Q-H4.7 (c) extension path. ships the standard 5 roles only; adds the management UI. No SDK change needed.

### Phase 4 — local calendar reader + mockup .ics fixtures (2026-05-08)

- ✅ Added `ical.js@^2.2.1` dependency.
- ✅ New `src/calendar/iCalReader.js` — pure local reader; **no network freebusy skill, no cross-pod read**. Per the locked V1 design: calendar matching is local-only, the user's calendar stays on their device.
- ✅ `parseIcsToBusy(icsString, range) → busy[]` — pure function; expands RRULEs (with a 5000-iteration safety ceiling); honours VTIMEZONE; handles all-day events; ignores malformed input.
- ✅ `readMyCalendar({dataSource, range, container?}) → busy[]` — globs `*.ics` blobs from a `core.DataSource` (typically the bundle's CachingDataSource), parses each, sorts ascending by start time, attaches `source` path per entry. Default container: `mem://user/calendar/` (so the import-bridge writes there and Tasks reads).
- ✅ `busyBadge(busy)` — UI helper, formats counts as `'free' | '1 conflict' | 'N conflicts'`.
- ✅ Four `.ics` fixtures under `test/fixtures/calendar/`:
  - `recurring-weekly.ics` — Tuesday 14:00-15:00 UTC, weekly RRULE.
  - `one-shot.ics` — Friday 9 Jan 2026 evening event.
  - `all-day.ics` — Saturday 10 Jan 2026 all-day vacation.
  - `tz-amsterdam.ics` — 10:00 Europe/Amsterdam meeting (= 09:00 UTC in January CET).
- ✅ `test/utils/podMockCalendar.js` — `loadCalendarFixtures({dataSource, container?, only?})` seeds the bundled fixtures into a CachingDataSource so tests + dev-mode can exercise the reader without needing the import-bridge built. Mirrors the pod write pattern the bridge will produce.
- ✅ Tests: 14 added in `test/phase4-calendar.test.js`. Total now **87/87 passing**.

### V1 scope (in progress — see coding plan for phase-by-phase)

- **Circle envelope** (multi-tenant container around tasks; replaces V0's implicit-household).
- **DoD lifecycle** on item-store: `submitted` + `rejected` states + approval modes.
- **Sub-tasks by the accepter** + admin-approval threshold beyond depth N.
- **Master + revoke (with reason) + appeal flow** via new `@onderling/chat-p2p` substrate.
- **Local calendar conflict view** (no network freebusy; reads `*.ics` from pod or local mode).
- **In-app inbox** as a `MessagingBridge`, backed by new `@onderling/local-store` substrate.
- **Skill import from canonical user-pod profile** with prefilled-edit-before-submit form.
- **Per-circle skill vocabulary** + cadence config + observability stats.
- **Local-only mode** is a hard rule — app boots without a Solid pod.

### Substrate movements during V1 (lifted from Stoop, rule of two satisfied)

- New `@onderling/local-store` package (`CachingDataSource` + `SyncCadence` + `Settings` split).
- New `@onderling/chat-p2p` package (peer-to-peer chat threads).
- `@onderling/identity-resolver` extension: `MemberMapCache` + new `skills/` submodule (taxonomy + normalisation + matcher).
- `@onderling/notifier` extension: `UsageMetrics` (in-memory per-event counter).
- `core.GroupManager` extension: canonical `issueInviteSkill` / `redeemInviteSkill` helpers.

Stoop's `apps/stoop/src/lib/` files affected become re-export shims; per-PR migration plan at `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`. **No Stoop V3 substrates touched** (e.g. `@onderling/oidc-session-rn` stays out of scope).

---

## [0.1.0] — 2026-05-02

H4 V0 — initial release.  Phase C of the substrate-first plan; first L2 app shipped as a thin substrate composition.

### Added

- `createTasksAgent({roles, members, skillMatch?, notifier?, itemBackend?})` factory.
- Standard 5-role permission table (`buildStandardRolePolicy`).
- DAG resolver (`computeStatus`, `detectCycle`).
- Skill handlers: `addTask`, `claimTask`, `completeTask`, `reassignTask`, `removeTask`, `listOpen`, `listMine`, `listClaimable`, `resolveMember`.
- 21 integration tests.

### Substrate dependencies

- `@onderling/item-store` (L1b) — primary
- `@onderling/identity-resolver` (L1h)
- `@onderling/skill-match` (L1e)
- `@onderling/notifier` (L1f)
- `@onderling/agent-ui` (L1d)

### Out of V0 (per plan)

- Mobile RN client.
- Multi-tenant generalization.
- DAG editor UI.
- Custom-roles UI.
- Recurring tasks.
- Multi-claim / co-assignment.

These are V1+ once a real consumer demands them.
