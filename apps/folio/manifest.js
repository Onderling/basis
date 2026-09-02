/**
 * Folio — app-manifest declaration.
 *
 * folio's first NavModel manifest.
 *
 * **Part G dissolve (2026-06-11):** this is now the ONE folio manifest.
 * basis's former `mockFolioManifest` (the chat-shell slash/gate
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
 * See `Project Files/basis/slash-coverage-audit-2026-05-24.md`.
 *
 * Folio is structurally different from the item-store apps (tasks-v0,
 * stoop, household): it doesn't have an ItemStore + circle-scoped items.
 * Its "items" are markdown files mirrored to a Solid pod via `@onderling/sync-engine`.
 *
 * ⚠ CORRECTED 2026-08-03. This used to say folio's skills are "HTTP route handlers + CLI commands + RN
 * actions — NOT the `defineSkill` / agent-invoke shape the substrate apps use". That stopped being true on
 * 2026-07-10, when folio became a connectable agent: `apps/folio/src/wireSkills.js` derives
 * `defineSkill`-shaped handlers from THIS manifest via `buildFolioSkills`, guarded by
 * `apps/folio/test/localWireFitness.test.js`. The HTTP/CLI/RN surfaces still exist — they are now
 * projections alongside the wire route, not instead of it.
 *
 * The stale sentence is worth naming: it is why an audit read folio's `listFiles` as a declaration with no
 * backing skill. The op has four live consumers. A comment that outlives its code does not just mislead a
 * reader — it makes working code look dead.
 *
 * What this manifest IS:
 *   Source-of-truth declaration of folio's destructive ops with
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
 *   strict — historical note: this said strict validation "would flag `listFiles` + `verifyPodState`
 *     because they don't have `defineSkill` entries". They do, since 2026-07-10 (`buildFolioSkills`).
 *     What strict mode still flags is the `listFiles` VIEW at the end of this file, whose
 *     `dataSource.skillId` is declared while the view itself is deliberately not projected — see
 *     `plans/NOTE-manifest-browser-surface-type.md` ("better honestly-bespoke than misleadingly
 *     half-projected").
 *
 * Future slices (F.2+) can wire the HTTP /status page + folio-mobile
 * screens to read this manifest's projected NavModel for severity
 * hints + label resolution.
 */

/** @type {import('@onderling/app-manifest').__types__} */
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

  // B · Layer 1 — domain (non-atom) verbs: `sync`/`watch` (pod ↔ local file
  // reconciliation — genuinely orthogonal to CRUD).  Every other op is an atom.
  domainVerbs: ['sync', 'watch'],

  // B · Layer 1 — DECLARED-AUTHORITATIVE (verb × noun) capability surface (docs/decisions.md 2026-07-02;
  // PLAN-capability-arc §1a). This declaration IS the member-facing capability set. Equals the current derived
  // set (inert), now explicit. `note` (an itemType) carries no member capability — its ops are domain/read-only.
  nouns: {
    file: { atoms: ['add', 'list', 'get', 'remove'] },
  },

  operations: [
    /* ── Destructive ops (confirm) ─────────────────────────────── */

    {
      id:        'deleteFromPod',
      verb:      'remove',
      // (basis v0.4, 2026-05-22) — pod-side delete is HTTPS;
      // works in browser.  Per OQ-1.A: basis exposes this in
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
      // local-fs delete needs Node; basis in browser
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
      // sync touches local fs (reads files to overwrite pod);
      // node-only.  Sidecar-mode basis re-includes.
      runtime: 'node',
      params: [],
      // wildcard — folder-wide op, not file-specific. The
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
      // bi-directional fs ↔ pod sync; needs Node.
      runtime:   'node',
      params:    [],
      // wildcard — folder-wide; surfaces on every view's header.
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
      // local-fs watcher (chokidar); Node-only.
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
      // stops the local-fs watcher; Node-only.
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
      // HEAD-equivalent pod check + hash compare; HTTPS only,
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
     * Folded in from basis's former `mockFolioManifest`.  These are
     * the circle/chat-shell surface for the REAL folio skills
     * (handlers via createBrowserFolioAgent / realAgent).  Each declares
     * `surfaces.chat` (and most a Part-C gate `match`), so the circle
     * LLM + the deterministic gate read them straight from this one
     * manifest.  The destructive ops above deliberately carry NO chat. */

    {
      id:    'readNote', group: 'data', verb: 'list',
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/readnote' },
        // (B9, 2026-05-23) — record reply so frontmatter `embeds`
        // ("See also" refs to tasks / events / posts) can render as
        // clickable chips alongside the body text.
        chat:  { reply: 'record', hint: 'read a folio note' },
      },
    },
    {
      id:    'shareFolder', group: 'compose', verb: 'add',
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
     * `getFileSnapshot(path)` — cardSnapshotSkill for /embed-file
     * when the user picks an existing folio file by name/path.
     */
    {
      id:    'getFileSnapshot', verb: 'list',
      appliesTo: { type: 'file' },
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      // Substrate, not a door: the card machinery reads this back (`cardSnapshotSkill`) whenever a
      // composer embeds one — no person ever taps "snapshot". `internal` takes it out of coverage and
      // out of the Advanced drawer. Internal ≠ unused; it is called on every embed.
      surfaces: { internal: true },
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
      id:    'folioStatus', group: 'data', verb: 'list',
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
      id:    'listFiles', group: 'data', verb: 'list',
      params: [],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/files' },
        chat:  { reply: 'list', hint: 'list files in folio' },
      },
    },
    /**
     * `/zoek` — SEMANTIC note search (pod-search V2 first consumer, 52.25).
     * The meaning-aware sibling of `searchFiles`: ranks notes via
     * `@onderling/pod-search`, so a query finds a note by synonym/paraphrase,
     * not just a filename substring. Degrades to lexical when the circle's
     * embed policy is off / no embedder is available (llmTool:'off'), so the
     * op is always answerable. `mode` is optional (defaults to semantic when
     * available, lexical otherwise); the handler flags a `degraded:'lexical'`
     * result when semantic was asked for but unavailable.
     */
    {
      id:    'searchNotes', group: 'data', verb: 'list',
      params: [
        { name: 'query', kind: 'string', required: true },
        { name: 'mode',  kind: 'string', required: false },   // 'lexical' | 'semantic' | 'hybrid'
      ],
      runtime: 'browser',
      surfaces: {
        // `/zoek <text>` → the default 'match' body rule binds the body to
        // the first required param (`query`). The Part-C gate ALSO matches
        // the bare verbs "zoek/search/find <text>" → searchNotes{query}.
        slash: { command: '/zoek',
          match: { verbs: ['zoek', 'zoeken', 'search', 'find'], body: 'text-only', arg: 'query' } },
        chat:  { reply: 'list', hint: 'search folio notes by meaning (semantic when available)' },
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
    // strict mode would flag this; default non-strict passes.
    {
      id:         'files',
      title:      'Files',
      type:       'file',
      dataSource: { skillId: 'listFiles' },
    },
  ],
};

export default folioManifest;
