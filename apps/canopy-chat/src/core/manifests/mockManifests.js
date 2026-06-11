/**
 * canopy-chat — slash-routing manifests for tasks-v0 / stoop / folio.
 *
 * NOTE: the "mock" prefix is HISTORICAL.  Post slices 1 / 2b / 4 of the
 * integration plan (2026-05-23), the SKILL HANDLERS for these three
 * apps are REAL — composed in-process by `realAgent.js` via each app's
 * `src/browser.js` factory.  These manifests are the chat-shell's
 * slash-command DECLARATIONS for those real agents (the real per-app
 * manifests in `apps/<app>/manifest.js` deliberately omit
 * `surfaces.slash` — slash is a chat-shell concern).
 *
 * Why split out from `mockAgent.js` (2026-05-23, slice-4 polish):
 *   - Three manifests dominated the file (~365 of 612 lines).
 *   - The real mock LIVES in `mockAgent.js` — household-only
 *     (`mockHouseholdManifest` + `createMockHouseholdAgent` are still
 *     used as a lightweight fixture in `mockAgent.test.js`).
 *   - Co-locating the three slash-binding manifests here makes it
 *     obvious what they actually do + makes future renames easier.
 *
 * If you're adding a new chat slash command for tasks/stoop/folio,
 * declare it here.  If you're adding the IMPLEMENTATION, register a
 * handler in the relevant `apps/<app>/src/browser.js`.
 *
 * Future rename candidates (not done in this slice): `mockTasksManifest`
 * → `tasksSlashManifest`, etc.  Deferred — names are load-bearing
 * across imports + the rename adds churn without behavior change.
 */

/**
 * Mock tasks-v0 manifest (added 2026-05-23 — closes the gap where
 * tasks-v0 skills were wired on the host agent in v0.7.2 but no
 * slash commands were declared).  Real tasks-v0 has 20+ ops; the
 * subset surfaced here mirrors what canopy-chat's host agent
 * actually implements (addTask / listMine / claimTask /
 * completeTask / getTaskSnapshot / searchTasks / tasks_briefSummary).
 */
export const mockTasksManifest = {
  app:        'tasks-v0',
  itemTypes:  ['task', 'crew', 'schedule-slot', 'member', 'subtask-request', 'subtask-proposal'],
  operations: [
    {
      id:    'addTask', verb: 'add',
      params: [
        { name: 'text',          kind: 'string', required: true  },
        { name: 'assignee',      kind: 'string', required: false },
        { name: 'requiredSkill', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/addtask', body: 'flags',
          // F-SP2 (2026-06-11) — the deterministic NL gate (renderSlash/renderGate): "add X" routes
          // here without the LLM. `text-only` → the body is the task text; dropTrailing strips the
          // "… to/op the list" qualifier so "add milk to the list" → text "milk".
          match: {
            verbs:        ['add', 'todo', ['new', 'task'], 'voeg', 'zet', ['maak', 'taak'], ['nieuwe', 'taak']],
            body:         'text-only',
            dropTrailing: ['to', 'aan', 'op', 'toe'],
          } },
        chat:  { reply: 'text', hint: 'add a task' },
      },
    },
    {
      id:    'listMine', verb: 'list',
      appliesTo: { type: 'task' },
      params: [],
      surfaces: {
        slash: { command: '/mytasks' },
        chat:  {
          reply: 'list',
          hint:  'list open + claimed tasks',
          brief:  { summarySkill: 'briefSummary', order: 5, label: 'Tasks' },
          search: { searchSkill:  'searchTasks' },
        },
      },
    },
    {
      id:    'claimTask', verb: 'claim',
      appliesTo: { type: 'task', state: ['open'] },
      params: [{
        name: 'id', kind: 'string', required: true,
        // v0.7.Q34 — bare `/claim` → form shows clickable task list.
        pickerSource: { listOp: 'listMine' },
      }],
      surfaces: {
        slash: { command: '/claim',
          // NL gate — "claim X" / "I'll take X" / "ik pak X" → claimTask{id}. `arg:'id'` targets the
          // pickerSource param so the clarifying dispatch resolves the label → a real task id.
          match: {
            verbs: ['claim', 'pak', 'neem', ["i'll", 'take'], ["i'll", 'do'], ['ik', 'pak'], ['ik', 'doe'], ['ik', 'neem']],
            body:  'match',
            arg:   'id',
          } },
        ui:    { control: 'button', label: 'Claim' },
        chat:  { hint: 'compare-and-swap claim a task' },
      },
    },
    {
      id:    'completeTask', verb: 'complete',
      appliesTo: { type: 'task', state: ['claimed'] },
      params: [{
        name: 'id', kind: 'string', required: true,
        // v0.7.Q34 — bare `/complete-task` → form shows claimed tasks.
        pickerSource: { listOp: 'listMine' },
      }],
      surfaces: {
        slash: { command: '/complete-task',
          // NL gate — "done X" / "klaar met X" → completeTask{id}. Multiword phrases first so
          // "klaar met afwas" beats the bare "klaar". `arg:'id'` for the pickerSource resolution.
          match: {
            verbs: [['klaar', 'met'], ['done', 'with'], 'done', 'complete', 'completed', 'finished', 'klaar', 'voltooid', 'gedaan'],
            body:  'match',
            arg:   'id',
          } },
        ui:    { control: 'button', label: 'Mark complete' },
        chat:  { hint: 'mark a claimed task complete' },
      },
    },
    /**
     * #219 (2026-05-24) — patch body fields on an existing task.
     * Wraps the substrate editTask skill which delegates to
     * itemStore.update with the forbidden-field gate
     * (id/addedBy/completedAt/assignee/claimedAt/reviewLog/…).
     * Row button shows on open OR claimed tasks (post-completion
     * edits are out of scope — that would re-open).
     */
    {
      id:    'editTask', verb: 'edit',
      appliesTo: { type: 'task', state: ['open', 'claimed'] },
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
    {
      id:    'getTaskSnapshot', verb: 'list',
      appliesTo: { type: 'task' },
      params: [{ name: 'id', kind: 'string', required: true }],
      surfaces: {
        chat: { hint: 'snapshot a task for embedding' },
      },
    },
    /**
     * v0.7.cc — `/crew-new <name> --kind=<household|project|team|...>`.
     * Mirrors tasks-v0 V2's provisionMyCrew.  Returns a crew id +
     * suggested next ops (invite a member, add the first task).
     */
    {
      id:    'provisionMyCrew', verb: 'add',
      params: [
        { name: 'name', kind: 'string', required: true },
        { name: 'kind', kind: 'enum',
          of: ['household', 'project', 'team', 'friends', 'maintenance'],
          required: false },
      ],
      surfaces: {
        slash: { command: '/crew-new', body: 'flags' },
        chat:  { reply: 'text', hint: 'provision a new crew' },
      },
    },
    /**
     * v0.7.cc — `/submit <id> --note=<text>` — submit a claimed task
     * for DoD (definition-of-done) review by the crew approver.
     */
    {
      id:    'submitTask', verb: 'submit',
      appliesTo: { type: 'task', state: ['claimed'] },
      params: [
        { name: 'id',   kind: 'string', required: true,
          pickerSource: { listOp: 'listMine' } },
        { name: 'note', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/submit', body: 'flags',
          // Part C gate — "submit X" → submitTask{id}; id already has pickerSource:listMine.
          match: { verbs: ['submit', ['hand', 'in'], 'indienen', 'inleveren', ['ter', 'review']], body: 'match', arg: 'id' } },
        chat:  { reply: 'text', hint: 'submit a task for review (DoD gate)' },
        // #184 — appliesTo-gated row button: shows up on claimed tasks
        // in /mytasks lists.  Same auto-render path household uses for
        // [Mark done] (mockHouseholdManifest.markComplete).
        ui:    { control: 'button', label: 'Submit' },
      },
    },
    /**
     * v0.7.cc — `/approve <id>` — approver action on a submitted task.
     */
    {
      id:    'approveTask', verb: 'approve',
      appliesTo: { type: 'task', state: ['submitted'] },
      params: [{ name: 'id', kind: 'string', required: true,
        pickerSource: { listOp: 'listMine' } }],          // Part C — label→id resolution for the gate
      surfaces: {
        // Part C gate — bare 'accept' is calendar.rsvpAccept's (collision); approveTask keeps approve/goedkeuren/akkoord.
        slash: { command: '/approve',
          match: { verbs: ['approve', 'goedkeuren', 'akkoord'], body: 'match', arg: 'id' } },
        chat:  { reply: 'text', hint: 'approve a submitted task' },
        // #184 — appliesTo-gated row button on submitted tasks (approver view).
        ui:    { control: 'button', label: 'Approve' },
      },
    },
    /**
     * v0.7.cc — `/reject <id> --reason=<text>` — approver rejection;
     * task returns to claimed state.
     */
    {
      id:    'rejectTask', verb: 'reject',
      appliesTo: { type: 'task', state: ['submitted'] },
      params: [
        { name: 'id',     kind: 'string', required: true,
          pickerSource: { listOp: 'listMine' } },          // Part C — label→id resolution
        { name: 'reason', kind: 'string', required: false },
      ],
      surfaces: {
        // Part C gate — rejectTask owns reject/afwijzen (collision vs calendar.rsvpDecline, which keeps 'decline').
        slash: { command: '/reject', body: 'flags',
          match: { verbs: ['reject', 'afkeuren', 'afwijzen', 'weiger'], body: 'match', arg: 'id' } },
        chat:  { reply: 'text', hint: 'reject a submitted task' },
        // #184 — appliesTo-gated row button on submitted tasks (approver view).
        ui:    { control: 'button', label: 'Reject' },
      },
    },
    /**
     * v0.7.cc — `/inbox` — list mentions / pending review items for
     * the current user.  Mirrors tasks-v0's in-app inbox.
     */
    {
      id:    'myInbox', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/inbox' },
        chat:  { reply: 'list', hint: 'list mentions + items needing my attention' },
      },
    },
    /**
     * #195 (B7, 2026-05-24) — availability half-day grid.  Wires
     * tasks-v0's per-member availability hints (apps/tasks-v0/src/
     * skills/availability.js).  Coordinator-visible signal: each
     * member can mark a 7×2 grid of half-days (open / tight /
     * unavailable / unknown).  Opt-in per crew; opted-out members
     * show as `unknown` indistinguishable from non-opted.
     */
    {
      id:    'getMyAvailability', verb: 'list',
      params: [
        { name: 'week', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/availability', body: 'flags' },
        chat:  { reply: 'record', hint: 'show my availability grid for this week' },
      },
    },
    {
      id:    'setMyAvailability', verb: 'submit',
      params: [
        { name: 'cellKey', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/set-availability' },
        chat:  { reply: 'text', hint: 'set one half-day cell (week|day|half|state)' },
      },
    },
    {
      id:    'setAvailabilityOptIn', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/availability-opt-in' },
        chat:  { reply: 'text', hint: 'opt in/out of broadcasting availability hints' },
      },
    },
    /**
     * #193 (B6, 2026-05-23) — auto-scheduling planner.  Wires
     * suggestSchedule + acceptSchedule (apps/tasks-v0/src/skills/
     * planner.js:55,95).  Greedy slot suggestion per the design's
     * "reason chips" UX (functional-design-v2 § O).
     *   /suggest-schedule [--lookahead-days=7]  → list of top-3 slots
     *   /accept-schedule  <slotKey>             → schedules the slot
     *
     * slotKey shape: "taskId|slotStartMs|slotEndMs" — encoded into
     * the row id so [Pick] buttons dispatch all three args.
     */
    {
      id:    'suggestSchedule', verb: 'list',
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
     * #191 (B5, 2026-05-23) — cross-crew dashboard.  Wires
     * getMyCrews (apps/tasks-v0/src/skills/dashboard.js:40) +
     * aggregateCrews (per-crew counts: open / overdue / mine /
     * awaitingApproval).  Single-crew mode today shows one row;
     * multi-crew mode (when supported) shows all crews actor is in.
     */
    {
      id:    'getMyCrews', verb: 'list',
      appliesTo: { type: 'crew' },
      params: [],
      surfaces: {
        slash: { command: '/crews' },
        chat:  { reply: 'list', hint: 'cross-crew dashboard with per-crew counters' },
      },
    },
    /**
     * #190 (B3, 2026-05-23) — crew admin surface.  Real skills:
     *   - getCrewConfig (workspace.js:46) → live crew snapshot
     *   - pauseCrew / unpauseCrew (crewControls.js:43,56) → admin/coord
     *   - archiveCrew / unarchiveCrew (crewControls.js:69,82) → admin
     * All accept a crewId; auto-injected from opts.tasksCrewConfig.crewId.
     */
    {
      id:    'getCrewConfig', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/crew-info' },
        chat:  { reply: 'record', hint: 'show crew config (kind, paused/archived, counts)' },
      },
    },
    /**
     * 2026-05-24 bug-fix split — /crew-members was reading the SAME
     * getCrewConfig output as /crew-info, which JSON-stringified the
     * members array as an unreadable field.  Real /crew-members =
     * list reply with one clickable row per member.  Reads the
     * roster from getCrewConfig + adapter unpacks it.
     */
    {
      id:    'listCrewMembers', verb: 'list',
      appliesTo: { type: 'member' },
      params: [],
      surfaces: {
        slash: { command: '/crew-members' },
        chat:  { reply: 'list', hint: 'list members of your crew (with role)' },
      },
    },
    {
      id:    'pauseCrew', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/pause-crew' },
        chat:  { reply: 'text', hint: 'pause the crew (no new tasks; existing tasks remain workable)' },
      },
    },
    {
      id:    'unpauseCrew', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/unpause-crew' },
        chat:  { reply: 'text', hint: 'resume the crew after a pause' },
      },
    },
    {
      id:    'archiveCrew', verb: 'remove',
      params: [
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/archive-crew', body: 'flags' },
        chat:  { reply: 'text', hint: 'archive the crew (read-only ledger; reversible)' },
      },
    },
    {
      id:    'unarchiveCrew', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/unarchive-crew' },
        chat:  { reply: 'text', hint: 'reverse a crew archive' },
      },
    },
    /**
     * #187 (A9, 2026-05-23) — crew invite + redeem.  Real skills:
     *   - issueInvite ({crewId, ttlMs?, role?}) → {invite}
     *   - redeemInvite({invite, displayName?, webid?}) → {groupProof, ...}
     * (apps/tasks-v0/src/skills/multiCrewOnboarding.js:50,73)
     *
     * /invite [--role=member|admin] [--ttl-hours=24] → mints a single-
     * use code; chat-shell shows it to the inviter to share via DM/QR.
     * /redeem-invite <token> joins the crew that issued the token.
     */
    {
      id:    'issueInvite', verb: 'add',
      params: [
        { name: 'role',      kind: 'enum',   of: ['member', 'admin'], required: false },
        { name: 'ttl-hours', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/invite', body: 'flags' },
        chat:  { reply: 'record', hint: 'mint a single-use crew invite (admin-only)' },
      },
    },
    {
      id:    'redeemInvite', verb: 'add',
      params: [
        { name: 'invite',      kind: 'string', required: true },
        { name: 'displayName', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/redeem-invite', body: 'flags' },
        chat:  { reply: 'text', hint: 'join a crew using an invite token' },
      },
    },
    /**
     * #219 slice (b) (2026-05-24) — sub-task wiring.  All 7 substrate
     * skills from apps/tasks-v0/src/skills/subtasks.js exposed:
     *
     *   - addSubtask         — direct spawn (allowed up to depth 3)
     *   - approveSubtaskRequest / declineSubtaskRequest
     *                       — admin path for depth > 3 spawns
     *   - proposeSubtask     — post-submit, needs assignee consent
     *   - approveSubtaskProposal / declineSubtaskProposal
     *                       — assignee's accept/decline buttons
     *   - forceSpawnSubtask  — admin override w/ mandatory reason
     *
     * The accept/decline pairs use `appliesTo` so they only render as
     * row buttons on the right item type (subtask-request /
     * subtask-proposal), keeping the [Approve][Decline] UX scoped.
     */
    {
      id:    'addSubtask', verb: 'add',
      appliesTo: { type: 'task', state: ['open', 'claimed'] },
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
      id:    'approveSubtaskRequest', verb: 'approve',
      appliesTo: { type: 'subtask-request' },
      params: [{ name: 'requestId', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/approve-subtask-request' },
        ui:    { control: 'button', label: 'Approve' },
        chat:  { reply: 'text', hint: 'admin/coord approves a depth-gated sub-task request' },
      },
    },
    {
      id:    'declineSubtaskRequest', verb: 'reject',
      appliesTo: { type: 'subtask-request' },
      params: [
        { name: 'requestId', kind: 'string', required: true },
        { name: 'note',      kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/decline-subtask-request', body: 'flags' },
        ui:    { control: 'button', label: 'Decline' },
        chat:  { reply: 'text', hint: 'admin/coord declines a depth-gated sub-task request' },
      },
    },
    {
      id:    'approveSubtaskProposal', verb: 'approve',
      appliesTo: { type: 'subtask-proposal' },
      params: [{ name: 'proposalId', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/approve-subtask-proposal' },
        ui:    { control: 'button', label: 'Accept' },
        chat:  { reply: 'text', hint: 'parent assignee accepts the sub-task scope change' },
      },
    },
    {
      id:    'declineSubtaskProposal', verb: 'reject',
      appliesTo: { type: 'subtask-proposal' },
      params: [
        { name: 'proposalId', kind: 'string', required: true },
        { name: 'note',       kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/decline-subtask-proposal', body: 'flags' },
        ui:    { control: 'button', label: 'Decline' },
        chat:  { reply: 'text', hint: 'parent assignee declines the sub-task scope change' },
      },
    },
    {
      id:    'forceSpawnSubtask', verb: 'add',
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
  views: [{ id: 'open', title: 'Open tasks', type: 'task' }],
};

// Q29 declaration: claimTask is the lifecycle entry-point that gets
// embedded (clicking [Claim] from an embed-card claims the task).
mockTasksManifest.operations.find((o) => o.id === 'claimTask')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getTaskSnapshot' };

/**
 * Mock stoop manifest (v0.4 cross-app demo).  Three browser-doable ops
 * with a slash-name collision-induction (`/post` is stoop-only, `/done`
 * collides with household for v0.4 prefix-on-collision demonstration —
 * not actually colliding here since opIds differ, but shows multi-app
 * UX in /help).
 */
export const mockStoopManifest = {
  app:        'stoop',
  // 2026-05-27 slash audit close-out — `lend` + `report` added for the
  // new audit-close-out ops (`assignLend` appliesTo:'lend', `reportPost`
  // appliesTo:'report').  Mirrors the real stoopManifest's itemTypes
  // (subset — the mock only needs the types its declared ops reference).
  itemTypes:  ['post', 'contact', 'member', 'lend', 'report'],
  operations: [
    {
      id:    'listFeed', verb: 'list', params: [],
      surfaces: {
        slash: { command: '/feed' },
        chat:  { reply: 'list', hint: "list your buurt's feed" },
      },
    },
    {
      id:    'postRequest', verb: 'add',
      // C6 (real-device 2026-05-27) — accept --kind=ask|borrow|share|report|event
      // alongside the body text.  Substrate already understands `kind`
      // (see apps/stoop/src/skills/index.js postRequest skill — it
      // routes to canonicalDraft via intentToCanonicalDraft).  Prior
      // shape was `body: 'match'` so any `--kind=ask` ended up glued
      // into the post text instead of becoming a flag.
      params: [
        { name: 'text', kind: 'string', required: true },
        { name: 'kind', kind: 'string', required: false, enum: ['ask', 'borrow', 'share', 'report', 'event'] },
      ],
      surfaces: {
        // Part C gate — "post/ask/borrow X" → postRequest{text}. Bare 'share'/'deel' belong to
        // folio.shareFolder (collision); the post `kind` flag stays slash/LLM-only.
        slash: { command: '/post', body: 'flags',
          match: { verbs: ['post', 'ask', 'borrow', 'vraag', 'plaats', 'leen', ['bied', 'aan']], body: 'text-only', dropTrailing: ['to', 'aan', 'op', 'in', 'voor'] } },
        chat:  {
          reply: 'text', hint: 'post a skill-request to your buurt',
          followUps: [
            // Q31 demo — same-app follow-up: after posting, suggest viewing.
            { opId: 'listFeed' },
          ],
        },
      },
    },
    /**
     * v0.7.cc — `/stoop-profile` — stoop's per-buurt profile (handle +
     * displayName + reveals).  Mirrors DEMO.md §2.
     */
    {
      id:    'getStoopProfile', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/stoop-profile' },
        chat:  { reply: 'record', hint: 'show your stoop profile (handle + reveals)' },
      },
    },
    /**
     * v0.7.cc — `/reveal <peer> <on|off>` — flip the local Reveal
     * setting for a peer (DEMO.md §2 connection accept).  Bilateral —
     * the peer must also flip on their side for full reveal.
     */
    {
      id:    'revealPeer', verb: 'add',
      params: [
        { name: 'peer',   kind: 'string', required: true },
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
      ],
      surfaces: {
        slash: { command: '/reveal', body: 'flags' },
        chat:  { reply: 'text', hint: 'reveal (or hide) a peer\'s real name' },
      },
    },
    /**
     * #179 (2026-05-23) — `respondToItem` — offer help on an open
     * stoop post (the "Help with" / "Ik help" UX from the design doc).
     * Real skill at apps/stoop/src/skills/index.js:1987.  Opens a
     * private DM thread between requester + responder; first body
     * becomes the thread's first message.
     *
     * No slash command — the natural surface is the [Help with]
     * button on each post row in /feed.  Typing post-id is friction
     * (per the existing-slash-surface audit, /help-with → R→B).
     */
    {
      id:    'respondToItem', verb: 'claim',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
        // 2026-05-24 — body is required by the substrate; mark it
        // required here so [Help with] click triggers form-elicitation
        // ("what help are you offering?") instead of dispatching with
        // missing arg + getting 'body required' from the substrate.
        { name: 'body',   kind: 'string', required: true },
      ],
      surfaces: {
        // Part C gate — "help with X" / "ik help X" → respondToItem{itemId}; PARTIAL gate (binds
        // itemId by label; `body` "what help?" is then form-elicited as today).
        slash: { match: { verbs: [['help', 'with'], ['respond', 'to'], 'offer', ['ik', 'help'], ['help', 'met'], ['reageer', 'op'], ['bied', 'hulp']], body: 'match', arg: 'itemId' } },
        chat: { reply: 'text', hint: 'offer help on a request' },
        // appliesTo-gated row button on /feed posts.  Click → form
        // prompts for body, then dispatches.  Future Slice: spawn a
        // DM thread instead of the inline form (per post>reply>chat
        // flow noted 2026-05-24).
        ui:   { control: 'button', label: 'Help with' },
      },
    },
    /**
     * #179 (2026-05-23) — `markReturned` — close a "lend" post after
     * the borrower returns the item.  Real skill at
     * apps/stoop/src/skills/index.js:843.  Author-only.
     *
     * 2026-05-27 audit close-out — `/lend-return` slash declaration
     * mirrored from `apps/stoop/manifest.js` (real D.1 stoop).  Body
     * `match` with EN/NL verbs binds `_match` → first required param
     * (`itemId`); the realAgent adapter aliases `itemId → requestId`
     * for the substrate skill.
     */
    {
      id:    'markReturned', verb: 'complete',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
      ],
      surfaces: {
        chat: { reply: 'text', hint: 'Mark a lend item as returned; cancels its return reminder.' },
        // Part C — FIX: bind the body to `itemId` (was the default `match`, which dropped the label).
        slash: {
          command: '/lend-return',
          match: {
            verbs:   ['returned', 'teruggebracht', 'terug', ['mark', 'returned']],
            body:    'match',
            arg:     'itemId',
            onEmpty: { skillId: 'markReturned', args: {} },
          },
        },
        ui:   { control: 'button', label: 'Teruggebracht' },
      },
    },
    /**
     * Slice 6d (2026-05-24) — per-row [DM] button on contact + member
     * rows.  No substrate dispatch — onButtonTap intercepts and routes
     * to ensureDmThread.  Alias-as-button-only of canopy-chat's
     * `startDm` op (so the validator's appliesTo gate stays in stoop's
     * manifest where 'contact'/'member' itemTypes are declared).
     */
    {
      id:    'startDm',
      verb:  'add',
      appliesTo: { type: ['contact', 'member'] },
      params: [{ name: 'webid', kind: 'string', required: true }],
      surfaces: {
        chat: { reply: 'text', hint: 'open a DM with this peer' },
        ui:   { control: 'button', label: 'DM' },
      },
    },
    /**
     * #185 (A6, 2026-05-23) — `/holiday-mode <on|off>` — toggle the
     * calling actor's holiday-mode flag (Phase 23.4 in stoop).  When
     * on: notifications suppressed, skills marked unavailable, no
     * skill-match hints.  Allows a temporary pause without leaving
     * the buurt.  Real skills:
     *   - setHolidayMode (apps/stoop/src/skills/index.js:1043)
     *   - getHolidayMode (apps/stoop/src/skills/index.js:1058)
     * Bare `/holiday-mode` reads current state.
     */
    {
      id:    'setHolidayMode', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/holiday-mode' },
        chat:  { reply: 'text', hint: 'toggle holiday mode on/off' },
      },
    },
    {
      id:    'getHolidayMode', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/holiday-status' },
        chat:  { reply: 'record', hint: 'show current holiday-mode state' },
      },
    },
    /**
     * #186 (A4, 2026-05-23) — ContactBook surface.  Stoop's contact
     * graph (apps/stoop/src/lib/ContactBook.js + skills 2701-2783) had
     * zero chat-shell affordance before today.  Wired:
     *   /contacts [--min-trust=known|trusted] [--tag=X]    → list
     *   /add-contact <webid> [--name=X]                    → add
     *   /remove-contact <webid>                            → remove
     *   /contact-trust <webid> <known|trusted|none>        → set trust
     * Chat-shell enums are English (EN-first locale rule).  The
     * underlying stoop skill still persists Dutch labels ("bekend",
     * "vertrouwd") — the realAgent.js adapter translates at the
     * boundary.  Locale entries in en/nl.json:contacts.trust render
     * the labels per user language.  In-chat row buttons planned for
     * the contacts list (R→B replacements for /mute, /unmute, /reveal
     * per existing-slash-surface-audit) once the contact-card panel
     * lands.
     */
    {
      id:    'listContacts', verb: 'list',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'min-trust', kind: 'enum', of: ['known', 'trusted'], required: false },
        { name: 'tag',       kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/contacts', body: 'flags' },
        chat:  { reply: 'list', hint: 'list your contacts' },
      },
    },
    {
      id:    'addContact', verb: 'add',
      params: [
        { name: 'webid', kind: 'webid',  required: true },
        { name: 'name',  kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/add-contact', body: 'flags' },
        chat:  { reply: 'text', hint: 'add a 1:1 contact' },
      },
    },
    {
      id:    'removeContact', verb: 'remove',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
      ],
      surfaces: {
        slash: { command: '/remove-contact' },
        chat:  { reply: 'text', hint: 'remove a contact' },
        ui:    { control: 'button', label: 'Remove' },
      },
    },
    {
      id:    'setContactTrust', verb: 'submit',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
        { name: 'level', kind: 'enum', of: ['known', 'trusted', 'none'], required: true },
      ],
      surfaces: {
        slash: { command: '/contact-trust', body: 'flags' },
        chat:  { reply: 'text', hint: 'set a contact\'s trust level' },
      },
    },
    /**
     * #198 (C3-C6, 2026-05-24) — remaining Cluster C wizards.  All
     * use #180 customRenderer; per-wizard renderer files under
     * src/web/wizards/.
     */
    {
      id:    'restoreFromMnemonicWizard',
      verb:  'submit',
      params: [],
      surfaces: {
        slash: { command: '/restore-from-mnemonic' },
        chat:  { hint: 'recover from a saved mnemonic phrase (DESTRUCTIVE)' },
        page:  { kind: 'side-panel', title: 'Restore identity' },
      },
    },
    {
      id:    'conflictDisputeWizard',
      verb:  'add',
      // #200 — per-bubble action on stoop posts.  Slash kept for
      // general-dispute (no postId) + LLM tool-call surface.
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'postId', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/dispute', body: 'flags' },
        chat:  { hint: 'raise a conflict-resolution dispute in your buurt' },
        page:  { kind: 'side-panel', title: 'Raise a dispute' },
        ui:    { control: 'button', label: 'Dispute' },
      },
    },
    {
      id:    'postAudienceWizard',
      verb:  'add',
      params: [
        { name: 'text', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/post-audience', body: 'flags' },
        chat:  { hint: 'post with audience targeting (trust + tags + distance)' },
        page:  { kind: 'side-panel', title: 'Post with audience' },
      },
    },
    {
      id:    'encryptedBackupWizard',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/encrypted-backup' },
        chat:  { hint: 'download a passphrase-encrypted snapshot of your data' },
        page:  { kind: 'side-panel', title: 'Encrypted backup' },
      },
    },
    /**
     * #197 (C1, 2026-05-24) — biggest Cluster C wizard.  Surfaces
     * createGroupV2 across 5 sections (identity, governance, rules,
     * tech, review).  Membership-code reveal on success — show ONCE,
     * user must copy or it's lost (per stoop design).
     */
    {
      id:    'createGroupWizard',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/create-group' },
        chat:  { hint: 'create a new buurt: 5-step wizard' },
        page:  { kind: 'side-panel', title: 'Create buurt' },
      },
    },
    /**
     * #196 (C2, 2026-05-24) — first Cluster C wizard.  Opens a 3-step
     * panel: rules disclosure → privacy notice → handle pick → submits
     * chained redeemInviteWithGate + setMyHandle + redeemInvite.
     * Slash arg: invite URL ('stoop-invite://...').
     */
    {
      id:    'joinGroupWizard',
      verb:  'add',
      params: [
        { name: 'invite', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/join-group' },
        chat:  { hint: 'join a buurt: open the 3-step rules-gate wizard' },
        page:  { kind: 'side-panel', title: 'Join buurt' },
      },
    },
    /**
     * #189 (B1+B2, 2026-05-23) — buurt/group surface.  V0: single-
     * buurt info per agent instance (the chat-shell currently runs
     * one stoop agent in one buurt; true multi-buurt requires
     * multi-agent topology — separate slice).  Surfaces existing
     * stoop skills:
     *   /groups        → current buurt info + member count
     *   /group-members → members of current buurt
     *   /group-rules   → latest rules.md for current buurt
     *   /leave-group   → with Q27 confirm
     */
    {
      id:    'getCurrentGroup', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/groups' },
        chat:  { reply: 'record', hint: 'show your current buurt' },
      },
    },
    {
      id:    'listGroupMembers', verb: 'list',
      appliesTo: { type: 'member' },
      params: [],
      surfaces: {
        slash: { command: '/group-members' },
        chat:  { reply: 'list', hint: 'list members of your buurt' },
      },
    },
    {
      id:    'getGroupRules', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/group-rules' },
        chat:  { reply: 'record', hint: 'show your buurt\'s rules' },
      },
    },
    {
      id:    'leaveGroup', verb: 'remove',
      params: [
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/leave-group', body: 'flags' },
        chat:  { reply: 'text', hint: 'leave your buurt (irreversible — asks to confirm)' },
      },
    },
    /**
     * #188 (A8, 2026-05-23) — share-my-contact via QR payload.
     * Real skill at apps/stoop/src/skills/index.js:2247.  V0 returns
     * the stoop-contact:// URL; user pastes into any QR generator.
     * Canvas-rendered QR image is a follow-up.
     */
    {
      id:    'getContactShareQr', verb: 'list',
      params: [
        { name: 'trust', kind: 'enum', of: ['known', 'trusted'], required: false },
      ],
      surfaces: {
        slash: { command: '/share-my-contact', body: 'flags' },
        chat:  { reply: 'record', hint: 'show your contact-share payload (paste into a QR generator)' },
      },
    },
    /* ─────── 2026-05-27 slash-audit close-out (7 long-tail ops) ───────
     * The seven ops below mirror their `apps/stoop/manifest.js` (real
     * D.1 stoop) shape — verbs, body, params, hints, appliesTo.  No
     * substrate handlers needed: declarations alone make
     * `bundle.callSkill('stoop', '<id>', args)` route past the catalog
     * check for chat-shell-only demos.  Real skill execution always
     * goes through realAgent.js (which composes the live stoop agent). */
    /**
     * `/lend-assign <itemId> <borrower-webid>` — two-arg positional
     * slash → ALWAYS needsForm (no `match` block).  Shell-only by
     * design: the consumer's composer surfaces the form/picker UI
     * because slash bodies are line-oriented and can't bind two
     * positional args.  Same shape household.markComplete uses for
     * row-button-only ops.
     */
    {
      id:        'assignLend', verb: 'reassign',
      appliesTo: { type: 'lend' },
      params: [
        { name: 'itemId',        kind: 'string', required: true },
        { name: 'borrowerWebid', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: 'Assign a lent item to a borrower without closing it.' },
        slash: {
          command: '/lend-assign',
          shape:   '/lend-assign <itemId> <borrower-webid>',
        },
      },
    },
    {
      id:        'setMySkills', verb: 'set',
      params: [
        { name: 'skills', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: "Replace the calling actor's skills array." },
        slash: {
          command: '/skills',
          shape:   '/skills <json-array-of-skill-entries>',
        },
      },
    },
    {
      id:    'getItemTree', verb: 'tree',
      params: [
        { name: 'itemId', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: "Walk an item's embeds/deps tree, materialising cross-pod refs (Phase 3.3c decentralised read path)." },
        // Part C — removed the gate `match` (a debug tree-walk, not an NL user command; the
        // body:'match' also dropped the label since the param is itemId). Literal /tree stays.
        slash: { command: '/tree' },
      },
    },
    /**
     * Q27 confirm-gated session op — `surfaces.ui.confirm.severity:
     * 'warn'` triggers a `needsConfirm` envelope from resolveDispatch
     * BEFORE the substrate runs.  Same pattern household.removeChore
     * uses.
     */
    {
      id:    'signOutOfPod', verb: 'remove',
      params: [],
      surfaces: {
        chat:  { hint: 'Sign out of the current Solid pod session.  Mid-sync state may be dropped; the user can sign back in any time.' },
        // Part C — removed the gate `match`: body:'reject' is NOT a valid renderSlash body kind
        // (would throw), and sign-out is a session op, not an NL one-liner. Literal /sign-out + the
        // confirm-gated button stay.
        slash: { command: '/sign-out' },
        ui: {
          control: 'button',
          label:   'Uitloggen',
          confirm: {
            severity: 'warn',
            message:  'Uitloggen van je pod?  Lopende synchronisatie wordt afgebroken.',
          },
        },
      },
    },
    {
      id:        'reportPost', verb: 'report',
      appliesTo: { type: 'report' },
      params: [
        { name: 'itemId', kind: 'string', required: true,
          pickerSource: { listOp: 'listFeed' } },          // Part C — label→id resolution
        { name: 'reason', kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'File a report on another item; visible to admins of the group.' },
        // Part C — FIX: bind the body to `itemId` (was the default `match`); `reason` stays optional.
        slash: {
          command: '/report',
          match: {
            verbs:   ['report', 'rapporteer', 'flag'],
            body:    'match',
            arg:     'itemId',
            onEmpty: { skillId: 'reportPost', args: {} },
          },
        },
        ui: { control: 'button', label: 'Rapporteer' },
      },
    },
    {
      id:    'listOpen', verb: 'list',
      params: [
        { name: 'intent', kind: 'enum', of: ['ask', 'offer', 'lend'] },
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  { hint: 'List open requests; optional `skill` + `intent` filters.' },
        // Part C — removed the gate `match`: body:'type-only' mapped against a nonexistent `type`
        // param (this op's enum is `intent`) with no typeAliases declared — mis-wired. List op,
        // slash/screen only. Literal /bulletin stays.
        slash: {
          command: '/bulletin',
          shape:   '/bulletin [ask|offer|lend]',
        },
      },
    },
  ],
  views: [
    { id: 'feed',     title: 'Feed',     type: 'post' },
    { id: 'contacts', title: 'Contacts', type: 'contact' },
  ],
};

/**
 * Mock folio manifest (v0.4 cross-app demo).  Shows Q32 runtime tags:
 *   - readNote / shareFolder → 'browser'  (work in the browser bundle)
 *   - syncOnce / watchStart  → 'node'     (filtered OUT of browser catalog
 *                                          per OQ-1.A)
 * The browser /help only surfaces 'browser' + 'both' ops; 'node' ops
 * appear when canopy-chat is built for a sidecar deployment.
 */
export const mockFolioManifest = {
  app:        'folio',
  itemTypes:  ['note', 'file'],     // v0.7.13 — file added
  operations: [
    {
      id:    'readNote', verb: 'list',
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/readnote' },
        // #194 (B9, 2026-05-23) — record reply so frontmatter `embeds`
        // ("See also" refs to tasks / events / posts) can render as
        // clickable chips alongside the body text.
        chat:  { reply: 'record', hint: 'read a folio note' },
      },
    },
    {
      id:    'shareFolder', verb: 'add',
      params: [
        { name: 'folder', kind: 'string', required: true },
        { name: 'with',   kind: 'webid',  required: true },
      ],
      runtime: 'browser',
      surfaces: {
        // Part C gate — owns 'share'/'deel'. PARTIAL: binds `folder` from the body; the required
        // recipient `with` (a webid) is then form-elicited (a one-line command can't carry it).
        slash: { command: '/share', body: 'flags',
          match: { verbs: ['share', 'deel'], body: 'text-only', arg: 'folder', dropTrailing: ['with', 'to', 'met', 'aan'] } },
        chat:  { reply: 'text', hint: 'share a folio folder with a contact' },
      },
    },
    {
      id:    'syncOnce', verb: 'add', params: [],
      runtime: 'node',                                   // ← filtered in browser
      surfaces: {
        // Part C gate — no-arg action (sidecar only; runtime:'node' filters it from the browser bundle).
        slash: { command: '/sync',
          match: { verbs: ['sync', 'synchroniseer', 'synchroniseren'], body: 'none' } },
        chat:  { reply: 'text', hint: 'force a one-shot sync (sidecar only)' },
      },
    },
    {
      id:    'watchStart', verb: 'add', params: [],
      runtime: 'node',                                   // ← filtered in browser
      surfaces: {
        slash: { command: '/watch',
          match: { verbs: ['watch', ['watch', 'folder'], ['let', 'op'], 'bewaak', ['bewaak', 'map']], body: 'none' } },
        chat:  { reply: 'text', hint: 'start the folder watcher (sidecar only)' },
      },
    },
    /* ─── v0.7.13 — Q29 + receiver-action surface ─── */
    /**
     * `getFileSnapshot(path)` — Q29 cardSnapshotSkill for /embed-file
     * when the user picks an existing folio file by name/path.
     */
    {
      id:    'getFileSnapshot', verb: 'list',
      appliesTo: { type: 'file' },
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: { chat: { hint: 'snapshot a folio file for embedding' } },
    },
    /**
     * `[Download]` button on file-cards.  appliesTo:{type:'file'}
     * means the chat-shell's appliesTo-gated renderer auto-surfaces
     * this on every file-card embed (replaces the v0.7.x demo stub).
     */
    {
      id:    'downloadFile', verb: 'list',
      appliesTo: { type: 'file' },
      params: [{ name: 'path', kind: 'string', required: true,
        pickerSource: { listOp: 'listFiles' } }],          // Part C — label→path resolution
      runtime: 'browser',
      surfaces: {
        // Part C gate — "download X" → downloadFile{path}.
        slash: { match: { verbs: ['download', 'haal', ['haal', 'op'], ['download', 'bestand']], body: 'match', arg: 'path' } },
        ui:   { control: 'button', label: 'Download' },
        // Declare `reply: 'text'` so the chat-shell renders the
        // skill's `{ok, message}` reply as text — without this the
        // verb:'list' default renders as an empty list ('(no items)').
        // Slice-4 smoke fix (2026-05-23).
        chat: { reply: 'text', hint: 'download a file from the sender\'s pod' },
      },
    },
    /**
     * `[Save to my pod]` cross-pod copy.  Reads the sender's bytes
     * (or inline payload), writes to the receiver's own pod under
     * /shared-with-me/<name>.
     */
    {
      id:    'saveToMyPod', verb: 'add',
      appliesTo: { type: 'file' },
      params: [
        { name: 'path', kind: 'string', required: false,
          pickerSource: { listOp: 'listFiles' } },         // Part C — label→path resolution
        { name: 'name', kind: 'string', required: false },
      ],
      runtime: 'browser',
      surfaces: {
        // Part C gate — "save X [to my pod]" → saveToMyPod{path}.
        slash: { match: { verbs: ['save', 'bewaar', ['save', 'to', 'my', 'pod'], 'opslaan', ['bewaar', 'in', 'mijn', 'pod']], body: 'match', arg: 'path' } },
        ui:   { control: 'button', label: 'Save to my pod' },
        chat: { hint: 'save a shared file to your own pod' },
      },
    },
    /**
     * v0.7.cc — `/folio-status` — record reply: last sync, conflict
     * count, current sharing.  Mirrors `bin/folio status`.
     */
    {
      id:    'folioStatus', verb: 'list',
      params: [],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/folio-status' },
        chat:  { reply: 'record', hint: 'show folio sync status' },
      },
    },
    /**
     * Post-V0 follow-up — `/files` lists every folio file in the
     * current in-process index.  The substrate skill `listFiles`
     * was always registered + reachable via `bundle.callSkill`
     * (verified in #237 audit, 2026-05-27); the slash + surfaces
     * entry was simply missing from this manifest.  No-arg, list
     * reply so each row renders with file-card action buttons
     * (Download / Save to my pod) via appliesTo:{type:'file'}.
     */
    {
      id:    'listFiles', verb: 'list',
      params: [],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/files' },
        chat:  { reply: 'list', hint: 'list files in folio' },
      },
    },
  ],
  views: [
    { id: 'notes', title: 'Notes', type: 'note' },
    { id: 'files', title: 'Files', type: 'file' },
  ],
};

// v0.7 — Q30 brief-summary decls on each app's list op.  /brief fans
// across these to produce the morning brief.  Household's Q30 decl
// lives in `mockAgent.js`.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 30, label: 'Buurt' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 20, label: 'Folio' };

// v0.7.5 — Q33 search decls.  Each app declares a text-search skill
// so /find can fan across them.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.search = { searchSkill: 'searchPosts' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.search = { searchSkill: 'searchFiles' };

// v0.7.13 — Q29 cardSnapshotSkill on shareFolder (the user-visible
// 'share a file' moment).  /embed-file --path=<existing> looks up
// the file via getFileSnapshot before building the embed envelope.
mockFolioManifest.operations.find((o) => o.id === 'shareFolder')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getFileSnapshot' };
