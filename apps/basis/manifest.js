/**
 * basis — own manifest.
 *
 * The chat shell composes OTHER apps' manifests at runtime via
 * `manifestMerge`.  Its own manifest declares ops the shell itself
 * owns (thread management, mute, etc.) — populated in phase v0.2+.
 * v0.1 ships a minimum manifest so the validator passes.
 *
 * Per `Project Files/basis/coding-plan.md` § Phase v0.1.
 */

export const basisManifest = {
  app:        'basis',
  itemTypes:  ['chat-thread', 'chat-message'],

  // B · Layer 1 — domain (non-atom) verb: `help` (meta / shell command).
  // Every other op maps to an SDK atom.
  domainVerbs: ['help'],

  // §1a (declared-authoritative capability surface): INTENTIONALLY no `nouns` block.
  // This is the shell/unifier manifest — every op is an app-level command (help/settings/
  // mute/newthread/…) that names NO item noun, so it has ZERO (atom × noun) capabilities to
  // curate. Adding `nouns:{}` would flip it to declared-authoritative and silently DROP any
  // future chat-thread/chat-message capability. The `noun-declaration discipline` fitness guard
  // (test/atom-discipline.test.js) enforces exactly this: a `nouns` block is required the moment
  // an op here starts naming a noun (via appliesTo.type or a `type`-enum param), not before.

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

    /*
     * NOTE (feedback-split F2, 2026-07-08): the `/feedback` + `/feedback-stop` ops were RETIRED here.
     * Feedback is no longer a hardwired circle-composer slash command; it attaches through the
     * added-agent path (the `fp-bot` contact — invite/QR → `feedbackBotStore` → its own thread),
     * per `plans/design/DESIGN-feedback-surface-contract.md` §Registration. The manifest is the
     * source of truth for surfaces (invariant #4); an op with no live surface no longer belongs here.
     */

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
     * `/dm <webid>`. Slash-only entry in the
     * basis manifest; the per-row [DM] button is declared in
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
     * item's `cardSnapshotSkill`. `--claim` is the sender
     * claim-on-behalf path (per OQ-5): the embed is issued AND
     * claimed by the sender atomically.  Without `--claim`, the
     * receiver claims via the [Claim] button on the rendered card.
     */
    {
      id:    'embed',
      verb:  'add',
      params: [
        { name: 'itemId', kind: 'string',  required: true,
          // bare `/embed` → list household chores (default app);
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
        // (J4) — the ATTACHMENT projector (`renderAttachments`). Mirrors
        // `surfaces.slash`: one declaration → the op appears in the composer's
        // "+" attach menu. `label` is a locale key (invariant #8; the surface
        // renderer resolves it via t()). Tapping "Kaart" fires this op's
        // `{opId,args}` → callSkill, identical to typing `/embed`.
        attach: { label: 'circle.attach.card', group: 'embed' },
      },
    },

    /**
     * `/embed-file` — file-card.  v0.7.13: three modes:
     *   embed-file --path=<existing> → look up via folio's
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
        // (J4) — attach-menu entry "Bestand". The projected file entry is the
        // ONE the web composer routes back through the media pipeline
        // (createMediaEmbed / sealed upload); every other entry dispatches
        // straight to callSkill. `itemType: 'file'` names the attachable noun.
        attach: { label: 'circle.attach.file', itemType: 'file', group: 'media' },
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
        // (J4) — attach-menu entry "Afspraak". Its required params (title
        // when) trip the composer's form machinery (buildFormSpec) on tap, then
        // dispatch — exactly like `/embed-time` with no flags does today.
        attach: { label: 'circle.attach.appointment', itemType: 'event', group: 'media' },
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
     * scanned text against the registered URI schemes (onderling-contact://,
     * onderling-invite://, …).  Web shell renders nothing today — the
     * platform-specific implementation lives in
     * apps/basis-mobile (and a future browser implementation
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
     * apps with `surfaces.chat.search.searchSkill` declarations;
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
     * ; aggregates replies into a single brief-shape card.
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
     * `compare` — (feedback-extension). Before/after curation of two content
     * versions (e.g. an original message vs its curated form). Reuses folio's
     * `objectDiff` compute and renders via the `curation` reply shape (a
     * before/after view, distinct from folio's file-merge look). A composable op
     * (a mapping/composite step) — no slash surface; args `{ before, after }`.
     */
    {
      id:    'compare',
      verb:  'list',
      surfaces: {
        chat:  { reply: 'curation', hint: 'before/after curation of two versions' },
      },
    },

    /**
     * `/signin` — v0.6.2 external-flow demo (J6 framework).
     *
     * Opens a mock external page that simulates an OIDC sign-in
     * round-trip; the callback wakes this thread with a fake
     * webid.  Real Inrupt OIDC binding lands when @onderling/oidc-session
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
     * `/reset-thread` — v0.7.-followup. Clears the active
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
     * `/whoami` — v0.7.. Returns the current Solid webid (if
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
     *
     * D / consumer-switch (second surface) — the "Me" op ALSO
     * surfaces as the "Mij" (Me) profile screen, the top-level self
     * surface (handle · skills · location).  Declaring `surfaces.page`
     * makes the manifest the source of truth for that screen's header:
     * the running profile renderer (renderCircleProfile) derives its
     * label from renderWeb(manifest).pages[].labelKey via t(), instead
     * of a hardcoded tr('circle.profile.title').  `kind: 'screen'` (a
     * full nav destination, not a side-panel/modal); `route` is the
     * mobile nav route carried for renderMobile (the web adapter ignores
     * it).  `title` stays as the English fallback for consumers without
     * a t() (renderWeb's Page.title passthrough).
     */
    {
      id:    'me',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/me' },
        chat:  { reply: 'text', hint: 'show your agent identity (pubKey, NKN address)' },
        page:  { kind: 'screen', route: 'mij', title: 'Me', labelKey: 'circle.profile.title' },
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
     * onderling:peerAddr triple from their pod's identity.ttl file.
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
     * `/publish-peer` — v0.7.P3d.  Re-publishes the user's NKN
     * address to their pod's identity.ttl (auto-runs on sign-in;
     * this command is for manual re-publish after /rotate-identity
     * changes the address).
     */
    {
      id:    'publish-peer',
      verb:  'add',
      params: [],
      surfaces: {
        slash: { command: '/publish-peer' },
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
     * A1 (2026-05-23) — relay-server configuration.  basis uses
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
        chat:  { reply: 'text', hint: 'set the relay URL (or --clear to drop it)' },
        // Objective D / Surface 4 — first LIVE consumer of openPagePanel's
        // simple-form path (web `pagePanel.js`).  The docked side-panel auto-builds
        // a form from these params (url · clear) and dispatches via callSkill.
        // `title` is the English fallback; a consumer with a t() localises via
        // `labelKey` (as the running my-data control does when it opens the panel).
        page:  { kind: 'side-panel', title: 'Relay server', labelKey: 'circle.mydata.relay_set' },
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
     * first consumer of surfaces.page. Opens a
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
      /**
       * Connectivity Phase 4 §9 — circle/admin transport + route + policy controls, ADDED to
       * the existing settings op as MANIFEST controls (invariant #4 — declared here, never a
       * per-shell switch). Both shells (web `circleSettings.js` + RN `CircleSettingsScreen.js`)
       * render this list; the ONE new mechanism is `enabledWhen` — a predicate folded over the
       * circle's route + data-policy (`src/v2/circleSettingsControls.js`, reusing C9's
       * `resolveCircleDataPolicy`) that greys out incompatible options per the §7 route ×
       * capability matrix. `scope` marks a control device-applied (dispatches the transport/relay
       * op) vs circle-policy (`policyField`, saved with the rest of the policy).
       */
      controls: [
        // Transport-mode picker — device-scoped; dispatches the `transport-mode` op. `nkn` is the
        // default transport (always available); `relay`/`both` grey out with no relay endpoint
        // (optionEnabledWhen: 'transportAvailable').
        {
          id: 'transport-mode', kind: 'choice', scope: 'device',
          opId: 'transport-mode', arg: 'mode', of: ['nkn', 'relay', 'both'],
          labelKey: 'circle.settings.transportMode', hintKey: 'circle.settings.transportMode_hint',
          optLabelPrefix: 'circle.settings.transportMode_opt',
          enabledWhen: 'always', optionEnabledWhen: 'transportAvailable',
        },
        // Relay endpoint — device-scoped; dispatches the `set-relay` op (blank clears).
        {
          id: 'relay-endpoint', kind: 'text', scope: 'device',
          opId: 'set-relay', arg: 'url',
          labelKey: 'circle.settings.relayEndpoint', hintKey: 'circle.settings.relayEndpoint_hint',
          enabledWhen: 'always',
        },
        // Wake nudges — device-scoped, OFF by default (silence-by-default). Enabling registers this
        // device's push token on the relay so a pending message can send a CONTENTLESS wake through
        // the platform's push service; the hint says exactly what that service learns (that something
        // is pending, and when — never from whom or what). Greys out where the platform has no OS
        // push path (web: an open tab already receives live).
        {
          id: 'wake-nudges', kind: 'toggle', scope: 'device',
          opId: 'wake-nudges', arg: 'enabled', stateKey: 'wakeNudges',
          labelKey: 'circle.settings.wakeNudges', hintKey: 'circle.settings.wakeNudges_hint',
          disabledHintKey: 'circle.settings.wakeNudges_disabled',
          enabledWhen: 'pushCapable',
        },
        // What this circle's conversation contains — circle-policy field, admin-only, options resolved
        // from the entry-kind registry at render time (`optionsFrom`). Added 2026-07-29 as decision 3's
        // missing surface: the axis was persisted and read, and `setConversationKind` had no call site,
        // so nobody — admin included — could change it (S3/J-CW5).
        {
          id: 'conversation-kinds', kind: 'multi', scope: 'circle', policyField: 'conversationKinds',
          optionsFrom: 'conversationKinds', adminOnly: true,
          labelKey: 'circle.settings.conversationKinds',
          hintKey: 'circle.settings.conversationKinds_hint',
          enabledWhen: 'always',
        },
        // Member↔member private chat — circle-policy field; enabled only when a relay/rendezvous
        // route can carry the peer pairwise key (§7). Greys out under pod-only (no relay).
        {
          id: 'private-dm', kind: 'toggle', scope: 'circle', policyField: 'privateDm',
          labelKey: 'circle.settings.privateDm', hintKey: 'circle.settings.privateDm_hint',
          disabledHintKey: 'circle.settings.privateDm_disabled',
          enabledWhen: 'relayRoute',
        },
      ],
      surfaces: {
        slash: { command: '/settings' },
        chat:  { hint: 'open Settings in a side panel' },
        // localisation passthrough (D consumer-switch): the
        // running Settings surface (renderCircleSettings) derives its
        // header label from renderWeb(manifest).pages[].labelKey via
        // t(), instead of a hardcoded tr('circle.settings.title') call.
        // `title` stays as the English fallback for consumers without a
        // t() (renderWeb's Page.title passthrough).
        page:  { kind: 'side-panel', title: 'Settings', labelKey: 'circle.settings.title' },
      },
    },

    /**
     * `/block <peer>` — block a peer.  Accepts NKN address, pubKey,
     * webid, or stableId — when identityResolver is wired, the block
     * fans out across all aliases (one webid blocks every device).
     * Persisted across reloads.
     *
     * Slash dedup (2026-06-19): renamed `/mute` → `/block` so it no longer
     * collides with stoop's `/mute` (a LOCAL, hide-only mute that does NOT
     * block). `/block` is also the accurate verb — this drops the peer's
     * messages AND refuses to send. The op id stays `mute` (skill + its
     * "muted" wording unchanged), so only the user-facing command moved.
     */
    {
      id:    'mute',
      verb:  'add',
      params: [
        { name: 'peer', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/block', body: 'argline' },
        chat:  { reply: 'text', hint: 'block a peer (drops their messages + refuses to send)' },
      },
    },

    /**
     * `/unblock <peer>` — remove a peer from the block set.  Use the
     * same identifier you blocked with (NKN addr / pubKey / webid).
     */
    {
      id:    'unmute',
      verb:  'add',
      params: [
        { name: 'peer', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/unblock', body: 'argline' },
        chat:  { reply: 'text', hint: 'remove a peer from the block set' },
      },
    },

    /**
     * `/blocked` — list everyone in the block set.
     */
    {
      id:    'muted',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/blocked' },
        chat:  { reply: 'text', hint: 'list blocked peers' },
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
     * `/signout` — v0.7.. Clears the local OIDC session.
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

  /**
   * Nav-chrome (D / Surface 1) — the top-level TAB BAR.  These four tabs
   * (screens · circles · contacten · mij) WERE hardcoded IDENTICALLY in
   * both shells (web `web/v2/circleTabBar.js` + mobile
   * `src/screens/v2/CircleTabBar.js`) — invariant #3 violated by
   * construction (same ids + same locale keys in two files).  Declared
   * ONCE here, the shells project the bar from `renderWeb(manifest).tabs`
   * (via `src/v2/tabProjection.js`) so web ≡ mobile by construction.
   *
   *   screens · circles · contacten — app-nav roots that map to NO op
   *     (the shell owns the surface): `target: {kind:'nav', to}`.
   *   mij — the existing `me` op (its `surfaces.page` already backs the
   *     "Mij" profile screen): `target: {kind:'op', opId:'me'}`.
   *
   * Ids + locale keys preserved EXACTLY (screens/circles/contacten/mij ·
   * circle.tab.*), so behaviour is unchanged.
   */
  tabs: [
    { id: 'screens',   labelKey: 'circle.tab.screens',   target: { kind: 'nav', to: 'screens' } },
    { id: 'circles',   labelKey: 'circle.tab.circles',   target: { kind: 'nav', to: 'circles' } },
    { id: 'contacten', labelKey: 'circle.tab.contacten', target: { kind: 'nav', to: 'contacten' } },
    { id: 'mij',       labelKey: 'circle.tab.mij',       target: { kind: 'op',  opId: 'me' } },
  ],

  /**
   * Nav-chrome (D / Surface 2) — the circle DETAIL ACTION BAR + the live circle
   * ⋯ overflow menu.  These sibling-screen buttons WERE hand-written and had
   * DIVERGED across THREE places: web detail bar (`circleDetail.js`
   * `.circle-detail__bar`), the LIVE web circle menu (`circleView.js`'s
   * hardcoded `MORE_ITEMS`), and the mobile (`CircleLauncherScreen.js`
   * `CircleDetail` ⋯-menu).  Same drift the tab bar killed (invariant #2/#3, by
   * construction the roster lived in multiple files).  Declared ONCE here; all
   * consumers project the bar/menu from `renderWeb(manifest).actions` via the
   * shared `circleActions` selector (`src/v2/actionProjection.js`), so the
   * web live menu ≡ mobile menu ≡ detail bar by construction.
   *
   * Targets: most destinations are shell-owned nav screens (the shell owns the
   * surface, no op backs them) → `{kind:'nav', to}` app-nav roots, exactly like
   * the screens/circles/contacten tabs.  `settings` reuses the existing
   * `settings` op (its `surfaces.page` side-panel) → `{kind:'op', opId:'settings'}`.
   *
   * ORDER mirrors the live web circle menu (the surface users see): back is FIRST
   * (the detail-bar back button; both ⋯ menus filter it out — the shells render
   * back as a header affordance, not a menu row), then the web menu order
   * invite · settings · lists · contacts · override · viewAs · advisor · skills ·
   * files · rules · recipes · admin, then the mobile-only `share`.
   *
   * Gating (`requires`) carries the EXISTING feature-flag gates verbatim
   * (`isFeatureEnabled(policy, …)`, OR semantics), NOT the finer capability
   * matrix — those keys are what the shells gate on today, so behaviour is
   * byte-for-byte preserved.  This is now the SINGLE feature gate (the web
   * shell's `showCircle` no longer recomputes it).  `platforms` DECLARES a
   * platform gap so it lives in the manifest, not a divergent hardcoded list:
   * `share` is mobile-only (no web CircleShareScreen yet — see
   * circle.share.screen_title locale doc).  `invite` + `contacts` exist on BOTH
   * platforms (each shell wires its own mechanism as the callback — web
   * showCircleInvite / openCircleScreenPanel, mobile openCircleInvite /
   * setScreenPanel — the doorgeefluik model), so neither is platform-flagged.
   *
   * A menu item shows iff (a) its `requires` gate passes for the policy AND
   * (b) the host wired a callback for its id (web `more[id]`, mobile handler) —
   * so a shell that has no screen for a destination simply omits the callback.
   *
   * Ids + locale keys preserved EXACTLY (the ones the hand-written rosters used).
   */
  actions: [
    { id: 'back',     labelKey: 'circle.back',                 target: { kind: 'nav', to: 'back' } },
    { id: 'invite',   labelKey: 'circle.invite.menu',          target: { kind: 'nav', to: 'invite' } },
    { id: 'settings', labelKey: 'circle.settings.title',       target: { kind: 'op',  opId: 'settings' } },
    { id: 'lists',    labelKey: 'circle.lists.title',          target: { kind: 'nav', to: 'lists' } },
    { id: 'contacts', labelKey: 'circle.screen.open.contacts', target: { kind: 'nav', to: 'contacts' } },
    { id: 'override', labelKey: 'circle.override.title',       target: { kind: 'nav', to: 'override' } },
    { id: 'viewAs',   labelKey: 'circle.viewAs.title',         target: { kind: 'nav', to: 'viewAs' },   requires: ['memberDirectory'] },
    { id: 'advisor',  labelKey: 'circle.advisor.title',        target: { kind: 'nav', to: 'advisor' } },
    { id: 'skills',   labelKey: 'circle.offerings.editor_title',  target: { kind: 'nav', to: 'skills' } },
    { id: 'files',    labelKey: 'circle.folio.title',          target: { kind: 'nav', to: 'files' },    requires: ['lists', 'notes'] },
    { id: 'rules',    labelKey: 'circle.rules.title',          target: { kind: 'nav', to: 'rules' },     requires: ['houseRules'] },
    { id: 'recipes',  labelKey: 'circle.recipe.editor.book_title', target: { kind: 'nav', to: 'recipes' } },
    { id: 'admin',    labelKey: 'circle.admin.title',          target: { kind: 'nav', to: 'admin' } },
    { id: 'governance', labelKey: 'circle.governance.title',   target: { kind: 'nav', to: 'governance' } },
    { id: 'share',    labelKey: 'circle.share.screen_title',   target: { kind: 'nav', to: 'share' },     platforms: ['mobile'] },
  ],
};

export default basisManifest;
