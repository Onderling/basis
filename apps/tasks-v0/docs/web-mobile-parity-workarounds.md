# tasks-v0 — web↔mobile parity workarounds (audit)

> ** prep** per`PLAN-gui-chat-uplift.md`.  Owner-flagged:
> *"Probably, the code already contains many fixes to make it work on
> both mobile and web: maybe check for comments on that too (or
> readmes)."*  This audit surfaces every parity workaround so the
> `renderWeb` design knows what to absorb vs what stays adapter-only.
>
> **Headline:** the codebase has already DRY'd up parity logic
> comprehensively via the M0–M4 substrate work.  No significant
> unresolved issues block `renderWeb` adoption of the helpers.

---

## Context

Tasks V1 ships both a web shell (`apps/tasks-v0/web/*.html`) and a
mobile shell (`apps/tasks-mobile/`) that share a common agent-layer
backend (`apps/tasks-v0/src/*`).  Architecture follows the
**platform-parity principle** (locked 2026-05-10): `web ≡ mobile`;
neither is primitive, and device-independent logic lives in shared
helpers under `apps/tasks-v0/src/ui/`.

This audit surfaces patterns, workarounds, and unresolved issues
that exist *because* the codebase must work identically on both
surfaces.

---

## A. Parity workarounds the projector should ABSORB

Patterns in the shared UI-helpers that the `renderWeb` / NavModel
design must respect or re-expose, rather than re-implement.

### 1. hard-dependencies gate →`describeTaskStatus()` + `canClose`
**File:** `apps/tasks-v0/src/ui/taskStatus.js:45–75`

**Pattern:** Substrate emits `status` field (ready | waiting | blocked
| claimed | submitted | complete | rejected) **and** an `openDeps[]`
array.  UI logic combines both into `depsBlocked` (true when
`status ∈ {waiting, blocked}` OR `openDeps.length > 0`).  Only
`claimed`/`submitted` tasks with `!depsBlocked` can close.

**For renderWeb:** Expose `describeTaskStatus(item) → {kind, label,
colorKey, depsBlocked, canClose, openDepIds[]}` as a contract; pre-
disable "Mark complete" / "Approve" buttons when `depsBlocked`.

### 2. Actor resolution via pubKey↔webid aliasing → `effectiveActor.js`
**File:** `apps/tasks-v0/src/ui/effectiveActor.js:60–125`

**Pattern:** Desktop's `LocalUiAuth` injects `from = webid` directly.
Mobile's React bindings dispatch with `from = agent.pubKey`.  A shared
resolver (`resolveActorWebid`, `resolveActorRole`, `buildActorAliases`)
handles both via a pubKey→webid alias map.

**For renderWeb:** Import `resolveActorRole({from, envelope,
circleState})` instead of assuming `from` is a webid; populate
`circleState.actorAliases` from `circle.members[].pubKey`.

### 3. Normalised args shape → `composeArgs.js`
**File:** `apps/tasks-v0/src/ui/composeArgs.js:41–162`

**Pattern:** Web form state + mobile Compose screen both convert to
the same `addTask` / `addSubtask` / `forceSpawnSubtask` payload via
pure functions (`buildAddTaskArgs` etc.).  Sub-task dependencies are
explicitly rejected in child compose to prevent desync of the
hard-deps gate.

**For renderWeb:** Use `buildAddTaskArgs(form)` to convert form
state; never hand-construct the payload.

### 4. DAG tree flattening → `dagFlatten.js`
**File:** `apps/tasks-v0/src/ui/dagFlatten.js:33–47`

**Pattern:** `getDagTree()` returns three possible shapes (bare node,
`{tree}`, `{trees}`).  Renderer must flatten to `{task, depth}` rows
via `flattenDagTree()`.

**For renderWeb:** Always consume `getDagTree()` output through
`flattenDagTree(input) → {task, depth}[]`; do not assume a fixed
shape.

### 5. Inbox event taxonomy → `inboxClassify.js`
**File:** `apps/tasks-v0/src/ui/inboxClassify.js:32–66`

**Pattern:** Events carry a `kind` field (subtask-proposal | task-
rejected | task-claimed | …).  Helpers (`kindOf()`, `proposalIdOf()`,
`requestIdOf()`) normalise old vs new shapes.

**For renderWeb:** Import `kindOf(event)` to classify inbox rows; do
not inspect `event.kind` directly.

### 6. Locale merging → `localisationMerge.js`
**File:** `apps/tasks-v0/src/ui/localisationMerge.js:33–73`

**Pattern:** Shared strings (status pills, role labels, circle kinds,
approval modes) live in `locales/shared/{en,nl}.json`.  Both shells
load their own `locales/{en,nl}.json` and merge via
`mergeLocales(shared, shellLocal)` so shell-specific labels win on
collision.

**For renderWeb:** Load `locales/shared/en.json` + `locales/en.json`
(web-local), call `mergeLocales(shared, webLocal)`, then use
`lookupKey(merged, 'shared.status.claimed')`.

### 7. Pod-attach activation → `attachTasksBundle.js`
**File:** `apps/tasks-v0/src/lib/attachTasksBundle.js:53–97`

**Pattern:** Both web (`podSignIn.js`) and mobile
(`ServiceContext.attachPod`) call the same function to wire pod
routing.  One mutable holder (`_podCtx`) carries classify/reverse
logic.

**For renderWeb:** When adding pod sign-in, import
`attachTasksBundle({bundle, source, podRoot, webid, fetch, provision})`
once after pod OIDC completes; do not duplicate routing logic.

---

## B. Parity workarounds that stay in the ADAPTER

Platform-specific adaptations that the projector should record as
boundaries, not absorb.

### 1. Multi-circle resolver with mobile React bindings
**File:** `apps/tasks-v0/src/bundleResolver.js:54–79`

> "Phase 41.18 follow-up: mobile React bindings inject `_scope:
> activeBundle.groupId` on every skill call."

Mobile's `useSkill` hook auto-injects `_scope` in the DataPart; web
forms must explicitly pass `circleId` in args if multi-circle.  Resolver
accepts both.

**For projector:** ensure the web adapter plumbs `circleId` into args
explicitly when multi-circle (no auto-injection).

### 2. Actor identity carrier differences
**File:** `apps/tasks-v0/src/rolePolicy.js:22–27`

> "Desktop's HTTP path: `LocalUiAuth` injects the localActor as
> webid.  Mobile React path: `from = agent.pubKey`."

The adapter (HTTP middleware vs React bindings) decides what ends up
in `from`.  Role-policy gate accepts aliases; UI gates use
`resolveActorRole()`.

**For projector:** wire `LocalUiAuth` or equivalent in the web
adapter to set `from = localActor` (a webid) in the envelope.

### 3. Locale bundle sources
**Files:** `apps/tasks-v0/locales/shared/` + `locales/` (web-local) +
`apps/tasks-mobile/locales/` (mobile-local)

`tasks-v0` owns the shared namespace; each shell owns its own screen
strings.  Mobile loads via `@onderling/react-native/localisation`; web loads
via `@onderling/local-store`'s localisation or raw fetch.

**For projector:** keep shared keys under `shared.*` in the merged
bundle; house web-specific keys at the top level.

### 4. Push token registration shape
**File:** `apps/tasks-v0/src/skills/pushTokens.js:6–24`

Mobile passes `appKey: 'tasks'`, `platform: 'expo'`.  Desktop
deferred; schema accommodates it. Multi-app per-webid map
prevents Pinboard and Tasks clobbering each other's tokens.

### 5. Chat skills for appeal threads
**File:** `apps/tasks-v0/src/skills/chat.js:4–22`

> "Phase 41.18.4 — added so the mobile appeal-thread screen has a
> concrete read/send surface."

Substrate (`@onderling/chat-p2p` via `wireChat`) wired identically on
both shells.  Skills (`sendChatMessage`, `getChatThread`,
`listChatThreads`) are generic; rendering/UX differs.

**For projector:** appeal flows use the same skills; import them
rather than reimplementing.

---

## C. Open / unresolved parity issues

**None explicitly documented as TODO/FIXME.**  However:

### 1. Multi-circle runtime newness
**Files:** `apps/tasks-v0/src/bundleResolver.js`, `Circle.js:690–700`

V2 substrate adoption shipped 2026-05-14; multi-circle resolver is < 1
week old.  The `_scope` injection (mobile-specific) is documented
inline but minimally exercised in production.  If web adds multi-circle
later, the `circleId` vs `_scope` branching should be tested end-to-end
with both shells.

### 2. Pod provisioning — deferred, app-specific
**File:** `apps/tasks-v0/src/lib/attachTasksBundle.js:18–21`

> "Pod provisioning: Tasks does not have its own provisioner yet."

Pinboard has a provisioner; Tasks reuses it (rule-of-two lift deferred).
Callers inject a `provision` callback; absent → step skipped
(byte-neutral).  **No known blockers.**

### 3. Web-form → NavModel projection (Slice B migration risk)
The existing web forms call `buildAddTaskArgs()` directly.  If
`renderWeb` introduces a new form abstraction, it must still feed
the same normalised args shape to the skill.  **Migration risk, not
a parity issue.**

### 4. Characterization corpus — pages not yet snapshot-locked
**File:** `apps/tasks-v0/docs/characterization-corpus.md`

7 stable pages have snapshot starters; 5 in-flight pages hold their
snapshots until V2 settling.  Gate for Slice B's "before == after"
proof.

---

## Summary for renderWeb design

1. **Absorb the UI-helper contracts** (§A.1–7): Import + use
   `describeTaskStatus`, `effectiveActor`, `composeArgs`,
   `dagFlatten`, `inboxClassify`, `localisationMerge`,
   `attachTasksBundle` directly.  These are DRY, tested, shared
   with mobile.
2. **Record the adapter boundaries** (§B.1–5): Ensure the web
   adapter wires `LocalUiAuth` to set `from = webid`, plumbs
   `circleId` into multi-circle args, and loads locales from
   `locales/shared/` + `locales/` (web-local).
3. **Note the open areas** (§C): Multi-circle resolver newness; pod
   provisioning callback-injected; characterization corpus gates
   the migration.
