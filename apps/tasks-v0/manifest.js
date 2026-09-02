/**
 * tasks-v0 — app manifest (V0, locked 2026-05-20).
 *
 * Declarative source for the core task-lifecycle ops mined from
 * `src/skills/index.js`'s `defineSkill` calls.  V0 scope is
 * deliberately small: only the chat-callable surface.  The web UI
 * stays 100% hand-built — it is rich + well-tested (14 HTML pages
 * with shared UI-helpers consumed by the mobile shell too), and
 * replacement requires careful page-by-page characterization (,
 * deferred).
 *
 * itemTypes = ['task'] (canonical in @onderling/item-types; F-SP1-a not
 * needed here — all types are canonical).
 *
 * F-SP3-a (locked 2026-05-20, in code): `appliesTo.state` accepts a
 * string OR an array of strings, so DoD-lifecycle ops can declare
 * multi-state gates (`['claimed','submitted','rejected']` for revoke,
 * etc.).  Tiny additive extension of `renderChat.matchesAppliesTo`.
 *
 * **Part G dissolve (2026-06-17):** this is now the ONE tasks manifest.
 * basis's former `mockTasksManifest` (the chat-shell slash/gate
 * surface for the REAL tasks-v0 skills) was folded in here and re-
 * exported as `mockTasksManifest` (Option 2 — clean, no back-compat
 * vocab bridges).  So the app's web/mobile screens AND the chat shell
 * (circle LLM + deterministic gate) now read a single source of truth.
 * `surfaces.slash` (with the device-verified Part-C gate `match`
 * objects), id-param `pickerSource`, and `ui` buttons live below; the
 * circle bot's deterministic gate (`renderGate`) reads them straight
 * from here.
 *
 * Param vocabulary speaks the REAL skill's names (no shell-side rewrite):
 * `rejectTask` declares `note` (not the mock's `reason`); `submitTask`
 * keeps the real optional `note`.  Semantic op-aliases that ARE product
 * decisions (listMine→listOpen, getMyTasks→listOpen, myInbox→listMyInbox)
 * stay in `realAgent.js`'s `TASKS_OP_ALIAS` — they are NOT drift.
 *
 * Hints come from the existing `defineSkill({description})` strings
 * (one source — no fresh prose).
 *
 * Complex array/object params (`dependencies`, `embeds`,
 * `requiredSkills`, `deliverable`, `approval` mode) are intentionally
 * NOT modelled in the LLM surface — those live in the web form and
 * get re-modelled by 's renderWeb.
 */

const ID_NONEMPTY  = { schema: { minLength: 1 } };
const STR_NONEMPTY = { schema: { minLength: 1 } };

export const tasksManifest = {
  app:       'tasks',
  /*
   * .3 (2026-05-20) — `'inbox-item'` joins as an app-local
   * (non-canonical, F-SP1-a) item type so the `inbox` view can declare
   * `view.type: 'inbox-item'` (validateView pins `view.type` ∈
   * `manifest.itemTypes`).  Inbox notifications are NOT real ItemStore
   * items — they live at `mem://user/inbox/<id>.json` (cross-app,
   * per-user), written by `InAppInboxBridge` (Phase 6) and read by
   * `listMyInbox`.  The manifest uses `'inbox-item'` purely as a
   * NavModel category tag for routing the `inbox` view + the
   * `clearInboxItem` itemAction.
   */
  /*
   * .4 (2026-05-20) — `'circle-storage-policy'` joins as an
   * app-local (non-canonical, F-SP1-a) item type so the `pod-settings`
   * view can declare `view.type: 'circle-storage-policy'`
   * (validateView pins `view.type` ∈ `manifest.itemTypes`).  Like
   * stoop's `'group-rules'` placeholder for its settings view, the
   * circle storage policy is a SINGLETON record (one merged object:
   * `{policy, groupPodUri?}`), not a list of items. See
   * (`shape: 'record'`) — the view encodes that reality.
   */
  // Part G (2026-06-17) — 'schedule-slot' + 'member' folded in from the former
  // mockTasksManifest (the suggest/acceptSchedule + listCircleMembers ops gate on
  // them).  'subtask-request' / 'subtask-proposal' already model the inbox-kind
  // subtask ops via `appliesTo.kind` on 'inbox-item'; the mock's standalone
  // subtask ops (addSubtask / proposeSubtask) gate on 'task', so no new type is
  // needed for those.
  itemTypes: ['task', 'inbox-item', 'circle-storage-policy', 'circle', 'schedule-slot', 'member'],

  // B · Layer 1 — domain (non-atom) verb: `tree` (DAG traversal of the task
  // graph — structural, not a plain `list`).  All other ops map to SDK atoms.
  domainVerbs: ['tree'],

  // B · Layer 1 — DECLARED-AUTHORITATIVE (verb × noun) capability surface (docs/decisions.md 2026-07-02;
  // PLAN-capability-arc §1a). This declaration IS the member-facing capability set — a broad `appliesTo` can no
  // longer mint phantom capabilities. Equals the current derived set (inert), now explicit + owned here.
  // Keys ∈ itemTypes; atoms are CANONICAL SDK atoms.
  nouns: {
    task:            { atoms: ['add', 'list', 'update', 'remove', 'complete', 'claim', 'reassign', 'submit', 'approve', 'reject', 'revoke'] },
    'inbox-item':    { atoms: ['list', 'approve', 'reject', 'remove'] },
    'schedule-slot': { atoms: ['add', 'list'] },
    circle:            { atoms: ['list', 'archive', 'unarchive'] },
    member:          { atoms: ['list'] },
  },

  operations: [
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params: [
        { name: 'text',             kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'notes',            kind: 'string' },
        { name: 'dueAt',            kind: 'number' },
        { name: 'definitionOfDone', kind: 'string' },
        // Claim confirmation mode (the master's call at creation): 'explicit' holds a claim PENDING until the
        // master confirms it; 'auto' (default) confirms the first claim immediately. See the confirmClaim op.
        { name: 'claimConfirmation', kind: 'enum', of: ['auto', 'explicit'], required: false },
        // Claim lease (§2.8), ms — an unfinished claim auto-releases after claimedAt+claimLease. Absent ⇒ manual.
        { name: 'claimLease', kind: 'number', required: false },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate folded in from the former mockTasksManifest.
        slash: { command: '/addtask', body: 'flags',
          // F-SP2 (2026-06-11) — the deterministic NL gate (renderSlash/renderGate): "add X" routes
          // here without the LLM. `text-only` → the body is the task text; dropTrailing strips the
          // "… to/op the list" qualifier so "add milk to the list" → text "milk".
          match: {
            verbs:        ['add', 'todo', ['new', 'task'], 'voeg', 'zet', ['maak', 'taak'], ['nieuwe', 'taak']],
            body:         'text-only',
            dropTrailing: ['to', 'aan', 'op', 'toe'],
          } },
        chat: {
          reply: 'text', hint: 'Create a task; rejects on dependency cycles. Blocked when circle is paused/archived.',
          // The created task's own card — the snapshot a composer reads back so a task made from the
          // conversation APPEARS in the conversation, instead of only existing in the Tasks tab.
          embed: { cardSnapshotSkill: 'getTaskSnapshot' },
        },
        // A composer affordance: "+ → Task" makes one here, in the conversation people are having.
        // Declared, not coded — the menu is `renderAttachments` over whatever the circle composes.
        attach: { label: 'circle.attach.task', group: 'create' },
      },
    },
    {
      id:        'claimTask',
      verb:      'claim',
      appliesTo: { type: 'task', state: ['open'] },                      // F-SP3-a
      // DECLARATION LAYER (#34) — this op writes the task's `assignee` under the CLAIM policy (first-wins /
      // immutable-once-set): concurrent claims resolve to the first grab, not the latest write. Declared per-op,
      // enforced by the receiver against (item-type,field) — a sender cannot downgrade it. Delivery follows the
      // policy (at-least-once). See @onderling/item-store `resolutionPolicy`.
      resolves: [{ field: 'assignee', policy: 'claim' }],
      params: [
        {
          name: 'id', kind: 'string', required: true, ...ID_NONEMPTY,
          // v0.7. — bare `/claim` → form shows clickable task list.
          // Resolve the label against OPEN tasks: claim applies to state:['open'], and listMine
          // excludes the unclaimed tasks you'd actually be claiming (device-verify 2026-06-11 — a
          // freshly-added task was never in listMine, so "claim X" never resolved → "couldn't find X").
          pickerSource: { listOp: 'listOpen' },
        },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate + pickerSource folded in.
        slash: { command: '/claim',
          // NL gate — "claim X" / "I'll take X" / "ik pak X" → claimTask{id}. `arg:'id'` targets the
          // pickerSource param so the clarifying dispatch resolves the label → a real task id.
          match: {
            verbs: ['claim', 'pak', 'neem', ["i'll", 'take'], ["i'll", 'do'], ['ik', 'pak'], ['ik', 'doe'], ['ik', 'neem']],
            body:  'match',
            arg:   'id',
          } },
        chat: {
          hint:  'Compare-and-swap claim a task.',
          // (basis v0.5, 2026-05-22) — declare a snapshot
          // factory so this op surfaces as embeddable in chat.  The
          // `getTaskSnapshot` skill below is the source.
          embed: { cardSnapshotSkill: 'getTaskSnapshot' },
        },
        ui: { control: 'button', label: 'Claim' },
      },
    },
    {
      // Confirm a PENDING claim (explicit-confirm tasks) so the claimant may decompose — the master/admin's
      // ratification. Auto-confirm tasks never surface this (claimTask already confirms). Verb `confirm`
      // (lifecycle atom). appliesTo the `claimed` state (a claim exists); the gate + the "am I the master?"
      // visibility live in the rolePolicy the projector reads.
      id:        'confirmClaim',
      verb:      'confirm',
      // Shows on a PENDING claim (explicit-confirm, not yet ratified) — the state `effectiveStatus` reports
      // as `pending-confirmation`. An auto-confirmed / already-confirmed claim is `claimed` and needs no button.
      appliesTo: { type: 'task', state: ['pending-confirmation'] },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY, pickerSource: { listOp: 'listOpen' } },
        { name: 'assignee', kind: 'string', required: false },   // which claim to confirm (defaults to the sole claimant)
      ],
      surfaces: {
        slash: { command: '/confirm',
          match: {
            verbs: ['confirm', 'bevestig', 'keur', ['keur', 'goed'], ['ken', 'toe']],
            body:  'match',
            arg:   'id',
          } },
        chat: { hint: 'Confirm a pending claim so the claimant may decompose the task.' },
        ui: { control: 'button', label: 'Confirm claim' },
      },
    },
    {
      id:        'completeTask',
      verb:      'complete',
      appliesTo: { type: 'task', state: ['claimed'] },                   // F-SP3-a
      params: [
        {
          name: 'id', kind: 'string', required: true, ...ID_NONEMPTY,
          // v0.7. — bare `/complete-task` → form picks from open tasks. completeTask is self-mark
          // mode (tasks-v0 `bot.markComplete` completes by label with NO prior claim), so resolve the
          // label against listOpen — listMine misses freshly-added unassigned tasks (device-verify
          // 2026-06-11 — "done socks" → listMine:[] → "couldn't find socks in this circle").
          pickerSource: { listOp: 'listOpen' },
        },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate + pickerSource folded in.
        slash: { command: '/complete-task',
          // NL gate — "done X" / "klaar met X" → completeTask{id}. Multiword phrases first so
          // "klaar met afwas" beats the bare "klaar". `arg:'id'` for the pickerSource resolution.
          match: {
            verbs: [['klaar', 'met'], ['done', 'with'], 'done', 'complete', 'completed', 'finished', 'klaar', 'voltooid', 'gedaan'],
            body:  'match',
            arg:   'id',
            // Also match the verb TRAILING the object ("kaas done", "afwas klaar") — the per-locale
            // 'complete' verb list (circleGateLexicon) is tried after the leading verbs above fail.
            trailing: 'complete',
          } },
        chat: {
          hint: 'Mark a task complete.',
          // same factory; lifecycle ops share the snapshot skill.
          embed: { cardSnapshotSkill: 'getTaskSnapshot' },
        },
        ui:   { control: 'button', label: 'Mark complete' },
      },
    },
    /**
     * `getTaskSnapshot(id)` → ItemSnapshot — factory (basis
     * v0.5).  Declaration-only in tasks-v0's manifest; the real skill
     * lives wherever tasks-v0's agent runs.  When basis
     * consumes tasks-v0's full manifest (currently it uses mocks),
     * /embed against tasks ops surfaces a real task-card.
     */
    {
      id:        'getTaskSnapshot',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      // Substrate, not a door: the card machinery reads this back (`cardSnapshotSkill`) whenever a
      // composer embeds one — no person ever taps "snapshot". `internal` takes it out of coverage and
      // out of the Advanced drawer. Internal ≠ unused; it is called on every embed.
      surfaces: { internal: true },
    },
    {
      id:        'removeTask', group: 'compose',
      verb:      'remove',
      appliesTo: { type: 'task' },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Remove a task — admin only via item-store role policy.' },
        // No inline button by design: the per-state task keyboard is
        // deliberately minimal (open→claim, claimed→complete/submit,
        // submitted→approve/reject/revoke).  removeTask is a hard-delete
        // that fits no single lifecycle state and is admin/role-gated;
        // `test/sp3-manifest.test.js` pins the open-task keyboard to
        // exactly [claimTask], so adding an always-on Delete button would
        // (correctly) break that design contract.  Stays chat/role-driven.
      },
    },
    /*
     * "authority travels with the task" (journey J8).
     * Attach a task-scoped, attenuated capability grant to a task for a
     * member. Off by default (a task carries no authority unless attached);
     * creator/admin-gated in the skill; revoked when the task
     * completes/cancels. Verb rides the task `update` atom (it mutates the
     * task's grant set) — no new capability atom minted. Chat-only surface:
     * the rich "Toegang voor deze taak" composer picker is a later web step
     * (volley 6), so no `ui`/`slash` here. The `grant` object is a complex
     * param modelled only in the composer/skill (same policy as addTask's
     * embeds/dependencies), so the LLM surface declares just taskId + member.
     */
    {
      id:        'attachTaskGrant',
      verb:      'update',
      appliesTo: { type: 'task' },
      params: [
        { name: 'taskId', kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'member', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Attach a task-scoped, attenuated capability grant to a task for a member (creator/admin only); revoked when the task completes.' },
        // entrusting authority routes through the SAME
        // confirm waist every consequential op uses: declaring `ui.confirm`
        // makes resolveDispatch emit `needsConfirm`, so the shared runConfirmGate
        // shows a "weet je het zeker?" before ANY grant is issued — the entrust
        // picker no longer bypasses the gate with a direct callSkill. `confirm`
        // WITHOUT a `control` adds no inline button (computeEmbedButtons requires
        // control === 'button'), so the deliberately-minimal task keyboard is
        // untouched. No `message` here (invariant #8: the manifest message is raw,
        // not t()'d) → the gate falls back to the localised default prompt.
        ui: { confirm: { severity: 'warn' } },
      },
    },
    {
      id:        'reassignTask', group: 'admin',
      verb:      'reassign',
      appliesTo: { type: 'task' },
      params: [
        { name: 'id',          kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'newAssignee', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Reassign a task — admin/coordinator only via item-store role policy.' },
      },
    },
    {
      id:        'submitTask',
      verb:      'submit',
      appliesTo: { type: 'task', state: ['claimed', 'rejected'] },        // F-SP3-a
      params: [
        {
          name: 'id', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listMine' },          // Part C — label→id resolution for the gate
        },
        { name: 'note', kind: 'string' },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate + pickerSource folded in.
        slash: { command: '/submit', body: 'flags',
          // Part C gate — "submit X" → submitTask{id}; id already has pickerSource:listMine.
          match: { verbs: ['submit', ['hand', 'in'], 'indienen', 'inleveren', ['ter', 'review']], body: 'match', arg: 'id' } },
        chat: { reply: 'text', hint: 'Submit a claimed task for approval.' },
        ui:   { control: 'button', label: 'Submit for review' },
      },
    },
    {
      id:        'approveTask',
      verb:      'approve',
      appliesTo: { type: 'task', state: ['submitted'] },                  // F-SP3-a
      params: [
        {
          name: 'id', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listMine' },          // Part C — label→id resolution for the gate
        },
        { name: 'note', kind: 'string' },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate + pickerSource folded in.
        // Part C gate — bare 'accept' is calendar.rsvpAccept's (collision); approveTask keeps approve/goedkeuren/akkoord.
        slash: { command: '/approve',
          match: { verbs: ['approve', 'goedkeuren', 'akkoord'], body: 'match', arg: 'id' } },
        chat: { reply: 'text', hint: 'Approve a submitted task.' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
    {
      id:        'rejectTask',
      verb:      'reject',
      appliesTo: { type: 'task', state: ['submitted'] },                  // F-SP3-a
      params: [
        {
          name: 'id', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listMine' },          // Part C — label→id resolution
        },
        // Part G reconciliation (2026-06-17): the mock used `reason`; the
        // REAL item-store skill wants `note` (audit-log convention) — REAL WINS.
        // The chat shell's former `reason→note` rewrite in realAgent.js is
        // therefore removed; the manifest declares the real name directly.
        { name: 'note', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash/gate + pickerSource folded in.
        // `body:'flags'` carries `--note=…`; Part C gate — rejectTask owns reject/afkeuren/afwijzen
        // (collision vs calendar.rsvpDecline, which keeps 'decline').
        slash: { command: '/reject', body: 'flags',
          match: { verbs: ['reject', 'afkeuren', 'afwijzen', 'weiger'], body: 'match', arg: 'id' } },
        chat: { reply: 'text', hint: 'Reject a submitted task with a mandatory note.' },
        ui:   { control: 'button', label: 'Reject' },
      },
    },
    {
      id:        'revokeTask',
      verb:      'revoke',
      appliesTo: { type: 'task', state: ['claimed', 'submitted', 'rejected'] },  // F-SP3-a
      params: [
        { name: 'id',     kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'reason', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Revoke an assignment with a mandatory reason (master only).' },
        ui:   { control: 'button', label: 'Revoke' },
      },
    },
    {
      id:        'listOpen', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [
        { name: 'type',          kind: 'string' },
        { name: 'requiredSkill', kind: 'string' },
        { name: 'assignee',      kind: 'string' },
        { name: 'status',        kind: 'string' },
      ],
      surfaces: {
        chat: {
          hint: 'List open tasks with computed status; filters: type/requiredSkill/assignee/status.',
          // (DESIGN gap, closed 2026-05-27) — tasks-v0's slot in
          // the morning brief.  /brief fans across apps that declare
          // `surfaces.chat.brief`; the `tasks_briefSummary` skill
          // (defined in src/skills/briefSummary.js, registered via
          // wireSkills) returns a count of open tasks + the topmost
          // rows.  `order: 20` slots between household (10) + stoop (30).
          brief: { summarySkill: 'tasks_briefSummary', order: 20, label: 'Tasks' },
        },
      },
    },
    {
      id:        'listMine',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        // Part G (2026-06-17) — slash/brief/search/screen folded in from the
        // former mockTasksManifest.  NB the chat-shell semantic of /mytasks is
        // broader than "tasks assigned to me" (realAgent aliases listMine→listOpen
        // — a product decision, not drift).
        slash: { command: '/mytasks' },
        chat: {
          reply: 'list',
          hint:  'List open tasks assigned to the calling actor.',
          // C4 (drift fix 2026-06-25): the canonical /brief decl lives on `listOpen`
          // (summarySkill 'tasks_briefSummary', order 20 — the registered skill). This op
          // carried a SECOND brief folded in from the old mock manifest ('briefSummary', not a
          // real tasks-v0 skill) → tasks double-counted in /brief AND called a missing skill.
          // Removed; the morning brief uses the open-tasks count (listOpen), not "my tasks".
          search: { searchSkill:  'searchTasks' },
        },
        // S6.B — this overview op can open a dedicated screen (the Screens
        // `tasks` block) instead of only listing inline. The host renders an
        // "Open …" affordance + a panel; the label is locale-resolved.
        ui: { screen: 'tasks' },
      },
    },
    {
      id:        'listClaimable', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [
        { name: 'skill', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'List unassigned tasks; optional `skill` filter.' },
      },
    },
    /*
     * task-claim-partition (2026-07-12) — double-claim conflict
     * surface. A partition→merge that double-claimed a task records a
     * claim-conflict on the substrate mirror instead of silently
     * last-writer-wins the assignee; these two ops read + resolve it.
     * Chat-only (no `ui` button — the open-task inline keyboard stays
     * exactly [claimTask], pinned by sp3-manifest.test.js). Verbs reuse
     * the already-declared task atoms (`list` / `reassign`).
     */
    {
      id:        'listClaimConflicts', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List unresolved double-claim conflicts for this circle.' },
      },
    },
    {
      id:        'resolveClaim', group: 'admin',
      verb:      'reassign',
      appliesTo: { type: 'task' },
      params: [
        { name: 'taskId',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'decision', kind: 'enum', of: ['yours', 'theirs', 'both'], required: true },
      ],
      surfaces: {
        chat: { hint: 'Resolve a double-claim conflict (yours/theirs/both) — admin/coordinator only.' },
      },
    },
    /*
     * .2 (2026-05-20) — surfaces the reviewer queue on
     * `apps/tasks-v0/web/review.html`.  Same pattern as
     * `listClaimable` / `listMyMasteredTasks`: read-only list op,
     * no `surfaces.ui` (list ops are an implicit data source per
     * renderWeb's rule b — not a button). Pre-B.2.2 review.html
     * called this skill directly (off-manifest); pulling it into
     * the manifest restores the invariant that every list
     * skill the web renders is declared here.  Skill lives in
     * `src/skills/workspace.js` (registered via buildWorkspaceSkills).
     */
    {
      id:        'listAwaitingApproval', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List items in the submitted state (awaiting approval).' },
      },
    },
    /*
     * .1 (2026-05-20) — added to surface the "I'm master of"
     * data source on the `mastered` view (mine.html's middle section).
     * Pre-B.2.1 mine.html called this skill directly (off-manifest);
     * pulling it into the manifest restores the invariant that
     * every list-skill the web/mobile renders is declared here.
     *
     * No `surfaces.ui` (list ops don't surface as buttons — they are
     * the implicit data source per renderWeb's rule b). The chat
     * hint mirrors the JSDoc on workspace.js's defineSkill body.
     */
    {
      id:        'listMyMasteredTasks', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List open tasks where the caller is the master.' },
      },
    },
    {
      // The pending-claims approvals list — data source for the `pending-claims` view. Rows carry
      // `status:'pending-confirmation'`, so the confirmClaim button surfaces on each (its appliesTo).
      id:        'listMyPendingClaims', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List tasks I master whose claim is awaiting my confirmation.' },
      },
    },
    /*
     * .3 (2026-05-20) — inbox notifications surfaced on
     * `apps/tasks-v0/web/inbox.html`.  Per-user feed of cross-app
     * notifications stored at `mem://user/inbox/<id>.json` (Phase 6
     * `InAppInboxBridge`); skill lives in `src/skills/inbox.js`.
     *
     * Phase-1 scope (this slice): the three ops needed to render +
     * dismiss notifications.  Deferred to B.2.3b (per-event-kind
     * dispatch + global "clear all" CTA):
     *
     *   - `approveSubtaskRequest`   — admin/coordinator approve a
     *                                 sub-task-request notification.
     *   - `declineSubtaskRequest`   — admin/coordinator decline (with
     *                                 optional note).
     *   - `approveSubtaskProposal`  — parent assignee approve a
     *                                 sub-task-proposal notification.
     *   - `declineSubtaskProposal`  — parent assignee decline (with
     *                                 optional note).
     *   - `clearInbox`              — bulk-delete header CTA.  Awaits a
     *                                 manifest pattern for "section-
     *                                 level non-creative action" (V0
     *                                 only models per-row + global
     *                                 placements; an app-shell global
     *                                 op is wrong here because the CTA
     *                                 belongs ON the section).
     */
    {
      id:        'listMyInbox', group: 'data',
      verb:      'list',
      appliesTo: { type: 'inbox-item' },
      params: [
        { name: 'limit', kind: 'number' },
        { name: 'since', kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'List inbox notifications, newest first.' },
      },
    },
    {
      id:        'clearInboxItem',
      verb:      'remove',
      appliesTo: { type: 'inbox-item' },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Delete one inbox notification by id.' },
        ui:   { control: 'button', label: 'Dismiss' },
      },
    },

    /*
     * .3b (2026-05-21) — the four subtask approve/decline
     * ops + the section-level clearInbox CTA.  Deferred from B.2.3
     * phase 1; landed now that substrate provides:
     *
     *   - **Per-kind dispatch** — `appliesTo: { type: 'inbox-item',
     *     kind: 'subtask-request' }` gates per-row buttons by event
     *     kind (generic field gating).
     *   - **Section-scope CTAs** — `surfaces.ui.placement:
     *     'section-header'` surfaces the bulk-clear CTA in
     *     `section.sectionActions[]`, not crammed into
     *     per-item itemActions[] or app-shell globals[].
     *
     * The four subtask ops have `appliesTo.kind` so they ONLY
     * surface on matching events.  inbox.html iterates
     * `section.itemActions[]` filtered by `itemMatchesAppliesTo`
     * against the per-event `kind` extracted from
     * `event.source.meta.kind` (page-level normaliser; substrate-
     * side flattening to a top-level `kind` field is a future
     * slice).
     */
    {
      id:        'approveSubtaskRequest',
      verb:      'approve',
      appliesTo: { type: 'inbox-item', kind: 'subtask-request' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/approve-subtask-request' },
        chat: { hint: 'Approve a queued sub-task request (admin/coordinator only).' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
    {
      id:        'declineSubtaskRequest',
      verb:      'reject',
      appliesTo: { type: 'inbox-item', kind: 'subtask-request' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note',      kind: 'string' },               // optional reason
      ],
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/decline-subtask-request', body: 'flags' },
        chat: { hint: 'Decline a queued sub-task request (admin/coordinator only).' },
        ui:   { control: 'button', label: 'Decline' },
      },
    },
    {
      id:        'approveSubtaskProposal',
      verb:      'approve',
      appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' },
      params: [
        { name: 'proposalId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/approve-subtask-proposal' },
        chat: { hint: 'Approve a sub-task proposal (parent assignee; rolls submission back to claimed).' },
        ui:   { control: 'button', label: 'Accept' },
      },
    },
    {
      id:        'declineSubtaskProposal',
      verb:      'reject',
      appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' },
      params: [
        { name: 'proposalId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note',       kind: 'string' },              // optional reason
      ],
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/decline-subtask-proposal', body: 'flags' },
        chat: { hint: 'Decline a sub-task proposal (parent assignee; reason shown to proposer).' },
        ui:   { control: 'button', label: 'Decline' },
      },
    },
    {
      id:        'clearInbox',
      verb:      'remove',
      appliesTo: { type: 'inbox-item' },          // matches every event in the section
      params: [
        { name: 'olderThanMs', kind: 'number' },  // optional age cutoff
      ],
      surfaces: {
        chat: { hint: 'Bulk-delete inbox notifications (optionally older than a cutoff).' },
        // section-level CTA. Renders in
        // `section.sectionActions[]`, NOT in per-row itemActions[]
        // or app-shell globals[].
        ui:   {
          control:   'button',
          label:     'Clear all',
          placement: 'section-header',
          // adoption (2026-05-20) — Tier C consent gate.
          // Bulk-clearing the inbox is recoverable (notifications
          // are re-fetchable from sources) but disruptive enough to
          // confirm.  Severity 'warn' → adapter shows a confirm
          // modal with yellow styling.
          confirm:   {
            severity: 'warn',
            message:  'Clear all inbox notifications?  Cannot be undone for this device.',
          },
        },
      },
    },

    /*
     * DAG-tree projection of the task graph.
     *
     * Verb is the app-local `tree` (not in the canonical VERBS allow-
     * list; validator permits app-specific verbs as long as the field
     * is a non-empty string).  `rootId` is optional: when omitted the
     * skill returns `{trees: [...]}` (one tree per top-level task);
     * when given, `{tree: {...}}` for that subtree.
     *
     * Read-only structural query — no `surfaces.slash` (no slash
     * grammar wired); `surfaces.chat.hint` lets the LLM tool-call it.
     * The web `dag.html` page consumes this through the NavModel's
     * `dag` view (no per-item buttons in V0 — itemActions[] is empty).
     */
    {
      id:        'getDagTree', group: 'data',
      verb:      'tree',
      appliesTo: { type: 'task' },
      params: [
        { name: 'rootId', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'Return the sub-task tree rooted at rootId, or every top-level tree.' },
      },
    },

    /*
     * adoption (2026-05-21) — circle lifecycle ops.
     *
     * `archiveCircle` hides a circle from active workflows but does NOT
     * delete items.  Reversible via `unarchiveCircle`.  Admin-only —
     * the skill enforces the role check; the manifest declares the
     * affordance + severity hint.
     *
     * No `appliesTo` — these are circle-scoped, not per-item.  No
     * view surfaces them today (the circle dashboard is hand-coded);
     * future slices can wire a `circles` view that surfaces them.
     * Chat surface lets the chat agent dispatch them by name.
     */
    {
      id:        'archiveCircle',
      verb:      'archive',
      // Part G (2026-06-17) — the mock declared a `confirm` flag; realAgent's
      // two-step gate reads `args.confirm`. Additive (real had no params).
      params:    [
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      // 'circle' itemType is the natural scope for circle-lifecycle ops.
      // Circles aren't surfaced by any view today (the circle dashboard
      // is hand-coded); appliesTo keeps the op off task-level inline
      // keyboards while letting chat agents address it by name.
      appliesTo: { type: 'circle' },
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/archive-circle', body: 'flags' },
        chat: { reply: 'text', hint: 'Archive this circle — admin only. Hides it from active workflows; items are kept.' },
        ui: {
          control: 'button',
          label:   'Archive circle',
          confirm: {
            severity: 'warn',
            message:  'Archive this circle?  Items are kept; new tasks are blocked until you unarchive.',
          },
        },
      },
    },
    {
      id:        'unarchiveCircle',
      verb:      'unarchive',
      params:    [],
      appliesTo: { type: 'circle' },
      surfaces: {
        // Part G (2026-06-17) — slash folded in from mockTasksManifest.
        slash: { command: '/unarchive-circle' },
        chat: { reply: 'text', hint: 'Unarchive this circle — admin only.  Resumes new-task creation.' },
        // No confirm — unarchive is the undo path; low-barrier reversal.
        ui:   { control: 'button', label: 'Unarchive circle' },
      },
    },

    /* ── Chat-shell ops (Part G dissolve, 2026-06-17) ───────────────────
     * Folded in from basis's former `mockTasksManifest`.  These are
     * the circle/chat-shell surface for the REAL tasks-v0 circle skills
     * (handlers via createBrowserMultiCircleTasksAgent / realAgent).  Each
     * declares `surfaces.slash` (+ a Part-C gate `match` where the op has a
     * casual NL phrasing), so the circle LLM + the deterministic gate read
     * them straight from this one manifest.  Params speak the REAL skill's
     * vocab (no shell-side rewrite). */

    /**
     * patch body fields on an existing task.
     * Wraps the substrate editTask skill which delegates to
     * itemStore.update with the forbidden-field gate.  Row button shows
     * on open OR claimed tasks (post-completion edits are out of scope).
     */
    {
      id:    'editTask', verb: 'edit',
      appliesTo: { type: 'task', state: ['open', 'claimed'] },
      // DECLARATION LAYER (#34) — an edit to the task's `text` (body content) resolves under the CONTENT policy
      // (LWW-register): the latest edit survives. Same `task` type as claimTask, different field, different
      // policy — which is exactly why the registry is keyed by (item-type, field). Delivery: best-effort.
      resolves: [{ field: 'text', policy: 'content' }],
      params: [
        { name: 'id',               kind: 'string',  required: true,
          pickerSource: { listOp: 'listMine' } },
        { name: 'text',             kind: 'string',  required: false },
        { name: 'notes',            kind: 'string',  required: false },
        { name: 'dueAt',            kind: 'string',  required: false },
        { name: 'requiredSkills',   kind: 'string',  required: false },
        { name: 'scheduledAt',      kind: 'string',  required: false },
        { name: 'estimateMinutes',  kind: 'number',  required: false },
        { name: 'definitionOfDone', kind: 'string',  required: false },
        { name: 'visibility',       kind: 'string',  required: false },
      ],
      surfaces: {
        slash: { command: '/edit-task', body: 'flags' },
        ui:    { control: 'button', label: 'Edit' },
        chat:  { reply: 'text', hint: 'patch fields on an existing task' },
      },
    },
    /**
     * v0.7.cc — `/circle-new <name> --kind=<household|project|team|...>`.
     * Mirrors tasks-v0 V2's provisionMyCircle.  Returns a circle id +
     * suggested next ops (invite a member, add the first task).
     */
    {
      id:    'provisionMyCircle', group: 'admin', verb: 'add',
      params: [
        { name: 'name', kind: 'string', required: true },
        { name: 'kind', kind: 'enum',
          of: ['household', 'project', 'team', 'friends', 'maintenance'],
          required: false },
      ],
      surfaces: {
        slash: { command: '/circle-new', body: 'flags' },
        chat:  { reply: 'text', hint: 'provision a new circle' },
      },
    },
    /**
     * v0.7.cc — `/inbox` — list mentions / pending review items for the
     * current user.  Chat-shell op id; realAgent aliases myInbox→listMyInbox
     * (a product-semantic alias, not drift).
     */
    {
      id:    'myInbox', group: 'overview', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/inbox' },
        chat:  { reply: 'list', hint: 'list mentions + items needing my attention' },
      },
    },
    /**
     * (B7, 2026-05-24) — availability half-day grid. Wires
     * tasks-v0's per-member availability hints.
     */
    {
      id:    'getMyAvailability', group: 'overview', verb: 'list',
      params: [
        { name: 'week', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/availability', body: 'flags' },
        chat:  { reply: 'record', hint: 'show my availability grid for this week' },
      },
    },
    {
      id:    'setMyAvailability', group: 'compose', verb: 'submit',
      params: [
        { name: 'cellKey', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/set-availability' },
        chat:  { reply: 'text', hint: 'set one half-day cell (week|day|half|state)' },
      },
    },
    {
      id:    'setAvailabilityOptIn', group: 'compose', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/availability-opt-in' },
        chat:  { reply: 'text', hint: 'opt in/out of broadcasting availability hints' },
      },
    },
    /**
     * (B6, 2026-05-23) — auto-scheduling planner. Wires
     * suggestSchedule + acceptSchedule.  slotKey shape:
     * "taskId|slotStartMs|slotEndMs" — encoded into the row id so [Pick]
     * buttons dispatch all three args.
     */
    {
      id:    'suggestSchedule', group: 'data', verb: 'list',
      appliesTo: { type: 'schedule-slot' },
      params: [
        { name: 'lookahead-days', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/suggest-schedule', body: 'flags' },
        chat:  { reply: 'list', hint: 'suggest scheduling slots for my open tasks' },
      },
    },
    {
      id:    'acceptSchedule', verb: 'add',
      appliesTo: { type: 'schedule-slot' },
      params: [
        { name: 'slotKey', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/accept-schedule' },
        chat:  { reply: 'text', hint: 'accept a scheduling suggestion' },
        ui:    { control: 'button', label: 'Pick' },
      },
    },
    /**
     * (B5, 2026-05-23) — cross-circle dashboard. getMyCircles +
     * per-circle counters (open / overdue / mine / awaitingApproval).
     */
    {
      id:    'getMyCircles', group: 'data', verb: 'list',
      appliesTo: { type: 'circle' },
      params: [],
      surfaces: {
        slash: { command: '/circles' },
        chat:  { reply: 'list', hint: 'cross-circle dashboard with per-circle counters' },
      },
    },
    /**
     * J3 (cluster-verification journeys) — the flat cross-circle "all my
     * tasks" aggregate for the self-chat / central-agent view.  Where
     * getMyCircles returns per-circle COUNTS, this returns the actual
     * open task ITEMS assigned to the caller across every circle, each
     * row tagged with its `circleId` so the UI can deep-link.  Handler
     * lives in src/skills/dashboard.js (registered via wireSkills like
     * getMyCircles).
     */
    {
      id:    'listMyTasksAcrossCircles', group: 'overview', verb: 'list',
      appliesTo: { type: 'task' },
      params: [],
      surfaces: {
        slash: { command: '/all-my-tasks' },
        chat:  { reply: 'list', hint: 'every open task assigned to me across all my circles' },
      },
    },
    /**
     * (B3, 2026-05-23) — circle admin surface. getCircleConfig +
     * pause/unpause (circleControls).  All accept a circleId; auto-injected
     * from opts.tasksCircleConfig.circleId by realAgent.
     */
    {
      id:    'getCircleConfig', group: 'admin', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/circle-info' },
        chat:  { reply: 'record', hint: 'show circle config (kind, paused/archived, counts)' },
      },
    },
    /**
     * 2026-05-24 — /circle-members = list reply with one clickable row per
     * member.  Derived from getCircleConfig (realAgent unpacks members[]).
     */
    {
      id:    'listCircleMembers', group: 'data', verb: 'list',
      appliesTo: { type: 'member' },
      params: [],
      surfaces: {
        slash: { command: '/circle-members' },
        chat:  { reply: 'list', hint: 'list members of your circle (with role)' },
      },
    },
    {
      id:    'pauseCircle', group: 'admin', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/pause-circle' },
        chat:  { reply: 'text', hint: 'pause the circle (no new tasks; existing tasks remain workable)' },
      },
    },
    {
      id:    'unpauseCircle', group: 'admin', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/unpause-circle' },
        chat:  { reply: 'text', hint: 'resume the circle after a pause' },
      },
    },
    /**
     * (A9, 2026-05-23) — circle invite + redeem. issueInvite /
     * redeemInvite.  /invite mints a single-use code; /redeem-invite
     * joins the circle that issued the token.
     */
    {
      id:    'issueInvite', group: 'admin', verb: 'add',
      params: [
        { name: 'role',      kind: 'enum',   of: ['member', 'admin'], required: false },
        { name: 'ttl-hours', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/invite', body: 'flags' },
        chat:  { reply: 'record', hint: 'mint a single-use circle invite (admin-only)' },
      },
    },
    {
      id:    'redeemInvite', group: 'admin', verb: 'add',
      params: [
        { name: 'invite',      kind: 'string', required: true },
        { name: 'displayName', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/redeem-invite', body: 'flags' },
        chat:  { reply: 'text', hint: 'join a circle using an invite token' },
      },
    },
    /**
     * slice (b) (2026-05-24) — sub-task wiring. The standalone
     * spawn/propose/force ops (the inbox-kind approve/decline pairs are
     * already modelled above on 'inbox-item').
     *   - addSubtask        — direct spawn (allowed up to depth 3)
     *   - proposeSubtask    — post-submit, needs assignee consent
     *   - forceSpawnSubtask — admin override w/ mandatory reason
     */
    {
      id:    'addSubtask', verb: 'add',
      // Also on a PENDING claim: the claimant may decompose optimistically (a provisional subtree, §2.5).
      appliesTo: { type: 'task', state: ['open', 'claimed', 'pending-confirmation'] },
      params: [
        { name: 'parentTaskId',     kind: 'string', required: true,
          pickerSource: { listOp: 'listMine' } },
        { name: 'text',             kind: 'string', required: true  },
        { name: 'notes',            kind: 'string', required: false },
        { name: 'dueAt',            kind: 'string', required: false },
        { name: 'requiredSkills',   kind: 'string', required: false },
        { name: 'definitionOfDone', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/add-subtask', body: 'flags' },
        ui:    { control: 'button', label: 'Add sub-task' },
        chat:  { reply: 'text', hint: 'spawn a child task under a parent' },
      },
    },
    {
      id:    'proposeSubtask', verb: 'add',
      appliesTo: { type: 'task', state: ['submitted'] },
      params: [
        { name: 'parentTaskId',     kind: 'string', required: true },
        { name: 'text',             kind: 'string', required: true  },
        { name: 'notes',            kind: 'string', required: false },
        { name: 'dueAt',            kind: 'string', required: false },
        { name: 'requiredSkills',   kind: 'string', required: false },
        { name: 'definitionOfDone', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/propose-subtask', body: 'flags' },
        ui:    { control: 'button', label: 'Propose sub-task' },
        chat:  { reply: 'text', hint: 'propose a sub-task on a submitted parent (needs assignee consent)' },
      },
    },
    {
      id:    'forceSpawnSubtask', group: 'compose', verb: 'add',
      // Admin-only escape hatch — no row button (admins use the slash).
      params: [
        { name: 'parentTaskId',     kind: 'string', required: true },
        { name: 'text',             kind: 'string', required: true  },
        { name: 'reason',           kind: 'string', required: true  },
        { name: 'notes',            kind: 'string', required: false },
        { name: 'dueAt',            kind: 'string', required: false },
        { name: 'requiredSkills',   kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/force-spawn-subtask', body: 'flags' },
        chat:  { reply: 'text', hint: 'admin override: spawn sub-task bypassing depth + post-submit gates' },
      },
    },
  ],

  views: [
    /*
     * `dataSource` declares the section's
     * data-fetch skill in the manifest.  Web + mobile adapters call
     * `fetchSectionItems(section, {callSkill})` which honours this
     * field; the previous adapter-side hard-coded "if section.id === …"
     * dispatch collapses.  Where omitted, the fallback would call
     * `listOpen({type, ...filter})` — for the `open` view that's
     * identical to the explicit declaration but we still spell it out
     * so the manifest is the single source of truth (every section
     * has a visible data source).
     */
    {
      id:         'open',
      title:      'Open',
      type:       'task',
      filter:     { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'task' } },
    },
    {
      id:         'mine',
      title:      'My work',
      type:       'task',
      dataSource: { skillId: 'listMine' },
    },
    /*
     * .1 (2026-05-20) — middle section of mine.html. Tasks
     * the caller is master of (lets them revoke, change approval
     * mode, spawn sub-tasks).  Data source: listMyMasteredTasks (V0
     * skill, manifest-declared). Pre- the page mapped view→skill
     * inline; lifts it into the manifest.
     */
    {
      id:         'mastered',
      title:      "I'm master of",
      type:       'task',
      dataSource: { skillId: 'listMyMasteredTasks' },
    },
    {
      // The approvals inbox for pending CLAIMS (explicit-confirm tasks awaiting my confirmation). Each row's
      // confirmClaim button comes from the op's appliesTo:['pending-confirmation'] — no per-row wiring here.
      id:         'pending-claims',
      title:      'Awaiting your confirmation',
      type:       'task',
      dataSource: { skillId: 'listMyPendingClaims' },
    },
    {
      id:         'claimable',
      title:      'Claimable',
      type:       'task',
      dataSource: { skillId: 'listClaimable' },
    },
    /*
     * .2 (2026-05-20) — the reviewer queue, consumed by
     * `apps/tasks-v0/web/review.html` through the NavModel
     * projector.  Data source: `listAwaitingApproval` (V0 skill,
     * manifest-declared in B.2.2).  The page applies an additional
     * client-side `isApprover` filter (per-task `approval` mode +
     * admin/coordinator role) on top of the skill's full submitted-
     * state list — same gate the pre-B.2.2 page applied.
     *
     * itemActions[] are projected from the manifest's surfaces.ui
     * ops on type='task' (approve / reject / revoke / etc.), gated
     * by F-SP3-a `appliesTo.state`; renderTasks then applies the
     * sufficient-condition role/approver checks before rendering
     * each button.
     */
    {
      id:         'review',
      title:      'Awaiting approval',
      type:       'task',
      dataSource: { skillId: 'listAwaitingApproval' },
    },
    /*
     * read-only DAG view consumed by
     * `apps/tasks-v0/web/dag.html` through the NavModel projector.
     * No `filter` (the dag skill walks the whole forest); no `sort`
     * (rendering preserves DAG order via `flattenDagTree`).
     * `dataSource` lifts the hard-coded `getDagTree` call out of
     * dag.html into the manifest.
     */
    {
      id:         'dag',
      title:      'DAG',
      type:       'task',
      dataSource: { skillId: 'getDagTree' },
    },
    /*
     * .3 (2026-05-20) — notification feed consumed by
     * `apps/tasks-v0/web/inbox.html` through the NavModel projector.
     * `type: 'inbox-item'` is an app-local (non-canonical) item-type
     * tag — see itemTypes comment above; the inbox is not a real
     * ItemStore, it lives at `mem://user/inbox/<id>.json` (cross-app,
     * per-user).  `dataSource.args.limit: 200` mirrors the pre-B.2.3
     * page's `callSkill('listMyInbox', {limit: 200})`.
     *
     * The page's per-row `clearInboxItem` button comes through
     * `section.itemActions[]`; the per-event-kind subtask
     * approve/decline buttons + the "Clear all" header CTA stay
     * off-manifest in V0 (deferred to B.2.3b — see the ops block
     * for the deferred list).
     */
    {
      id:         'inbox',
      title:      'Notifications',
      type:       'inbox-item',
      dataSource: { skillId: 'listMyInbox', args: { limit: 200 } },
    },
    /*
     * .4 (2026-05-20) — pod-settings view consumed by
     * `apps/tasks-v0/web/pod-settings.html`. Mirrors stoop's
     * adopt settings view (commit 9e7003b): the manifest models the
     * data shape (record + per-field patch declarations); the page
     * keeps its rich custom UI (pod-sign-in flow, conditional
     * groupPodUri row, localisation labels — auto-rendering would regress).
     *
     * (`shape: 'record'`) — `getCircleStoragePolicy` returns a
     * singleton `{policy, groupPodUri?}` object, NOT a list.
     * (`argsFromContext`) — `circleId` is a RUNTIME-derived arg
     * (URL `?circle=...`), not static; the page (or its host) supplies
     * `$circleId` via the fetch-section context.
     *
     * (`view.fields[]`) — declares the two editable fields
     * of the storage policy with their patch ops.  Both target
     * `setCircleStoragePolicy({circleId, storagePolicy, groupPodUri?})`
     * — a FLAT skill (no nested `{patch: {...}}` wrapper), so
     * `argWrapper` is NOT needed here (omitted).  Same flat shape
     * as stoop's `setHopMode({global})` field.
     *
     * `setCircleStoragePolicy` and `getCircleStoragePolicy` are NOT
     * declared in `operations[]` (same choice stoop made for
     * `getSettings`/`updateSettings`/`setHopMode`).  They are
     * pod-plumbing skills, not chat/slash-callable primary flows.
     * Non-strict `validateManifest` permits `dataSource.skillId` and
     * `field.patch.opId` to reference any string (-strict would
     * tighten this — opt-in only). The drift canary therefore
     * doesn't need to know about them.
     *
     * The page's pod-sign-in surface (`startPodSignIn`,
     * `completePodSignIn`, `signOutOfPod`, `podSignInStatus`,
     * `whoAmI`) is an interactive OIDC flow — explicitly OUT OF
     * SCOPE for B.2.4.  Modelling that as manifest ops would require
     * a redirect-flow primitive the substrate doesn't yet have.
     */
    {
      id:    'pod-settings',
      title: 'Pod settings',
      type:  'circle-storage-policy',
      shape: 'record',                              // singleton
      dataSource: {
        skillId:         'getCircleStoragePolicy',
        // `circleId` is runtime-derived (browser URL); the
        // page supplies it via the fetch-section context.  Omitted
        // when the host has no active circle (the skill itself replies
        // `{error: 'circleId required'}` in that case).
        argsFromContext: { circleId: '$circleId' },
      },
      // two representative editable fields of the storage
      // policy.  Both dispatch through `setCircleStoragePolicy` (one-way
      // upgrade; admin/coordinator gated server-side).
      fields: [
        {
          name:    'policy',
          type:    'enum',
          label:   'Storage form',
          // Mirrors the page's <select> options (no-pod intentionally
          // omitted — the skill rejects downgrade once a pod-having
          // policy is active).
          choices: ['shared', 'personal', 'hybrid'],
          // Flat patch — dispatch is
          // `setCircleStoragePolicy({circleId, storagePolicy: <value>})`.
          // No `argWrapper` (skill takes flat args, not `{patch: ...}`).
          patch:   { opId: 'setCircleStoragePolicy', argName: 'storagePolicy' },
        },
        {
          name:  'groupPodUri',
          type:  'string',
          label: 'Pod URI',
          // (adopted 2026-05-20) — conditional-display gate:
          // groupPodUri is only meaningful when policy ∈ {shared,
          // hybrid}.  Auto-rendered consumers hide the field for
          // policy='personal' (own pod, no group URI).  The
          // hand-coded page enforces the same rule via a separate
          // show/hide branch; the manifest now declares it once.
          // B.2.4 was the originating signal; closed the
          // substrate gap.
          requiresField: { policy: ['shared', 'hybrid'] },
          patch: { opId: 'setCircleStoragePolicy', argName: 'groupPodUri' },
        },
      ],
    },
  ],
};

export default tasksManifest;
