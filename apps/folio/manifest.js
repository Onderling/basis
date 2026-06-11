/**
 * Folio — app-manifest declaration.
 *
 * Slice F.1 (V0.8, 2026-05-21) — folio's first NavModel manifest.
 *
 * **Part G dissolve (2026-06-11):** this is now the ONE folio manifest.
 * canopy-chat's former `mockFolioManifest` (the chat-shell slash/gate
 * surface for the REAL folio skills) was folded in here and re-exported
 * as `mockFolioManifest` for back-compat.  So the app's web/mobile
 * screens AND the chat shell (circle LLM + deterministic gate) now read
 * a single source of truth — the calendar-style target model.
 *
 * **Slash surface:** the chat-shell ops below declare `/readnote /share
 * /sync /watch /files /folio-status` (+ Part-C gate `match` verbs).  The
 * structurally-distinct destructive ops (deleteFromPod / deleteLocally /
 * forceRepush) DELIBERATELY carry NO `surfaces.chat` — the circle LLM
 * must never propose deleting a shared file (Part G curation decision).
 * See `Project Files/canopy-chat/slash-coverage-audit-2026-05-24.md`.
 *
 * Folio is structurally different from the item-store apps (tasks-v0,
 * stoop, household): it doesn't have an ItemStore + crew-scoped items.
 * Its "items" are markdown files mirrored to a Solid pod via
 * `@canopy/sync-engine`.  Its "skills" are HTTP route handlers
 * (`apps/folio/src/server/routes.js`) + CLI commands
 * (`apps/folio/src/cli/*.js`) + RN actions
 * (`apps/folio-mobile/src/screens/*.js`) — NOT the
 * `defineSkill` / agent-invoke shape the substrate apps use.
 *
 * What this manifest IS:
 *   - Source-of-truth declaration of folio's destructive ops with Q27
 *     severity hints (per Project Files/Substrates/tier-c-proposals.md):
 *
 *       deleteFromPod   severity: 'danger'  (irreversible pod-side delete)
 *       deleteLocally   severity: 'info'    (tombstone; pod copy survives)
 *       forceRepush     severity: 'warn'    (overwrites pod versions)
 *
 *     Plus a few non-destructive ops (sync-now, watch-start, watch-stop,
 *     verifyPodState) for shape coverage.
 *
 *   - Documentation: chat agents (a future folio chat agent, or a host
 *     chat agent that knows about folio) can read this manifest's
 *     `surfaces.chat.hint` strings to surface folio operations.
 *
 *   - Forward-compat: when folio gains a real NavModel-driven UI
 *     (currently the HTTP server + RN screens are hand-coded), the
 *     adapter consumes this manifest directly.  Today the manifest is
 *     declaration-only; no adapter consumes it yet.
 *
 * What this manifest is NOT (yet):
 *   - Wired into the HTTP routes — routes still own their own logic.
 *   - Wired into folio-mobile screens — they still own their own
 *     ConfirmModal usage.
 *   - Q16-strict — `validateManifest(folioManifest, {strict: true})`
 *     would flag `listFiles` + `verifyPodState` because they don't have
 *     `defineSkill` entries; folio's "skills" are HTTP routes.  Default
 *     non-strict validation passes.
 *
 * Future slices (F.2+) can wire the HTTP /status page + folio-mobile
 * screens to read this manifest's projected NavModel for severity
 * hints + label resolution.
 */

/** @type {import('@canopy/app-manifest').__types__} */
export const folioManifest = {
  app:       'folio',
  itemTypes: [
    // Markdown notes + the files mirrored between local folder and Solid
    // pod.  The local rel-path is the item identity (e.g. 'notes/today.md').
    // Part G (2026-06-11): 'note' folded in from the former mockFolioManifest
    // (readNote / getFileSnapshot operate on notes-as-files).
    'note',
    'file',
  ],

  operations: [
    /* ── Destructive ops (Q27 confirm) ─────────────────────────────── */

    {
      id:        'deleteFromPod',
      verb:      'remove',
      // Q32 (canopy-chat v0.4, 2026-05-22) — pod-side delete is HTTPS;
      // works in browser.  Per OQ-1.A: canopy-chat exposes this in
      // its browser bundle.
      runtime:   'browser',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        // Part G curation (2026-06-11): NO chat surface.  Destructive
        // ops are deliberately withheld from the circle LLM tool list
        // so the model can never propose deleting a shared file.  The
        // `buildToolDescriptors` chat-surface filter then hides this op
        // from the model; it stays reachable via the UI (button+confirm).
        ui: {
          control: 'button',
          label:   'Delete from pod',
          confirm: {
            severity: 'danger',
            message:  'Permanently delete this file from your Solid pod?  This cannot be undone.',
          },
        },
      },
    },

    {
      id:        'deleteLocally',
      verb:      'remove',
      // Q32 — local-fs delete needs Node; canopy-chat in browser
      // filters this out per OQ-1.A.
      runtime:   'node',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        // Part G curation (2026-06-11): NO chat surface (destructive — withheld from the circle LLM).
        ui: {
          control: 'button',
          label:   'Delete locally',
          confirm: {
            severity: 'info',
            message:  'Remove local copy?  Pod copy survives.',
          },
        },
      },
    },

    {
      id:     'forceRepush',
      verb:   'sync',  // F-SP1-e: app-local verb.  Distinct from runOnce
                       // (a normal bi-directional sync) — forceRepush
                       // overwrites pod versions wholesale.
      // Q32 — sync touches local fs (reads files to overwrite pod);
      // node-only.  Sidecar-mode canopy-chat re-includes.
      runtime: 'node',
      params: [],
      // V0.2 Q8 wildcard — folder-wide op, not file-specific.  The
      // wildcard surfaces it as a section-header CTA on every view
      // (today just `files`).  Future folio views (e.g. conflicts)
      // pick it up automatically.
      appliesTo: { type: '*' },
      surfaces: {
        // Part G curation (2026-06-11): NO chat surface (destructive — withheld from the circle LLM).
        ui: {
          control:   'button',
          label:     'Force re-push',
          placement: 'section-header',
          confirm: {
            severity: 'warn',
            message:  'Force-push the local folder to the pod?  This overwrites any concurrent edits on the pod side.',
          },
        },
      },
    },

    /* ── Non-destructive ops (shape coverage) ──────────────────────── */

    {
      id:        'syncOnce',
      verb:      'sync',
      // Q32 — bi-directional fs ↔ pod sync; needs Node.
      runtime:   'node',
      params:    [],
      // V0.2 Q8 wildcard — folder-wide; surfaces on every view's header.
      appliesTo: { type: '*' },
      surfaces: {
        // Part G merge (2026-06-11): real ui (section-header sync button)
        // + the mock chat-shell's slash/gate surface for the circle bot.
        // Part C gate — no-arg action (sidecar only; runtime:'node'
        // filters it from the browser bundle).
        slash: { command: '/sync',
          match: { verbs: ['sync', 'synchroniseer', 'synchroniseren'], body: 'none' } },
        chat: { reply: 'text', hint: 'force a one-shot sync (sidecar only)' },
        ui: {
          control:   'button',
          label:     'Sync now',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'watchStart',
      verb:      'watch',
      // Q32 — local-fs watcher (chokidar); Node-only.
      runtime:   'node',
      params:    [],
      appliesTo: { type: '*' },
      surfaces: {
        // Part G merge (2026-06-11): real ui + mock chat-shell slash/gate.
        slash: { command: '/watch',
          match: { verbs: ['watch', ['watch', 'folder'], ['let', 'op'], 'bewaak', ['bewaak', 'map']], body: 'none' } },
        chat: { reply: 'text', hint: 'start the folder watcher (sidecar only)' },
        ui: {
          control:   'button',
          label:     'Start watching',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'watchStop',
      verb:      'watch',  // F-SP1-e: same verb as watchStart, opposite
                           // semantics — distinguished by skill id.
      // Q32 — stops the local-fs watcher; Node-only.
      runtime:   'node',
      params:    [],
      appliesTo: { type: '*' },
      surfaces: {
        chat: { hint: 'Stop the local-folder watcher.  Future edits no longer auto-sync; manual sync still works.' },
        ui: {
          control:   'button',
          label:     'Stop watching',
          placement: 'section-header',
        },
      },
    },

    {
      id:        'verifyPodState',
      verb:      'read',
      // Q32 — HEAD-equivalent pod check + hash compare; HTTPS only,
      // browser-doable.
      runtime:   'browser',
      appliesTo: { type: 'file' },
      params: [
        { name: 'relPath', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { hint: 'Check whether a local file matches its pod counterpart (existence + sha + size).' },
        ui:   { control: 'button', label: 'Verify on pod' },
      },
    },

    /* ── Chat-shell ops (Part G dissolve, 2026-06-11) ───────────────────
     * Folded in from canopy-chat's former `mockFolioManifest`.  These are
     * the circle/chat-shell surface for the REAL folio skills
     * (handlers via createBrowserFolioAgent / realAgent).  Each declares
     * `surfaces.chat` (and most a Part-C gate `match`), so the circle
     * LLM + the deterministic gate read them straight from this one
     * manifest.  The destructive ops above deliberately carry NO chat. */

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
     * this on every file-card embed.
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
     * `/folio-status` — record reply: last sync, conflict count,
     * current sharing.  Mirrors `bin/folio status`.
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
     * `/files` lists every folio file in the current in-process index.
     * No-arg, list reply so each row renders with file-card action
     * buttons (Download / Save to my pod) via appliesTo:{type:'file'}.
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
    // The notes view — Part G (2026-06-11), folded in from the former
    // mockFolioManifest.  Markdown notes (readNote / search / brief).
    { id: 'notes', title: 'Notes', type: 'note' },
    // The files view — list of locally-tracked markdown files.  Today
    // populated by folio's `/files` HTTP route + folio-mobile's
    // NotesListScreen; the manifest's `dataSource.skillId` is
    // aspirational (folio doesn't have a `listFiles` defineSkill yet).
    // Q16-strict mode would flag this; default non-strict passes.
    {
      id:         'files',
      title:      'Files',
      type:       'file',
      dataSource: { skillId: 'listFiles' },
    },
  ],
};

export default folioManifest;
