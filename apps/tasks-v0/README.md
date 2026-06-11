# H4 — tasks-v0

> **Direction (decided 2026-06-11):** this app will **dissolve into canopy-chat**. Its `manifest.js`
> stays (the source of truth all projectors read), but the `tasks` name becomes a **navigation label**
> for this functionality inside the unified chat surface — not a separate app/build/shell. See the root
> README's *Direction* note.

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, local-store, chat-p2p, identity-resolver, notifier, skill-match}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).
>
> **Manifest + tier policy.** This app's surface is declared in
> [`manifest.js`](./manifest.js) (NavModel substrate V0.8 / Q1–Q27).
> Pages follow [`DESIGN-tier-policy.md`](../../DESIGN-tier-policy.md):
> **T1** substrate-rendered (`dag.html`, `mine.html`, `review.html`,
> `inbox.html`); **T2** manifest-bound (`pod-settings.html` —
> V0.4-adopt + Q26 requiresField); **T3** fully bespoke
> (`availability.html`, `onboard.html`). New pages declare a tier in
> their HTML header comment. The page→skill drift canary in
> [`test/page-skill-drift.test.js`](./test/page-skill-drift.test.js)
> asserts every `callSkill('id')` in `web/*.html` maps to a real
> `defineSkill`.

Multi-tenant task ledger with DAG dependencies + skill-based
dispatch + role-aware governance + DoD-with-approver lifecycle +
sub-task spawning + in-app inbox + local calendar conflict view +
per-event observability.

**Status:** **V2 (`0.4.0`) shipped 2026-05-14 — full standardisation
adoption + multi-crew runtime + cross-device substrate-mirror.**
V1 (`0.2.0`) shipped 2026-05-08. 122/122 tests across 7 test files.

V2 brought:
- `embeds:[{type,ref}]` on `addTask` + `crewConfig.storage` (§II.2:
  no-pod / centralised / decentralised / hybrid).
- `/welcome.html` create-crew wizard + `provisionMyCrew` skill.
- agent-registry per crew bundle (Phase 52.10).
- `/onboard.html` invite redemption + `/pod-settings.html` storage
  policy + pod OIDC sign-in (Phase 52.15.3 via `createSolidAuthNode`).
- `bin/tasks-ui.js --multi-crew` flag: shared meshAgent + crewsMap +
  `spawnMyCrew` skill + multi-crew onboarding dispatch.
- Phase 52.9.3 substrate-mirror: every mutation
  (add/claim/complete/submit/approve/reject/revoke/reassign/remove)
  fans out via `notifyEnvelope.publish`, applied on receivers via
  the gate-bypass `ItemStore.applySync`/`removeSync` methods.
- Stale-peer auto-heal, `fetch-resource` + `groupCheck`, live
  peer-roster updates from invite redemption.

See [`CHANGELOG.md`](./CHANGELOG.md) for the 12-slice breakdown +
commit refs, and
[`../../Project Files/Tasks App/v2-web-functional-design-2026-05-11.md`](../../Project%20Files/Tasks%20App/v2-web-functional-design-2026-05-11.md)
for the design source.

V0 (single-household, no Crew envelope) ships unchanged; V1 is
additive — `createCrewAgent` wires the V1+ surface; the legacy
`createTasksAgent` keeps working for V0 callers.

## What's in here

### Composition + envelope
- **`src/Agent.js`** — V0 factory `createTasksAgent({roles, members | pod, ...})`. Returns `{agent, itemStore, members, notifier, skillMatch, localStore}`. V1 callers usually go through `createCrewAgent` instead.
- **`src/Crew.js`** — V1 factory `createCrewAgent({crewConfig, localStoreBundle, ...})`. Wires Crew envelope + `MemberMapCache` (auto-persist roster) + `buildOnboardingSkills` (issueInvite/redeemInvite) + `wireChat` (peer chat for the appeal flow) + `Notifier` + `wireIssuerNotifications` + `MetricsTracker`. `crew.kind ∈ household | project | team | friends | maintenance` drives per-kind defaults; `crew.paused` / `crew.archived` flip via `pauseCrew`/`archiveCrew` skills. Exposes `bundle.close()` for clean shutdown.

### Storage + lifecycle helpers
- **`src/storage/buildBundle.js`** — wraps `local-store.CachingDataSource` for offline-first reads + write-through-on-pod-attach.
- **`src/storage/settings.js`** — `local-store.createSettingsModule({appId: 'tasks', ...})` bound with the V1 schema (shared: `pushPreferences`/`cadenceOverrides`/`defaultCalendarShared`; device: `pollIntervalMs`/`localModeRoot`).
- **`src/rolePolicy.js`** — standard 5 roles + Phase 5 DoD gates (`canSubmit`/`canApprove`/`canReject`/`canRevoke`) + Phase 7 narrow exception (assignee/master may append to `dependencies`).
- **`src/dag.js`** — `computeStatus(task, open, closed) → 'ready' | 'waiting' | 'blocked'` + `detectCycle`.
- **`src/dag-tree.js`** — `childrenOf` / `treeOf` / `ancestorChain` / `depthOf` / `wouldCreateParentCycle` (sub-task hierarchy).

### Skills (auto-registered per phase)
- **`src/skills/index.js`** — `addTask` (with paused/archived gate) + `claimTask` / `completeTask` / `reassignTask` / `removeTask` / `listOpen` / `listMine` / `listClaimable` + Phase 5 `submitTask` / `approveTask` / `rejectTask` / `revokeTask` / `setApprovalMode`.
- **`src/skills/profile.js`** — Phase 3 canonical profile + crew vocab (`getMySkillsFormShape` / `editMySkillsForCrew`).
- **`src/skills/subtasks.js`** — Phase 7 `addSubtask` + `approveSubtaskRequest` / `declineSubtaskRequest`.
- **`src/skills/appeal.js`** — Phase 6 `appealTask` (opens chat-p2p thread to master).
- **`src/skills/inbox.js`** — Phase 8 `listMyInbox` / `inboxBadgeCount` / `clearInboxItem` / `clearInbox`.
- **`src/skills/workspace.js`** — Phase 8 UI helpers (`getCrewConfig` / `listAwaitingApproval` / `listSubtaskRequests` / `getDagTree` / `listMyMasteredTasks`).
- **`src/skills/observability.js`** — Phase 9 `getMetrics` / cadence config skills.
- **`src/skills/crewControls.js`** — Phase 10 `pauseCrew` / `unpauseCrew` / `archiveCrew` / `unarchiveCrew` / `getPrivacyNotice`.

### Notifications + observability
- **`src/bridges/InAppInboxBridge.js`** — `MessagingBridge` that writes per-recipient notifications to `mem://user/inbox/<id>.json`. Substrate-candidate flagged.
- **`src/notifications/wireIssuerNotifications.js`** — subscribes itemStore events; routes to per-recipient inbox bridges.
- **`src/observability/metrics.js`** — `MetricsTracker` over notifier's `UsageMetrics` + bounded latency reservoirs (time-to-claim / submit-to-approval).
- **`src/observability/cadence.js`** — `resolveCadence({eventType, baseline, crew, user})` (user > crew > baseline).
- **`src/calendar/iCalReader.js`** — Phase 4 local-only `parseIcsToBusy` + `readMyCalendar`. **No network freebusy skill** — calendar data stays on the user's device.

### Localisation + privacy
- **`locales/{en,nl}.json`** — `{text, doc}` leaf shape (project convention); ~60 keys per language covering nav, status pills, actions, composer, crew labels, inbox event chips, error codes.
- **`src/lib/localisation.js`** — `i18next` wrapper with `unwrapLeaves` so callers write `t('common.save')` directly.
- **`src/lib/privacyNotice.js`** — closed-beta notice content; 6 items in nl + en; surfaced via `getPrivacyNotice` skill + `/privacy.html`.

### Web UI (`web/`)
Seven screens served by `mountLocalUi({staticDir})` from `@canopy/agent-ui` on `127.0.0.1`:
- `index.html` — workspace home + V1 add-task composer (DoD + approval-mode picker)
- `mine.html` — Assigned / I'm master of / Ready to claim + per-user cadence overrides
- `review.html` — approver inbox
- `dag.html` — sub-task tree
- `crew.html` — members + settings + stats + admin cadence config + pending sub-task requests
- `inbox.html` — notifications with action-button routing (approve/decline/appeal)
- `privacy.html` — closed-beta privacy notice (en/nl picker)
Plus shared `app.js` (skill client + `lifecycleStatus` + `mountInboxBadge` + `renderTasks`) and `style.css`.

### CLI
- **`bin/tasks-ui.js`** — V0 (`--role` / `--config`) and V1 (`--crew <crewconfig.json>`) modes. `--storage-root <path>` enables `core.FileSystemSource`-backed restart-survival.

## Usage

```js
import { createTasksAgent } from '@canopy-app/tasks-v0';
import { mountLocalUi }     from '@canopy/agent-ui';

const bundle = await createTasksAgent({
  roles: {
    'https://id.example/anne':  'admin',
    'https://id.example/bob':   'coordinator',
    'https://id.example/kid':   'member',
  },
  members: [
    { webid: 'https://id.example/anne',  displayName: 'Anne',  role: 'admin' },
    // ...
  ],
});

// Expose skills over A2A's standard wire shape on 127.0.0.1.
// `mountLocalUi` wraps `core.A2ATransport`; clients use
// `LocalAgentClient` (also from @canopy/agent-ui) to call skills
// + subscribe to events via SSE.
const ui = await mountLocalUi(bundle.agent, { port: 8080 });

// Apps subscribe to itemStore / agent events directly:
bundle.itemStore.on('item-added', (item) => { ... });
bundle.agent.on('task-completed', (e)    => { ... });

// On shutdown:
await ui.close();
```

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Notes |
|---|---|---|
| `@canopy/item-store` (L1b) | Open/closed tasks with attribution + audit + per-field merge contracts + DoD lifecycle (`submitted`/`rejected` states); plugs `buildStandardRolePolicy(roles)` into the substrate's role-policy gate. | Phase 5 extended the substrate with the DoD lifecycle (used by Tasks V1; Stoop's lend-flow is the second consumer). |
| `@canopy/skill-match` (L1e) | Pubsub-of-skills claim flow when a skill-tagged task is added; composes a real `core.Agent` + `core.protocol.pubSub`. | Optional in V1 (skillMatch parameter to `createTasksAgent`). |
| `@canopy/identity-resolver` (L1h) | `MemberMap` + `MemberMapCache` (auto-persist roster) + `buildOnboardingSkills` (issueInvite/redeemInvite) + `TAXONOMY` / `normaliseTag` / `matchesProfile` (skill canonicalisation). | Lifted from Stoop 2026-05-08 (rule of two). |
| `@canopy/notifier` (L1f) | `Notifier` for scheduled jobs (missed-deadline) + `InMemoryScheduleStore` + `NoopChannel`/`PushChannel` + `UsageMetrics` (Phase 9 counters). | Per-recipient `InAppInboxBridge` channels added at runtime via the shared `channels` map. |
| `@canopy/agent-ui` (L1d) | `mountLocalUi(bundle.agent)` exposes skills over A2A's standard wire shape on `127.0.0.1`. | Web UI pages are static files in `web/`. |
| `@canopy/local-store` (NEW) | `CachingDataSource` + `SyncCadence` (offline-first) + `createSettingsModule` (shared/per-device split). | Lifted from Stoop 2026-05-08; `LocalFileSource` is `core.FileSystemSource` reused. |
| `@canopy/chat-p2p` (NEW) | `wireChat({...})` for the Phase 6 appeal flow (peer-to-peer chat thread between assignee and master). | Lifted from Stoop's `wireChat.js` 2026-05-08. |

App-level glue is `~1100 LOC` of skills + bridges + observability +
crew envelope, none of which duplicate substrate functionality.

## Architecture: ONE `core.Agent` per service-context

Tasks-v0's `createCrewAgent` is currently CLI-shaped (one process =
one crew). When Tasks gains a mobile / multi-crew shell:

- **Don't** call `createCrewAgent` once per crew — that creates N
  agents with N transport stacks (mDNS / relay / etc.) under one
  identity, which is the anti-pattern the project-wide single-agent
  rule was written to prevent.
- **Do** build ONE `core.Agent` at the service-context level and
  layer per-crew state (ItemStore + MemberMap + SkillMatch + bot +
  bridges, …) onto it via a `buildCrewState({meshAgent, crewConfig,
  ...})` factory. Skills register on the agent ONCE with a
  `getBundle` resolver picking the crew from `args.crewId` /
  topic.
- Reference implementation: `apps/stoop-mobile`'s `ServiceContext`
  + `buildGroupState`. Mirror the pattern.

Full propagation plan (file-level deltas Tasks will need):
[`Project Files/Stoop/single-agent-refactor-2026-05-08.md`](../../Project%20Files/Stoop/single-agent-refactor-2026-05-08.md)
§ "Tasks-app fix propagation". Project-wide convention:
[`Project Files/conventions/single-agent.md`](../../Project%20Files/conventions/single-agent.md).

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `VaultMemory`, `InternalBus`, `InternalTransport`, `MemorySource` | Constructing the per-household agent that the substrates compose; `MemorySource` is the default DataSource for `ItemStore`. | No substrate wraps "construct an agent"; `MemorySource` is the in-memory `core.DataSource` concrete (apps swap in a `pod-client.PodClient` adapter for production). |

## Shared UI helpers

This app exposes the following pure-fn helpers under `src/ui/` for
its sibling platform shell (`apps/tasks-mobile`) to consume — per the
project rule
[`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10):

| Helper | Purpose | Consumed by |
|---|---|---|
| `taskStatus`     | `describeTaskStatus(item)` rolls up the lifecycle ∪ DAG status + V2.7 deps gate (`depsBlocked`, `canClose`, `openDepIds`); `shouldOfferForceComplete` / `shouldProposeSubtask` for admin/master overrides. | `web/app.js`, `apps/tasks-mobile/src/screens/*.jsx` |
| `composeArgs`    | `buildAddTaskArgs(form)` / `buildForceSpawnArgs(form)` — pure-fn translators from compose-form state to the `addTask` / `forceSpawnSubtask` skill payloads. | both shells |
| `inboxClassify`  | `kindOf(event)` + `proposalIdOf(event)` + `requestIdOf(event)` — inbox event-kind taxonomy used to pick the right card layout. | both shells |
| `effectiveActor` | `resolveActorWebid({from, envelope, crewState})` + `resolveActorRole({...})` + `buildActorAliases(members)` — pubKey ↔ webid resolution against the crew's role table. Mobile's React-bindings dispatch carries `from = pubKey`; the desktop's relay path will hit the same shape. | both shells (mobile via `useActiveRole`; desktop's role policy via `buildStandardRolePolicy(roles, {aliases})`) |
| `localisationMerge`      | `mergeLocales(shared, shellLocal)` + `lookupKey(bundle, path, fallback)` — deep-merge helpers for the shared locale namespace. | both shells |

Tests live in `test/ui/*.test.js` and run on this app's vitest config
(Node only, no RN polyfills). The mobile shell does not duplicate
these tests; it imports the helper and trusts the shared coverage.

**Locale parallel.** The genuinely-shared strings (status pills,
role labels, crew kinds, approval modes) live in
`apps/tasks-v0/locales/shared/{en,nl}.json`. Both shells merge that
bundle on top of their own — see
`apps/tasks-mobile/src/LocalisationProvider.js` for the consumer pattern.

## Bring it up

```bash
cd apps/tasks-v0
npm install
npm test          # 176 tests across 13 files

# Run the V0 web UI (single-member admin — fastest to play with):
npm run ui -- --actor https://id.example/anne --role admin
# UI ready at http://127.0.0.1:<port>
# Add a task; claim it from /mine.html.

# V0 multi-member household via config file:
cat > household.json <<'EOF'
{
  "roles":   {
    "https://id.example/anne":  "admin",
    "https://id.example/bob":   "coordinator",
    "https://id.example/kid":   "member"
  },
  "members": [
    {"webid": "https://id.example/anne",  "displayName": "Anne",  "role": "admin"},
    {"webid": "https://id.example/bob",   "displayName": "Bob",   "role": "coordinator"},
    {"webid": "https://id.example/kid",   "displayName": "Kid",   "role": "member"}
  ]
}
EOF
npm run ui -- --actor https://id.example/anne --config ./household.json

# V1 Crew mode (full envelope: DoD lifecycle + sub-tasks + inbox + …):
cat > oss-tools.crew.json <<'EOF'
{
  "crewId": "oss-tools",
  "name":   "OSS Tools NL",
  "kind":   "project",
  "members": [
    {"webid": "https://id.example/anne",  "displayName": "Anne",  "role": "admin"},
    {"webid": "https://id.example/bob",   "displayName": "Bob",   "role": "coordinator"},
    {"webid": "https://id.example/kid",   "displayName": "Kid",   "role": "member"}
  ],
  "subtasksAdminApprovalDepth": 4,
  "dodPolicy": {"defaultApproval": "self-mark"}
}
EOF
npm run ui -- --actor https://id.example/anne --crew ./oss-tools.crew.json

# V1 Crew mode WITH restart-survival via a local FS-backed bundle:
npm run ui -- \
  --actor https://id.example/anne \
  --crew  ./oss-tools.crew.json \
  --storage-root ./.tasks-data
# Now the inbox + crew roster + tasks survive `Ctrl-C` + relaunch.
```

## V1 design + plan documents

- [`Project Files/Tasks App/advice-2026-05-07.md`](../../Project%20Files/Tasks%20App/advice-2026-05-07.md) — design + recommendations.
- [`Project Files/Tasks App/critique-2026-05-07.md`](../../Project%20Files/Tasks%20App/critique-2026-05-07.md) — honest design pushback (some items folded into V1; rest accepted as trade-offs).
- [`Project Files/Tasks App/coding-plan-2026-05-07.md`](../../Project%20Files/Tasks%20App/coding-plan-2026-05-07.md) — phased build plan.
- [`Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`](../../Project%20Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md) — Stoop-side migration for the lifted substrates.
- [`apps/tasks-v0/CHANGELOG.md`](./CHANGELOG.md) — per-phase shipping log.

## Local-only mode (V0 + V1)

**The app works locally without a Solid pod.** Connecting a pod
adds cross-device sync; it is never required. The boot path,
all skills, the inbox, calendar conflict view, and the workspace
UI all work against local storage. `core.MemorySource` covers
in-process; `LocalFileSource` (V1, in `@canopy/local-store`)
persists across restarts. Pod-mode wraps the same `core.DataSource`
interface — no code path differences from the app's perspective.

This is a hard rule for V1, not a V1.5 improvement. See
`Project Files/Tasks App/advice-2026-05-07.md` § *Local-only
operation*.

## V0 vs V1 vs V1.5+

V0 (`createTasksAgent`, no Crew envelope):
- Single household, 4-6 members, high trust.
- Standard 5-role policy.
- DAG dependencies + cycle detection.
- Compare-and-swap claim flow.
- Skill-tagged tasks (via L1e).

V1 (`createCrewAgent`, shipped 2026-05-08):
- **Crew envelope** (multi-tenant, role-aware, decentralised; `crew.kind ∈ household | project | team | friends | maintenance`).
- **DoD lifecycle** on item-store (`submitted` + `rejected` states + `approval` modes `self-mark` / `creator` / `webid:X`).
- **Sub-tasks by the accepter** with admin-approval threshold (`crew.subtasksAdminApprovalDepth`, default 3; spawns past it queue admin approval).
- **Master per task** + `revoke` (mandatory reason) + `appeal` (chat thread to master, 7-day window).
- **Local calendar conflict view** — `parseIcsToBusy` reads pod-mirrored `*.ics`; no network freebusy skill.
- **In-app inbox** via `InAppInboxBridge` (per-recipient `MessagingBridge`); routes inbox button taps for approve/decline/appeal.
- **Skill-import** from canonical `<user-pod>/profile/skills.json` with prefilled-edit-before-submit form.
- **Per-event observability** — `MetricsTracker` over notifier's `UsageMetrics` + bounded latency reservoirs; admin/coord cadence config + per-user overrides (user > crew > baseline).
- **Crew lifecycle** — `pauseCrew` (blocks new tasks) / `archiveCrew` (read-only ledger).
- **Closed-beta privacy notice** in nl + en, surfaced via `getPrivacyNotice` + `/privacy.html`.
- **Local-only mode** is a hard rule — works without a Solid pod connection.

V1.5 (deferred, ~7 dev-days):
- Push notification channel (`PushChannel` + `PushPolicy` promotion from Stoop).
- Custom-role management UI (`core.Roles.registerCustomRole` already in core; UI is the missing piece).
- Chat-bot bridge (Telegram via `chat-agent.TelegramBridge` already in core; ~2-3 days of `bot.*` skill wiring).
- Calendar import-bridge (Google + Outlook listener; iCloud + CalDAV poll) in `apps/import-bridge-v0`.

V2+ (demand-driven):
- Auto-scheduling planner.
- Cross-crew dashboard.
- Real-time collaboration on a deliverable doc (waits for project #1 OSS-doc-tool integration).
- Compensated-role flag + invoicing primitives.
- Cryptographic anonymity (waits for Stoop V2's Q-H5 unpark).
- Recurring tasks.
- Multi-claim / co-assignment.

## Test coverage

**176 tests across 13 files** (V0 baseline + V1 phases 1-10):

| File | Tests | What it covers |
|---|---|---|
| `test/integration.test.js`        | 24 | V0 role-policy + DAG + claim races + skill-tagged filtering + member resolution. |
| `test/web.test.js`                | 10 | V0 web UI smoke (static serving, agent card, `/tasks-config.json`, role-policy via HTTP). |
| `test/phase1-local-store.test.js` |  6 | `buildBundle` + `localStoreBundle` integration with `createTasksAgent`; V0 zero-config preserved. |
| `test/phase1-settings.test.js`    |  6 | Tasks-bound `createSettingsModule`; defaults + validators + round-trip. |
| `test/phase2-crew.test.js`        |  9 | CrewConfig load/save + missing-config fallback + per-kind defaults + onboardingSkills + MemberMapCache auto-persist. |
| `test/phase3-profile.test.js`     | 18 | Canonical profile + crew vocab + posture round-trips; tag canonicalisation; `prefilledFormShape`; live skills. |
| `test/phase4-calendar.test.js`    | 14 | `parseIcsToBusy` (one-shot, RRULE, all-day, VTIMEZONE, range edges) + `readMyCalendar`. |
| `test/phase5-dod.test.js`         | 15 | App-side DoD lifecycle through `submitTask`/`approveTask`/`rejectTask`/`revokeTask`/`setApprovalMode` + role-policy gates. |
| `test/phase6-inbox.test.js`       | 14 | `InAppInboxBridge` + issuer-notification routing + `appealTask` authz + 7-day window. |
| `test/phase7-subtasks.test.js`    | 16 | dag-tree helpers + addSubtask + admin-approval queuing + approve/decline + status integration. |
| `test/phase8-ui.test.js`          | 11 | All 6 UI pages serve + nav skeleton + workspace + inbox + creator-approval cycle end-to-end. |
| `test/phase9-observability.test.js` | 16 | MetricsTracker + cadence resolution + setCrewCadences (admin-gated) + setMyCadenceOverrides. |
| `test/phase10-lifecycle.test.js`  | 17 | localisation init/translate/interpolate; locale `{text, doc}` schema validation; en+nl key-set parity; pause/archive flow + addTask gate; privacy notice content. |

Plus the substrate-level item-store tests (`packages/item-store/test/ItemStore.dod.test.js` — 24 substrate tests) cover the DoD lifecycle at the substrate layer.

## See also

- `Project Files/Tasks App/advice-2026-05-07.md` — V1 design.
- `Project Files/Tasks App/critique-2026-05-07.md` — design review.
- `Project Files/Tasks App/coding-plan-2026-05-07.md` — phased plan.
- `Project Files/Substrates/apps/H4-tasks.md` — substrate-composition sketch (V1 update).
- `Project Files/Substrates/L1b-item-store.md` — primary substrate.
- `Project Files/Substrates/policies.md` — rule-of-two methodology.
- `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md` — Stoop-side migration log for the lifted substrates.
