/**
 * canopy-chat — own manifest.
 *
 * The chat shell composes OTHER apps' manifests at runtime via
 * `manifestMerge`.  Its own manifest declares ops the shell itself
 * owns (thread management, mute, etc.) — populated in phase v0.2+.
 * v0.1 ships a minimum manifest so the validator passes.
 *
 * Per `Project Files/canopy-chat/coding-plan.md` § Phase v0.1.
 */

export const canopyChatManifest = {
  app:        'canopy-chat',
  itemTypes:  ['chat-thread', 'chat-message'],
  operations: [
    /**
     * `/help` — list every command available in the merged catalog.
     *
     * Chat-shell built-in (handled locally by the web entry; not
     * routed to any app agent).  The handler lives in
     * `src/core/localBuiltins.js` and introspects the merged catalog
     * to produce its reply, so it picks up new apps automatically.
     */
    {
      id:    'help',
      verb:  'help',
      params: [],
      surfaces: {
        slash: { command: '/help' },
        chat:  {
          reply: 'text',
          hint:  'list every available command',
        },
      },
    },

    /**
     * `/feedback [code]` / `/feedback-stop` — enter / leave the feedback bot (M11).
     *
     * Declared here purely for DISCOVERABILITY: with these on the manifest, `/feedback` shows in
     * `/help` and the slash autosuggest. EXECUTION is intercepted upstream in `main.js handleUserText`
     * (a `/feedback` / `/feedback-stop` match runs before catalog dispatch — it needs the pod session
     * + the feedback surface), so these ops are never dispatched through the catalog.
     */
    {
      id:    'feedback',
      verb:  'add',
      params: [
        { name: 'code', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/feedback', body: 'code?' },
        chat:  {
          reply: 'text',
          hint:  'start the feedback assistant (optional participation code)',
        },
      },
    },
    {
      id:    'feedback-stop',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/feedback-stop' },
        chat:  {
          reply: 'text',
          hint:  'leave feedback mode',
        },
      },
    },

    /**
     * `/newthread <name>` — create a new chat thread.
     *
     * Default filter is wildcard ({}); the user can refine via the
     * sidebar's Configure (rename / filter / permissions) — v0.3+.
     * After creation, the new thread becomes active.
     */
    {
      id:    'newthread',
      verb:  'add',
      params: [
        { name: 'name', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/newthread' },
        chat:  {
          reply: 'text',
          hint:  'create a new chat thread',
        },
      },
    },

    /**
     * `/help-with <post-id>` — v0.7.cc.  Spawn (or activate) a chat
     * thread whose filter targets a specific stoop post.  The user
     * who tapped "Ik help" on Anne's post ends up in a private
     * thread on that post — DEMO.md §1.  Chat-shell builtin (no
     * stoop-side skill needed: filters on itemRef.id).
     */
    {
      id:    'help-with',
      verb:  'add',
      params: [
        { name: 'postId', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/help-with' },
        chat:  {
          reply: 'text',
          hint:  'open a private thread on a stoop post',
        },
      },
    },

    /**
     * `/threads` — list every chat thread in the workspace.
     */
    {
      id:    'threads',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/threads' },
        chat:  {
          reply: 'text',
          hint:  'list every chat thread',
        },
      },
    },

    /**
     * Slice 6d (2026-05-24) — `/dm <webid>`.  Slash-only entry in the
     * canopy-chat manifest; the per-row [DM] button is declared in
     * stoop's mock manifest because that's where the 'contact' and
     * 'member' item types live (appliesTo validates against
     * itemTypes).  Chat-shell-internal — main.js intercepts the
     * button + localBuiltins handles the slash.
     */
    {
      id:    'startDm',
      verb:  'add',
      params: [{ name: 'webid', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/dm' },
        chat:  { reply: 'text', hint: 'open a DM with a peer by webid' },
      },
    },

    /**
     * `/embed <itemId> [--claim]` — v0.5 J7 demo.  Posts an embed-
     * card to the active thread using the snapshot returned by the
     * item's `cardSnapshotSkill` (Q29).  `--claim` is the sender-
     * claim-on-behalf path (per OQ-5): the embed is issued AND
     * claimed by the sender atomically.  Without `--claim`, the
     * receiver claims via the [Claim] button on the rendered card.
     */
    {
      id:    'embed',
      verb:  'add',
      params: [
        { name: 'itemId', kind: 'string',  required: true,
          // Q34 — bare `/embed` → list household chores (default app);
          // user can switch app via /apps before invoking.  Each row
          // becomes a [pick] button that auto-submits.
          pickerSource: { listOp: 'listOpen', appOrigin: 'household' } },
        { name: 'claim',  kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/embed', body: 'flags' },
        chat:  {
          reply: 'embed-card',
          hint:  'embed an item card; --claim for claim-on-behalf',
        },
      },
    },

    /**
     * `/embed-file` — file-card.  v0.7.13: three modes:
     *   /embed-file --path=<existing>  → look up via folio's Q29
     *                                    getFileSnapshot; embed the
     *                                    real file metadata
     *   /embed-file --pick             → opens browser File API
     *                                    picker; user selects local
     *                                    file; reads bytes inline
     *   /embed-file --name=X [...]     → synthesises (back-compat)
     *
     * --share=<peer> routes the card to the peer's thread.
     */
    {
      id:    'embed-file',
      verb:  'add',
      params: [
        { name: 'path',  kind: 'string',  required: false },
        { name: 'pick',  kind: 'boolean', required: false },
        { name: 'name',  kind: 'string',  required: false },
        { name: 'mime',  kind: 'string',  required: false },
        { name: 'share', kind: 'string',  required: false },
      ],
      surfaces: {
        slash: { command: '/embed-file', body: 'flags' },
        chat:  { reply: 'embed-card', hint: 'embed a file; --path=X | --pick | --name=X' },
      },
    },

    /**
     * `/embed-time` — appointment maker.  v0.7 catch-up: user F:
     * "calendar lookup as an appointment maker (can be shared with
     * others too)".  Until a real calendar app exists, /embed-time
     * CREATES an appointment card client-side with the supplied
     * title + when + duration + location, optionally shared with a
     * peer.  Future: when a calendar app exists, /embed-time accepts
     * either an existing eventId (lookup) OR creation params.
     */
    {
      id:    'embed-time',
      verb:  'add',
      params: [
        { name: 'title',    kind: 'string', required: true  },
        { name: 'when',     kind: 'date',   required: true  },
        { name: 'duration', kind: 'string', required: false },
        { name: 'location', kind: 'string', required: false },
        { name: 'share',    kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/embed-time', body: 'flags' },
        chat:  { reply: 'embed-card', hint: 'create an appointment; --share=anne to send' },
      },
    },

    /**
     * `/logs [--since=...] [--app=X] [--type=Y] [--mute=app:type]` —
     * v0.7.1 D.1 network-events log.  Lists every event the
     * EventRouter delivered in the last 14 days (OQ-7.B retention),
     * with optional filter flags.  `--mute=app:type` adds a kind to
     * the mute set + reports.  Without args, shows the 20 most-recent
     * events.
     */
    {
      id:    'logs',
      verb:  'list',
      params: [
        { name: 'app',   kind: 'string', required: false },
        { name: 'type',  kind: 'string', required: false },
        { name: 'actor', kind: 'string', required: false },
        { name: 'since', kind: 'string', required: false },
        { name: 'mute',  kind: 'string', required: false },
        { name: 'limit', kind: 'number', required: false },
      ],
      surfaces: {
        slash: { command: '/logs', body: 'flags' },
        chat:  { reply: 'list', hint: 'recent events; --app= / --type= / --mute=app:type' },
      },
    },

    /**
     * `/scan-qr` — open the camera + scan a QR code (2026-05-27).
     * Pure UI host-op: the chat-shell catches this in localBuiltins,
     * triggers `openQrScanner()`, and the scanner modal classifies the
     * scanned text against the registered URI schemes (stoop-contact://,
     * stoop-invite://, …).  Web shell renders nothing today — the
     * platform-specific implementation lives in
     * apps/canopy-chat-mobile (and a future browser implementation
     * via getUserMedia + jsQR if desired).
     */
    {
      id:    'scanQr',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/scan-qr' },
        chat:  { reply: 'text', hint: 'open the camera to scan a QR' },
      },
    },

    /**
     * `/find <text>` — v0.7.5 user-requested search.  Fans across
     * apps with Q33 `surfaces.chat.search.searchSkill` declarations;
     * queries cached items first (instant).  An [Extensive search]
     * button on the result surfaces deeper queries (pod/network)
     * when those skills land.
     */
    {
      id:    'find',
      verb:  'list',
      params: [
        { name: 'query', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/find' },
        chat:  { reply: 'find', hint: 'search across all apps cached items' },
      },
    },

    /**
     * `/brief` — v0.7 morning-brief aggregator.  Fans across all
     * enabled apps that declare `surfaces.chat.brief.summarySkill`
     * (Q30); aggregates replies into a single brief-shape card.
     * Cache TTL: 60s per OQ-7.A (use --refresh / click [Refresh] to
     * bypass).
     */
    {
      id:    'brief',
      verb:  'list',
      params: [
        { name: 'refresh', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/brief', body: 'flags' },
        chat:  { reply: 'brief', hint: 'morning summary across all apps' },
      },
    },

    /**
     * `/signin` — v0.6.2 external-flow demo (J6 framework).
     *
     * Opens a mock external page that simulates an OIDC sign-in
     * round-trip; the callback wakes this thread with a fake
     * webid.  Real Inrupt OIDC binding lands when @canopy/oidc-session
     * is composed into the chat-shell (v0.7+).
     */
    {
      id:    'signin',
      verb:  'add',
      params: [
        { name: 'issuer', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/signin', body: 'flags' },
        chat:  { reply: 'text', hint: 'sign in to your Solid pod' },
      },
    },

    /**
     * `/apps` — v0.6 OQ-4.B chat-inline app-toggle.  Subcommands:
     *   /apps             → list every catalog app + enabled state
     *   /apps on <name>   → enable an app
     *   /apps off <name>  → disable an app
     *
     * Disabled apps disappear from /help + dispatches fail with a
     * friendly error.  Toggle persists across reloads.  Side-panel
     * UI lands with RN port (v0.6.7+).
     */
    /**
     * `/reset-thread` — v0.7.P1-followup.  Clears the active
     * thread's message history (in-memory + IDB).  Useful when
     * accumulated routed-event bubbles polluted Main during the
     * permissive-filter era.  Future: replace with per-thread
     * settings panel.
     */
    {
      id:    'reset-thread',
      verb:  'remove',
      params: [],
      surfaces: {
        slash: { command: '/reset-thread' },
        chat:  { reply: 'text', hint: "clear this thread's message history" },
      },
    },

    /**
     * `/whoami` — v0.7.P1.  Returns the current Solid webid (if
     * signed in) or a hint to /signin.
     */
    {
      id:    'whoami',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/whoami' },
        chat:  { reply: 'text', hint: 'show the signed-in webid' },
      },
    },

    /**
     * `/me` — v0.7.P3a.  Shows the user's persistent agent identity
     * info: chat-agent stableId + pubKey + NKN address.
     */
    {
      id:    'me',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/me' },
        chat:  { reply: 'text', hint: 'show your agent identity (pubKey, NKN address)' },
      },
    },

    /**
     * `/send-file <peer-addr>` — v0.7.P3f.  Opens a file picker;
     * dispatches the picked file via a chat-p2p envelope (subtype
     * 'file-share') to the peer.  Receiver renders a file-card embed
     * in Main with [Download]/[Save to my pod] buttons.  Small
     * files (under ~512 KB) inline as base64; larger require a pod
     * URL (deferred).  Peer can be an NKN address or (when WebID
     * resolution succeeds) a webid.
     */
    {
      id:    'send-file',
      verb:  'add',
      params: [
        { name: 'peer', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/send-file', body: 'flags' },
        chat:  { reply: 'text', hint: 'share a file with a peer via NKN' },
      },
    },

    /**
     * `/lookup-peer <webid>` — v0.7.P3d.  Resolves a peer's NKN
     * address by fetching their WebID profile + reading the
     * canopy:nknAddr triple from their pod's identity.ttl file.
     * Used to bridge webid → NKN cross-peer (so users don't have
     * to paste raw NKN addresses).
     */
    {
      id:    'lookup-peer',
      verb:  'list',
      params: [
        { name: 'webid', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/lookup-peer', body: 'flags' },
        chat:  { reply: 'text', hint: 'resolve a peer\'s NKN address from their webid' },
      },
    },

    /**
     * `/publish-nkn` — v0.7.P3d.  Re-publishes the user's NKN
     * address to their pod's identity.ttl (auto-runs on sign-in;
     * this command is for manual re-publish after /rotate-identity
     * changes the address).
     */
    {
      id:    'publish-nkn',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/publish-nkn' },
        chat:  { reply: 'text', hint: 'publish your NKN address to your pod' },
      },
    },

    /**
     * `/rotate-identity` — v0.7.P3d.  Generates a fresh Ed25519
     * keypair for the chat-agent.  Old key stays valid 7 days
     * (grace period); KeyRotation.broadcast notifies known peers.
     * Your NKN address CHANGES (derived from pubKey), so peers will
     * need to update.  Use /me to see the new address afterwards.
     */
    {
      id:    'rotate-identity',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/rotate-identity' },
        chat:  { reply: 'text', hint: 'rotate your chat-agent identity (7-day grace period)' },
      },
    },

    /**
     * `/security-status` — v0.7.P3d.  Reports SecurityLayer state:
     * wired? known peers? identity pubKey + stableId.  Post-factory-
     * migration: also reports mute count, audit chain size, claim
     * binding, vault encryption — everything the secure-agent factory
     * has wired.
     */
    {
      id:    'security-status',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/security-status' },
        chat:  { reply: 'text', hint: 'show cryptography state (signed/encrypted peer messages)' },
      },
    },

    /**
     * A1 (2026-05-23) — relay-server configuration.  canopy-chat uses
     * NKN by default; a WebSocket relay can be added as a second
     * cross-peer transport.  Frits 2026-05-23: "users must be able to
     * choose either relay or nkn when connecting through internet."
     *
     *   /set-relay <ws://ip:port>   persist + connect to a relay
     *   /set-relay --clear          disconnect + clear persisted URL
     */
    {
      id:    'set-relay',
      verb:  'submit',
      params: [
        { name: 'url',   kind: 'string',  required: false },
        { name: 'clear', kind: 'boolean', required: false },
      ],
      surfaces: {
        slash: { command: '/set-relay', body: 'flags' },
        chat:  { reply: 'text', hint: 'set the canopy relay URL (or --clear to drop it)' },
      },
    },

    /**
     * A1 — transport routing choice.  When both NKN + relay are
     * connected, picks which one sendToPeer uses.
     */
    {
      id:    'transport-mode',
      verb:  'submit',
      params: [
        { name: 'mode', kind: 'enum', of: ['nkn', 'relay', 'both'], required: true },
      ],
      surfaces: {
        slash: { command: '/transport-mode' },
        chat:  { reply: 'text', hint: 'pick which transport handles peer sends' },
      },
    },

    /**
     * A1 — status reporter for both transports.  Shows NKN + relay
     * state side-by-side: connected? address? URL? + current mode.
     */
    {
      id:    'transports',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/transports' },
        chat:  { reply: 'record', hint: 'show NKN + relay transport status' },
      },
    },

    /**
     * #180 (2026-05-24) — first consumer of surfaces.page.  Opens a
     * Settings side-panel where the user can change locale + a few
     * other preferences without typing slashes.  V0 proves the panel
     * infra works; future settings (transport-mode picker, mute
     * audit, identity rotation date) layer in.
     */
    {
      id:    'settings',
      verb:  'list',
      params: [
        {
          name: 'lang',
          kind: 'enum',
          of:   ['en', 'nl'],
          required: false,
        },
      ],
      surfaces: {
        slash: { command: '/settings' },
        chat:  { hint: 'open Settings in a side panel' },
        page:  { kind: 'side-panel', title: 'Settings' },
      },
    },

    /**
     * `/mute <peer>` — mute a peer.  Accepts NKN address, pubKey,
     * webid, or stableId — when identityResolver is wired, mute
     * fans out across all aliases (one webid blocks every device).
     * Persisted across reloads.
     */
    {
      id:    'mute',
      verb:  'add',
      params: [
        { name: 'peer', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/mute', body: 'argline' },
        chat:  { reply: 'text', hint: 'block a peer (drops their messages + refuses to send)' },
      },
    },

    /**
     * `/unmute <peer>` — remove a peer from the mute set.  Use the
     * same identifier you muted with (NKN addr / pubKey / webid).
     */
    {
      id:    'unmute',
      verb:  'add',
      params: [
        { name: 'peer', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/unmute', body: 'argline' },
        chat:  { reply: 'text', hint: 'remove a peer from the mute set' },
      },
    },

    /**
     * `/muted` — list everyone in the mute set.
     */
    {
      id:    'muted',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/muted' },
        chat:  { reply: 'text', hint: 'list muted peers' },
      },
    },

    /**
     * `/debug-dump` — print a triage-friendly snapshot for bug
     * reports.  Pastes nicely into a chat / issue / DM so Claude
     * can diagnose without asking "what does securityStatus
     * report?" twelve times.  Includes: securityStatus, last 5
     * wire sizes (inbound + outbound), peer state, mute count,
     * audit chain size, vault prefix.
     */
    {
      id:    'debug-dump',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/debug-dump' },
        chat:  { reply: 'text', hint: 'print a triage snapshot for bug reports' },
      },
    },

    /**
     * `/audit-tail [N=20]` — show the last N entries from the signed
     * audit chain (default 20).  Verifies the chain on every call:
     * if the chain is tampered, the result includes the failure
     * point + reason.
     */
    {
      id:    'audit-tail',
      verb:  'list',
      params: [
        { name: 'n',     kind: 'number', required: false },
        { name: 'event', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/audit-tail', body: 'flags' },
        chat:  { reply: 'text', hint: 'show recent entries from the signed audit log' },
      },
    },

    /**
     * `/peer-connect` — v0.7.P3b.  Initiates the NKN cross-peer
     * transport (takes 5-30s; up to 90s on first connect).  Runs
     * automatically on sign-in but the user can re-trigger via
     * this command.
     */
    {
      id:    'peer-connect',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/peer-connect' },
        chat:  { reply: 'text', hint: 'connect to the NKN cross-peer network' },
      },
    },

    /**
     * `/test-peer <addr> [text]` — v0.7.P3b.  Send a one-way
     * chat-p2p envelope to another peer's NKN address (their /me
     * output).  The receiver's NKN transport renders it as an
     * incoming bubble in their Main thread.
     */
    {
      id:    'test-peer',
      verb:  'add',
      params: [
        // 2026-05-27 slash audit close-out — param renamed
        // `address` → `addr` to match the user-facing locale
        // contract (`peer.no_address` reads "/test-peer <addr> [text]").
        { name: 'addr', kind: 'string', required: true  },
        { name: 'text', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/test-peer', body: 'flags' },
        chat:  { reply: 'text', hint: 'send a test message to another peer' },
      },
    },

    /**
     * `/signout` — v0.7.P1.  Clears the local OIDC session.
     */
    {
      id:    'signout',
      verb:  'remove',
      params: [],
      surfaces: {
        slash: { command: '/signout' },
        chat:  { reply: 'text', hint: 'sign out of your pod' },
      },
    },

    {
      id:    'apps',
      verb:  'list',
      params: [
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
        { name: 'app',    kind: 'string',                  required: false },
      ],
      surfaces: {
        slash: { command: '/apps', body: 'flags' },
        chat:  { reply: 'text', hint: 'list or toggle apps; /apps on|off <name>' },
      },
    },

    /**
     * `/send-to <peer> <itemId>` — v0.5.6 simulated cross-peer demo.
     * Fakes a J7 round-trip by routing an embed-card into the named
     * peer's thread (per the simulated cross-peer simPeers config).
     * Lets the user test issued-by + receiver-claim UX in a single
     * browser tab without real network.  Real cross-peer delivery
     * happens through each hosting app's chat surface (v0.5.3 audit).
     */
    {
      id:    'sendto',
      verb:  'add',
      params: [
        { name: 'peer',   kind: 'string', required: true },
        { name: 'itemId', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/send-to' },
        chat:  { reply: 'text', hint: 'simulate sending an embed to a peer thread' },
      },
    },
  ],
  views: [],   // chat shell does not surface its own views in nav;
               //   threads are managed via the chat UI, not a section
};

export default canopyChatManifest;
