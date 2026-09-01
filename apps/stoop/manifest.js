/**
 * stoop — app manifest (DRAFT, 2026-05-20).
 *
 * Authored per `PLAN-gui-chat-uplift.md` — owner-locked
 * direction is **slash-only first, then evaluate LLM tool-calling on
 * top**.  Every user-facing op declares both `surfaces.slash.command`
 * (the live D.1 surface) and `surfaces.chat.hint` (forward-compat
 * declaration for the D.2 LLM tool-calling layer; no LLM integration
 * in D.1).
 *
 * Op set (~14): mined from `src/skills/index.js` via
 * `Project Files/projects/audit-stoop-folio-surfaces.md`'s "primary flows" recommendation.
 * Stoop has 110 `defineSkill()` definitions in total; this manifest
 * deliberately surfaces only the chat/slash-callable core
 * (post + browse + claim + lifecycle + moderation + profile).
 *
 * Admin-only flows (`createGroupV2`, `editGroupRules`, `removeMember`,
 * `rotateMyGroupCode`, `postAnnouncement`) and plumbing
 * (`encryptedBackup`, `getMnemonicOnce`, `startPodSignIn`, attachments,
 * push subscription, contact-QR exchange, …) stay un-manifested in D.1
 * — they are not slash-natural and the chat surface doesn't need
 * them.  They can be added in a follow-on D.x slice if the LLM layer
 * (D.2) wants tool-call access.
 *
 * F-SP1-a — every stoop itemType is app-local (`ask`/`offer`/`lend`/
 *           `report`/`group-rules`/`rules-accept`/`group-leave`/
 *           `request`) — none are canonical in `@onderling/item-types`.
 *           Permitted by `validateManifest`.
 * F-SP1-e — non-canonical verbs used here: `report`, `mute`, `set`,
 *           `tree`.  Each is annotated inline.
 *
 * Slash-grammar choice: bare names selected to **minimise collisions
 * with household's `/add /list /done /remove /help /task /tasks
 * /claim /register`**.  Stoop's commands are bulletin-/peer-prefixed
 * (`/post`, `/bulletin`, `/mine`, `/respond`, `/lend-assign`,
 * `/lend-return`, …).
 *
 * Owner DECIDE markers resolved 2026-05-21 (this commit) — see commit
 * message for the resolution table.  Naming choices favour English
 * (open-source convention); Dutch synonyms (`buurt`, `noticeboard`,
 * `mijn`, `reageer`, `intrekken`, `teruggebracht`, …) are kept as
 * `match.verbs` aliases.
 *
 * Hints come verbatim from each `defineSkill({description})` string
 * (one source — no fresh prose).  Where the description was terse,
 * a brief clarifier is added in parens.
 *
 * Complex array/object params (`embeds`, `targets`, `attachments`,
 * `skills[]`, `rules{}`) are intentionally NOT modelled in the slash
 * surface — slash is line-oriented.  They remain reachable via the
 * skill registry directly (web/mobile forms today; LLM tool-calls in
 * D.2).  This mirrors the tasks-v0 V0 approach.
 *
 * `surfaces.slash.match` is provided for ops whose body is a single
 * scalar (text/itemId/reason); ops requiring two-arg bodies
 * (`assignLend({itemId, borrowerWebid})`,
 * `setPeerReveal({peerWebid, showDisplayName})`) declare the slash
 * `command` only (no `match` parser); they remain reachable as
 * pure-command shells that surface the form / picker in the consumer.
 *
 * `surfaces.slash` is INTENTIONALLY present without a fully wired
 * `match` block for every op in this DRAFT — the renderSlash matcher
 * tolerates `command`-only entries (used purely for the
 * setMyCommands menu listing); per-op characterization corpus + match
 * filling will land in the D.1 follow-up commit per
 * PLAN-gui-chat-uplift.md.
 */

const STR_NONEMPTY = { schema: { minLength: 1 } };
const ID_NONEMPTY  = { schema: { minLength: 1 } };

// Stoop's full item-type vocabulary. The canonical registry is `@onderling/item-types`; this
// list is the manifest's declaration of which of those types this app deals in.
// All app-local — none are canonical in `@onderling/item-types` (F-SP1-a).
const ITEM_TYPES = [
  'ask',
  'offer',
  'lend',
  'report',
  'group-rules',
  'rules-accept',
  'group-leave',
  'request',  // legacy V0 — preserved for back-compat
  // ── Part G dissolve (2026-06-17) — app-local types the chat-shell
  //    ops folded in from the former mockStoopManifest reference.
  //    Non-canonical (F-SP1-a); permitted by validateManifest.
  //  - 'post'    — the chat-shell vocabulary for a noticeboard item.  The
  //    listOpen/listFeed reply adapter maps the substrate's canonical
  //    ask/offer/lend/request rows to `type:'post'` (realAgent.js
  //    adaptStoopReply), and respondToItem/markReturned/dispute gate
  //    on `type:'post'`; the `feed` view renders it.
  //  - 'contact' — the ContactBook graph (listContacts / addContact /
  //    removeContact / setContactTrust / startDm appliesTo + the
  //    `contacts` view).
  //  - 'member'  — circle roster rows (listGroupMembers appliesTo + the
  //    [DM] row button via startDm's `['contact','member']` gate).
  'post',
  'contact',
  'member',
];

// The trio that renders on the noticeboard (ask / offer / lend) — used as
// the enum for `postRequest({intent})` and `listOpen({intent})`.
const NOTICEBOARD_INTENTS = ['ask', 'offer', 'lend'];

/** @type {import('@onderling/app-manifest').__types__} */
export const stoopManifest = {
  app:       'stoop',
  itemTypes: ITEM_TYPES,

  // B · Layer 1 — domain (non-atom) verbs: moderation (`report`/`mute`),
  // profile/config (`set`), and circle-graph traversal (`tree`).
  // All other ops map to SDK atoms; the `{atoms:true}` validator enforces it.
  domainVerbs: ['report', 'mute', 'set', 'tree'],

  // B · Layer 1 — DECLARED-AUTHORITATIVE (verb × noun) capability surface (docs/decisions.md 2026-07-02;
  // PLAN-capability-arc §1a). This declaration IS the member-facing capability set — a broad `appliesTo` can no
  // longer mint phantom capabilities (this is what kept the internal itemTypes report/group-rules/rules-accept
  // OUT after the cancelRequest narrowing). Equals the current derived set (inert), now explicit + owned here.
  // Keys ∈ itemTypes; atoms are CANONICAL SDK atoms. NB `group-leave` (leaveGroup=remove) is an awkward-but-real
  // gated capability — to make leaving UNgated instead, reclassify leaveGroup to a domain verb (a curation
  // decision, not done here to stay inert).
  nouns: {
    post:          { atoms: ['add', 'list', 'claim', 'remove'] },
    ask:           { atoms: ['remove'] },
    offer:         { atoms: ['remove'] },
    lend:          { atoms: ['complete', 'reassign', 'remove'] },
    request:       { atoms: ['remove'] },
    'group-leave': { atoms: ['remove'] },
    contact:       { atoms: ['add', 'list', 'remove', 'submit'] },
    member:        { atoms: ['add', 'list'] },
  },

  operations: [
    // ── Post + browse ───────────────────────────────────────────────
    {
      id:   'postRequest',
      // `circleScoped` — the op acts on the ACTIVE circle's items: a write gets the circle injected (and
      // its `text` sealed for a sealed circle), a list is filtered to it. Declared here, derived
      // everywhere (`circleStoopScope.js`); an op that acts on an item without saying so fails a guard.
      circleScoped: true,
      verb: 'add',
      // No `appliesTo.type` — postRequest dispatches across ask/offer/
      // lend based on the `intent` arg, so it spans three types.
      params: [
        // Part G dissolve (2026-06-17) — `text` is the FIRST required
        // param so the `/post <text>` body (the folded-in mock gate uses
        // `body: 'text-only'` / `body: 'flags'`) binds the post text via
        // `_match`.  `intent` is OPTIONAL: the substrate's
        // `intentToCanonicalDraft(a.intent, a.kind)` defaults a missing
        // intent (→ canonical type 'request'), so a bare `/post "milk"`
        // posts without an explicit ask/offer/lend choice — matching the
        // former mockStoopManifest behaviour the journeys tests pin.
        { name: 'text',   kind: 'string', required: true, ...STR_NONEMPTY },
        // `intent` picks one of {ask, offer, lend}; the skill translates
        // this to canonical {type, kind} via `intentToCanonicalDraft`.
        { name: 'intent', kind: 'enum', of: NOTICEBOARD_INTENTS, required: false },
        // Optional lend-only field (epoch-ms due date).
        { name: 'dueAt',  kind: 'number' },
        // Optional skill tag the post requires/offers (single string;
        // the underlying skill accepts an array via `requiredSkills`
        // but the slash surface is scalar-only — see header).
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  {
          hint: 'Post an item (ask/offer/lend) and broadcast it; returns immediately. Pass `expectClaims > 0` to wait for claims.',
          followUps: [
            // demo — same-app follow-up: after posting, suggest viewing
            // the feed.  Folded in from the former mockStoopManifest.
            { opId: 'listFeed' },
          ],
        },
        // Part G dissolve (2026-06-17) — `/post` is declared in BOTH the
        // real stoop manifest and the former mock chat-shell reference.
        // Kept the RICHER mock gate (more verbs: EN post/ask/borrow + NL
        // vraag/plaats/leen/bied-aan + dropTrailing) with `body: 'flags'`
        // (so a literal `/post <text>` lands the whole body as the post
        // text, and `--intent=ask` parses as a flag).  PARAM vocab is the
        // REAL skill's (`intent`, enum ask|offer|lend) — the substrate's
        // `intentToCanonicalDraft(a.intent, a.kind)` is the value-map; no
        // shell-side kind→intent bridge needed.  Bare 'share'/'deel'
        // belong to folio.shareFolder (collision), so they're NOT verbs
        // here; the post `intent` flag stays slash/LLM-only.
        slash: {
          command: '/post',
          shape:   '/post <ask|offer|lend> <text>',
          body:    'flags',
          match: {
            verbs:   ['post', 'ask', 'borrow', 'vraag', 'plaats', 'leen', ['bied', 'aan']],
            body:    'text-only',
            dropTrailing: ['to', 'aan', 'op', 'in', 'voor'],
          },
        },
      },
    },
    {
      id:   'listOpen',
      circleScoped: true,
      verb: 'list',
      // listOpen spans the three noticeboard types — no appliesTo.type
      // narrowing (same as postRequest).
      params: [
        // Optional filter — the underlying skill accepts both.
        { name: 'intent', kind: 'enum', of: NOTICEBOARD_INTENTS },
        { name: 'skill',  kind: 'string' },
      ],
      surfaces: {
        chat:  {
          hint:  'List open requests; optional `skill` + `intent` filters.',
          // stoop's slot in the morning brief. /brief fans
          // across apps that declare `surfaces.chat.brief`; the
          // `stoop_briefSummary` skill (defined in skills/index.js)
          // returns a count of open posts + the topmost rows.
          brief: { summarySkill: 'stoop_briefSummary', order: 30, label: 'Circle' },
        },
        slash: {
          // Resolved 2026-05-21 (owner): `/bulletin` (EN — open-source
          // convention).  `/list` would collide with household.listOpen;
          // `/bulletin` is collision-free and the English equivalent of
          // the in-app term "noticeboard"/"buurt".
          //
          // Part C gate audit (folded in from the former mockStoopManifest
          // at the Part G dissolve, 2026-06-17) — REMOVED the gate `match`:
          // its `body: 'type-only'` mapped against a nonexistent `type`
          // param (this op's enum is `intent`) with no typeAliases — a
          // mis-wired gate.  This is a list op; the literal `/bulletin`
          // slash (+ screen) stays, the NL gate is dropped.
          command: '/bulletin',
          shape:   '/bulletin [ask|offer|lend]',
        },
      },
    },
    {
      id:   'listMyRequests',
      circleScoped: true,
      verb: 'list',
      params: [],
      surfaces: {
        chat:  { hint: 'List open requests posted by the calling actor.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/mine` (EN).  Collision-free
          // with household.  NL alias `mijn` kept as a match verb.
          command: '/mine',
          match:   { verbs: ['mine', 'mijn'], body: 'none' },
        },
      },
    },

    // ── Negotiate / chat ────────────────────────────────────────────
    {
      id:        'respondToItem',
      circleScoped: true,
      verb:      'claim',  // canonical — `respondToItem` soft-claims the post.
      // Part G dissolve (2026-06-17) — the former mock declared this op
      // WITHOUT a slash command but WITH a richer surface: an `appliesTo`
      // gate (so the [Help with] row button surfaces on open feed posts),
      // an NL gate `match` ("help with X" / "ik help X"), a `pickerSource`
      // for label→id resolution, and a required `body` (so [Help with]
      // triggers form-elicitation for the message).  The real manifest
      // declared the `/respond` command.  Merged here: real's `/respond`
      // command KEPT + the mock's gate match + pickerSource + Help-with
      // button folded in.  No command collision (real `/respond`, mock
      // had none).
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listFeed' } },          // label→id resolution
        { name: 'body',   kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Open a chat thread on a post + send the first message; soft-claims the post.' },
        slash: {
          // `/respond <itemId> <message>` literal shell + the folded-in
          // NL gate.  PARTIAL gate: `arg: 'itemId'` binds the post by
          // label; `body` ("what help?") is then form-elicited.
          command: '/respond',
          shape:   '/respond <itemId> <message>',
          match: {
            verbs: [['help', 'with'], ['respond', 'to'], 'offer', ['ik', 'help'], ['help', 'met'], ['reageer', 'op'], ['bied', 'hulp']],
            body:  'match',
            arg:   'itemId',
          },
        },
        // appliesTo-gated row button on /feed posts.  Click → form
        // prompts for body, then dispatches.
        ui: { control: 'button' },
      },
    },
    {
      id:        'cancelRequest',
      circleScoped: true,
      verb:      'remove',  // canonical — cancelRequest removes the item.
      // (2026-05-21, narrowed 2026-07-02 for) — cancelRequest spans the
      // user's own POST types (ask/offer/lend + the generic request/post the `mine`
      // section renders as).  It surfaces as `itemActions[]` in each of those sections
      // (renderWeb's rule); without an `appliesTo` it surfaced nowhere and mine.html
      // hard-coded Cancel.  Was `type: '*'` (ALL itemTypes) — but that blasted a phantom
      // `remove` capability onto stoop's internal/view-shape types (report · group-rules ·
      // rules-accept · group-leave), cluttering the B freedom matrix AND spuriously adding
      // a Cancel button to the read-only privacy section.  Scoped to the real content nouns
      // (same lesson as #79: an over-broad appliesTo mints phantom (verb×noun) capabilities).
      appliesTo: { type: ['request', 'post', 'ask', 'offer', 'lend'] },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Cancel an open request.' },
        slash: {
          // Resolved 2026-05-21 (owner): `/withdraw` (EN — clearer
          // mental model: "withdraw my post").  `/cancel` is too
          // generic; `/remove` collides with household.
          //
          // Part C cross-app collision resolution (folded in at the Part G
          // dissolve, 2026-06-17 — this op now reaches the circle gate via
          // mockStoopManifest): the bare `cancel` token is OWNED by
          // calendar.cancelEvent ("cancel event/appointment X"); stoop
          // DROPS it here (loser-drops-the-bare-token, same as
          // share→folio / accept→calendar).  stoop keeps `withdraw` +
          // the NL aliases.
          command: '/withdraw',
          match: {
            verbs:   ['withdraw', 'intrekken', 'annuleer'],
            body:    'match',
            onEmpty: { skillId: 'cancelRequest', args: {} },
          },
        },
        ui: { control: 'button' },
      },
    },

    // ── Lend lifecycle ──────────────────────────────────────────────
    {
      id:        'assignLend',
      circleScoped: true,
      verb:      'reassign',  // canonical — assigns the borrower.
      appliesTo: { type: 'offer', kind: 'lend' },
      params: [
        { name: 'itemId',        kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'borrowerWebid', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Assign a lent item to a borrower without closing it.' },
        slash: {
          // Collision-free vs household (`/claim` is theirs).  Stoop-
          // specific verb name.  No `match`: two-arg body.
          //
          // Shell-only by design (2026-05-27 audit close-out): two-arg
          // positional slash → always needsForm at resolveDispatch.
          // The consumer's composer surfaces the form/picker UI; slash
          // bodies are line-oriented and can't bind two positional
          // args cleanly.  Same pattern setPeerReveal uses.
          command: '/lend-assign',
          shape:   '/lend-assign <itemId> <borrower-webid>',
        },
      },
    },
    {
      id:        'markReturned',
      circleScoped: true,
      verb:      'complete',  // canonical — marks the lend complete.
      appliesTo: { type: 'offer', kind: 'lend' },
      params: [
        // Part G dissolve (2026-06-17) — `/lend-return` was declared in
        // BOTH manifests.  PARAM is the REAL skill's `requestId` (the
        // former mock declared `itemId` + a realAgent itemId→requestId
        // bridge; that redundant bridge is now REMOVED — the manifest
        // declares the real param directly).  pickerSource carried over
        // from the mock so bare `/lend-return` surfaces a clickable list.
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listFeed' } },
      ],
      surfaces: {
        chat:  { hint: 'Mark a lend item as returned; cancels its return reminder.' },
        // Richer mock gate kept (extra `['mark','returned']` verb +
        // `arg`-bind + `onEmpty`); `arg` re-pointed to the real param
        // `requestId`.  `/lend-return` (EN — domain-prefixed makes it
        // unambiguous in a multi-app host).  `done` collides w/ household.
        slash: {
          command: '/lend-return',
          match: {
            verbs:   ['returned', 'teruggebracht', 'terug', ['mark', 'returned']],
            body:    'match',
            arg:     'requestId',
            onEmpty: { skillId: 'markReturned', args: {} },
          },
        },
        ui: { control: 'button' },
      },
    },

    // ── Moderation ──────────────────────────────────────────────────
    {
      id:   'reportPost',
      circleScoped: true,
      verb: 'report',  // F-SP1-e: non-canonical.  Resolved 2026-05-21
                       // (owner): kept `report` (truer to intent).
                       // Squeezing into canonical `add` would obscure
                       // the action's nature.
      appliesTo: { type: 'report' },
      params: [
        // Part G dissolve (2026-06-17) — `/report` was in BOTH manifests;
        // the former mock added a `pickerSource` (label→id) + a row button.
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY,
          pickerSource: { listOp: 'listFeed' } },
        { name: 'reason', kind: 'string', ...STR_NONEMPTY },  // optional but if present must be non-empty
      ],
      surfaces: {
        chat:  { hint: 'File a report on another item; visible to admins of the group.' },
        slash: {
          // Collision-free.  No NL synonym in V0; UI calls it
          // "rapporteer".
          command: '/report',
          match: {
            verbs:   ['report', 'rapporteer', 'flag'],
            body:    'match',
            onEmpty: { skillId: 'reportPost', args: {} },
          },
        },
        ui: { control: 'button' },
      },
    },
    // ── Profile / reveals ───────────────────────────────────────────
    {
      id:   'setMyOfferings',
      verb: 'set',  // F-SP1-e: non-canonical.  This is a profile
                    // mutation — not add/remove/list of an item.
                    // Resolved 2026-05-21 (owner): kept as one
                    // `setMyOfferings` op (vs splitting into addMyOffering +
                    // removeMyOffering).  Slash is line-oriented; "set my
                    // offerings" is the natural user mental model.
                    // Granular `addMyOffering`/`removeMyOffering` already
                    // exist as skills and can be added to a future LLM-
                    // only manifest layer (D.2) if needed.
      params: [
        // Complex param — array of {categoryId, freeTags?,
        // availability?, radius?, status?}.  Slash surface can't
        // express this directly; declared as a string the consumer
        // parses (e.g. JSON-encoded form-submit payload).
        { name: 'skills', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: "Replace the calling actor's offerings array." },
        slash: {
          command: '/offerings',
          shape:   '/offerings <json-array-of-offering-entries>',
        },
      },
    },
    {
      id:   'setPeerReveal',
      verb: 'set',  // F-SP1-e: non-canonical — local-only reveal flag.
      // Part G dissolve (2026-06-17) — `/reveal` was a COLLISION: the real
      // op is `setPeerReveal`; the former mock declared `revealPeer` (a
      // SEMANTIC alias of setPeerReveal via STOOP_OP_ALIAS) on the SAME
      // `/reveal` command.  Resolved by keeping ONE op — `setPeerReveal`
      // — with the RICHER mock `/reveal` slash (`body: 'flags'`, so
      // `/reveal <peer> --action=on` parses the flag).  The `revealPeer`
      // op AND its STOOP_OP_ALIAS entry are DROPPED (the op is gone).
      //
      // PARAMS keep the chat-shell presentation vocab (`peer` + `action`
      // on|off) — the realAgent adapter's `peer→peerWebid` +
      // `action→reveal(boolean)` transforms are KEPT (legitimate
      // presentation→storage mapping, NOT a redundant rename).  The
      // adaptStoopReply branch now keys on `setPeerReveal`.
      params: [
        { name: 'peer',   kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
      ],
      surfaces: {
        chat:  { hint: 'reveal (or hide) a peer\'s real name' },
        slash: {
          command: '/reveal',
          shape:   '/reveal <peer-webid> [on|off]',
          body:    'flags',
        },
      },
    },

    // ── Groups ──────────────────────────────────────────────────────
    {
      id:   'leaveGroup',
      circleScoped: false,
      verb: 'remove',  // canonical — leaving is a removal of self.
      appliesTo: { type: 'group-leave' },
      params: [
        { name: 'groupId',     kind: 'string',  required: true, ...ID_NONEMPTY },
        { name: 'deletePosts', kind: 'boolean' },  // default false server-side
      ],
      surfaces: {
        chat:  { hint: "Record group-leave audit + optionally delete the actor's own items." },
        slash: {
          command: '/leave-group',
          shape:   '/leave-group <groupId> [--delete-posts]',
          // `body: 'flags'` so chat-layer flags (`--confirm=true`,
          // `--delete-posts`) parse into `args.confirm` / `args
          // .deletePosts`.  realAgent.js short-circuits with an
          // 'irreversible' error unless `confirm:true` is also passed
          // (line 951) — without `body: 'flags'` the user can't reach
          // that gate through pure slash.  2026-05-27 slash audit.
          body: 'flags',
        },
      },
    },

    // ── Read-only graph walk ────────────────────────────────────────
    {
      id:   'getItemTree',
      circleScoped: false,
      verb: 'tree',  // F-SP1-e: non-canonical.  `list` doesn't fit
                     // (this returns a tree, not a flat list);
                     // `tree` is a domain-natural read-only verb.
      params: [
        { name: 'itemId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: "Walk an item's embeds/deps tree, materialising cross-pod refs (Phase 3.3c decentralised read path)." },
        slash: {
          // Collision-free.  Read-only.
          //
          // Part C gate audit (folded in from the former mockStoopManifest
          // at the Part G dissolve, 2026-06-17) — REMOVED the gate `match`:
          // `/tree` is a debug tree-walk, not an NL user command, and the
          // `body: 'match'` dropped the label.  Literal `/tree` stays; the
          // NL gate is dropped (so "tree the item" falls to the LLM).
          command: '/tree',
        },
      },
    },

    // ── Pod session ─────────────────────────────────────────────────
    // adoption (2026-05-21). signOutOfPod disconnects the
    // OIDC session from the user's Solid pod.  No appliesTo — same
    // pattern as listMyRequests (session-scoped, not per-item).
    {
      id:   'signOutOfPod',
      verb: 'remove',  // canonical — signing out is removal of session.
      params: [],
      surfaces: {
        chat:  { hint: 'Sign out of the current Solid pod session.  Mid-sync state may be dropped; the user can sign back in any time.' },
        slash: {
          // Collision-free with household's /add /list /done /remove
          // /help /task /tasks /claim /register.  Action verb at the
          // session scope.
          //
          // Part C gate audit (folded in from the former mockStoopManifest
          // at the Part G dissolve, 2026-06-17) — REMOVED the gate `match`:
          // `body: 'reject'` is NOT a valid renderSlash body kind (it
          // throws "unknown body kind" when the circle gate projects every
          // op's match).  Sign-out is a session op, not an NL one-liner.
          // Literal `/sign-out` + the confirm-gated button stay; the NL
          // gate is dropped (so "sign-out" falls to the LLM).
          command: '/sign-out',
        },
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

    /* ═══════════════════════════════════════════════════════════════
     * Part G dissolve (2026-06-17) — chat-shell ops folded in from the
     * former `mockStoopManifest` (apps/basis/src/core/manifests/
     * mockManifests.js), which is now a re-export of THIS manifest.
     * These were the chat-shell's slash/gate surface for the SAME real
     * stoop skills; co-locating them here makes the one manifest the
     * single source of truth (no mock↔real drift).  Each op's substrate
     * handler is real (110 stoop skills); the realAgent.js `appOrigin
     * === 'stoop'` adapter bridges chat vocab → skill vocab where
     * needed (semantic aliases + value/i18n transforms).
     * ═══════════════════════════════════════════════════════════════ */

    // ── Thin ALIASED ops (dispatch via STOOP_OP_ALIAS in realAgent.js) ──
    // These carry a DISTINCT slash command from their real target, so
    // they don't double-handle.  Same pattern tasks uses for getMyTasks.
    /**
     * `/feed` → listFeed → (alias) listOpen.  `src/followUps.js` +
     * `circleStoopScope.SCOPED_LIST_OPS` reference `listFeed` by name,
     * and `adaptStoopReply` has a `listFeed` reply branch — so this op
     * id is load-bearing and stays as a thin alias of listOpen.
     */
    {
      id:   'listFeed',
      circleScoped: true, verb: 'list',
      appliesTo: { type: 'post' },
      params: [],
      surfaces: {
        slash: { command: '/feed' },
        chat:  { reply: 'list', hint: "list your circle's feed" },
        // S6.B — the morning brief + /find decls for listFeed
        // are re-attached post-hoc in mockManifests.js (mirrors how the
        // folio brief/search attach there) to keep this file declarative.
      },
    },
    /**
     * `/stoop-profile` → getStoopProfile → (alias) getMyProfile.
     * `adaptStoopReply` keys its profile-record branch on
     * `getStoopProfile`, so the op id stays.
     */
    {
      id:   'getStoopProfile', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/stoop-profile' },
        chat:  { reply: 'record', hint: 'show your stoop profile (handle + reveals)' },
      },
    },

    // ── DM (button-only alias of basis's startDm) ──────────────
    /**
     * per-row [DM] button on contact + member rows. No
     * substrate dispatch — onButtonTap intercepts + routes to
     * ensureDmThread.  appliesTo gate kept here where 'contact'/'member'
     * itemTypes are declared.
     */
    {
      id:   'startDm', verb: 'add',
      appliesTo: { type: ['contact', 'member'] },
      params: [{ name: 'webid', kind: 'string', required: true }],
      surfaces: {
        chat: { reply: 'text', hint: 'open a DM with this peer' },
        ui:   { control: 'button' },
      },
    },

    // ── Holiday mode (A6) ───────────────────────────────────────
    // setHolidayMode / getHolidayMode are real skills; the realAgent
    // adapter translates the chat-shell {on:'on'|'off'} enum → boolean.
    {
      id:   'setHolidayMode', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/holiday-mode' },
        chat:  { reply: 'text', hint: 'toggle holiday mode on/off' },
      },
    },
    {
      id:   'getHolidayMode', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/holiday-status' },
        chat:  { reply: 'record', hint: 'show current holiday-mode state' },
      },
    },

    // ── ContactBook (A4) ────────────────────────────────────────
    // Chat-shell enums are English (EN-first); the realAgent adapter
    // translates EN→NL trust ('known'→'bekend', 'trusted'→'vertrouwd')
    // + `min-trust`→`minTrust` at the boundary.
    {
      id:   'listContacts', verb: 'list',
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
      id:   'addContact', verb: 'add',
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
      id:   'removeContact', verb: 'remove',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
      ],
      surfaces: {
        slash: { command: '/remove-contact' },
        chat:  { reply: 'text', hint: 'remove a contact' },
        ui:    { control: 'button' },
      },
    },
    {
      id:   'setContactTrust', verb: 'submit',
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
    {
      id:   'getContactShareQr', verb: 'list',
      params: [
        { name: 'trust', kind: 'enum', of: ['known', 'trusted'], required: false },
      ],
      surfaces: {
        slash: { command: '/share-my-contact', body: 'flags' },
        chat:  { reply: 'record', hint: 'show your contact-share payload (paste into a QR generator)' },
      },
    },

    // ── Cluster C wizards — customRenderer ──
    {
      id:   'restoreFromMnemonicWizard', verb: 'submit',
      params: [],
      surfaces: {
        slash: { command: '/restore-from-mnemonic' },
        chat:  { hint: 'recover from a saved mnemonic phrase (DESTRUCTIVE)' },
        page:  { kind: 'side-panel', title: 'Restore identity' },
      },
    },
    {
      id:   'conflictDisputeWizard',
      circleScoped: false, verb: 'add',
      // per-bubble action on stoop posts. Slash kept for
      // general-dispute (no postId) + LLM tool-call surface.
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'postId', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/dispute', body: 'flags' },
        chat:  { hint: 'raise a conflict-resolution dispute in your circle' },
        page:  { kind: 'side-panel', title: 'Raise a dispute' },
        ui:    { control: 'button' },
      },
    },
    {
      id:   'postAudienceWizard',
      circleScoped: false, verb: 'add',
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
      id:   'encryptedBackupWizard', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/encrypted-backup' },
        chat:  { hint: 'download a passphrase-encrypted snapshot of your data' },
        page:  { kind: 'side-panel', title: 'Encrypted backup' },
      },
    },
    {
      id:   'createGroupWizard', verb: 'add',
      params: [],
      surfaces: {
        slash: { command: '/create-group' },
        chat:  { hint: 'create a new circle: 5-step wizard' },
        page:  { kind: 'side-panel', title: 'Create circle' },
      },
    },
    {
      id:   'joinGroupWizard', verb: 'add',
      params: [
        { name: 'invite', kind: 'string', required: true },
      ],
      surfaces: {
        slash: { command: '/join-group' },
        chat:  { hint: 'join a circle: open the 3-step rules-gate wizard' },
        page:  { kind: 'side-panel', title: 'Join circle' },
      },
    },

    // ── Circle / group surface (B1 B2) ───────────────────────────
    // V0: single-circle info per agent instance.  realAgent.js
    // auto-injects the configured groupId + synthesizes getCurrentGroup.
    {
      id:   'getCurrentGroup', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/groups' },
        chat:  { reply: 'record', hint: 'show your current circle' },
      },
    },
    {
      id:   'listGroupMembers', verb: 'list',
      appliesTo: { type: 'member' },
      params: [
        // Internal (the rails' binding verifiers): fold the roster from the TRAIL + display cache
        // only, skipping the signed-statement fold — the read the verifiers need, made explicit so
        // verifying a statement never recurses through the very fold that verifies statements.
        { name: 'spineless', kind: 'boolean' },
      ],
      surfaces: {
        slash: { command: '/group-members' },
        chat:  { reply: 'list', hint: 'list members of your circle' },
      },
    },
    {
      id:   'getGroupRules', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/group-rules' },
        chat:  { reply: 'record', hint: 'show your circle\'s rules' },
      },
    },
    {
      // Re-accept the circle's current rules version after a rules change (the member's own signed
      // `rules-accept` on the membership spine). Voluntary: an older acceptance stays valid, visibly
      // stale — the shells offer this from the stale-rules banner, so no slash surface is invented.
      id:   'acceptGroupRules',
      circleScoped: false, verb: 'add',
      // A member's acceptance is SELF-ONLY (the fold ignores anyone else's statement about them) and
      // versions are monotonic, so two of their own devices converge on the causally-later acceptance —
      // content, not a claim: nobody races for exclusive ownership of someone's own consent.
      resolves: [{ field: 'rulesAccepted', policy: 'content' }],
      params: [{ name: 'groupId', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Accept the circle\'s current rules version.' }, ui: { control: 'button' } },
    },

    // ── What you offer ──────────────────────────────────────────────
    // Declared 2026-08-19. These have had handlers all along and the shells have been calling them;
    // nothing declared them, so the manifest was not the contract it is supposed to be (invariant 4)
    // and a typo'd op id resolved to silence. Params are derived from the handlers, not invented.
    // Surfaces are deliberately empty where the shells reach these through their own screens: an op
    // with a screen does not need a slash command invented for it.
    {
      id:   'addMyOffering', verb: 'add',
      // An offering set converges per CATEGORY: two devices adding different categories must both
      // survive, and the same category added twice is one entry. Last write wins WITHIN a category
      // (its free tags), which is content, not a claim — nobody is racing for exclusive ownership.
      resolves: [{ field: 'freeTags', policy: 'content' }],
      params: [
        { name: 'categoryId', kind: 'string', required: true },
        { name: 'freeTags',   kind: 'object', schema: { type: 'array', items: { type: 'string' } } },
      ],
      surfaces: { chat: { hint: 'Add something you can offer to your neighbours, by category id (see listOfferingCategories). Optional free tags.' } , ui: { control: 'button' } },
    },
    {
      id:   'removeMyOffering', verb: 'remove',
      params: [{ name: 'categoryId', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Stop offering a category you had listed.' } , ui: { control: 'button' } },
    },
    {
      id:   'listMyOfferings', verb: 'list',
      params: [],
      surfaces: { chat: { hint: 'List what this person currently offers.' } , ui: { control: 'page' } },
    },
    {
      id:   'listOfferingCategories', verb: 'list',
      // The offering taxonomy with localised labels; `lang` picks the label set.
      params: [{ name: 'lang', kind: 'string' }],
      surfaces: { chat: { hint: 'The offering-category taxonomy with localised labels; pass `lang` for the label set.' } , ui: { control: 'page' } },
    },

    // ── Where you are ───────────────────────────────────────────────
    // Coarse by design: a circle knows roughly where you are, not precisely. `geocode` turns a typed
    // place into coordinates without storing anything — it is the lookup, not the setting.
    {
      id:   'setMyLocation', verb: 'add',
      // One value, so the newest wins. A location is content, not a claim: two devices setting it
      // concurrently is a person moving, not a contest, and either answer is defensible.
      resolves: [{ field: 'location', policy: 'content' }],
      params: [
        { name: 'lat',   kind: 'number', required: true },
        { name: 'lon',   kind: 'number', required: true },
        { name: 'label', kind: 'string' },
      ],
      surfaces: { chat: { hint: "Set this person's coarse location (lat/lon, optional label) — what a circle sees is approximate by design." } , ui: { control: 'button' } },
    },
    {
      id:   'clearMyLocation', verb: 'remove',
      params: [],
      surfaces: { chat: { hint: "Remove this person's stored location entirely." } , ui: { control: 'button' } },
    },
    {
      id:   'getMyLocation', verb: 'list',
      params: [],
      surfaces: { chat: { hint: "Show this person's stored coarse location, if any." } , ui: { control: 'page' } },
    },
    {
      id:   'geocode', verb: 'list',
      params: [{ name: 'query', kind: 'string', required: true }],
      surfaces: { chat: { hint: 'Turn a typed place name into coordinates. A lookup only — it stores nothing.' } , ui: { control: 'button' } },
    },
    {
      id:   'getDataLocation', verb: 'list',
      // Not a place in the world — WHERE THIS PERSON'S BYTES REST (pod vs device). It sits in this
      // group only because the word collides; it answers the my-data screen's "where is my stuff".
      params: [],
      surfaces: { chat: { hint: "Where this person's data actually rests (their pod, or this device) — not a place in the world." } , ui: { control: 'page' } },
    },

    // ── Who you are, per circle ─────────────────────────────────────
    // A handle is per-circle by design: the same person can be "anne" in one circle and "a.dijkstra"
    // in another, and nothing links the two. That is why listMyHandles is plural.
    {
      id:   'setMyHandle', verb: 'set',
      params: [{ name: 'handle', kind: 'string', required: true, ...STR_NONEMPTY }],
      surfaces: {
        chat: { hint: "Set this person's handle in the current circle. Refuses if the handle is taken there." },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'setMyDisplayName', verb: 'set',
      params: [{ name: 'displayName', kind: 'string', required: true, ...STR_NONEMPTY }],
      surfaces: {
        chat: { hint: 'Set the display name others see for this person.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'listMyHandles', verb: 'list',
      params: [],
      surfaces: {
        chat: { hint: 'List the handles this person uses, one per circle they have joined.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getMyProfile', verb: 'list',
      params: [],
      surfaces: {
        chat: { hint: "This person's own profile — handle, display name, offerings, location." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getInterestProfile', verb: 'list',
      // Derived ON THE DEVICE from this person's own reading and posting. It leaves the device only
      // through an explicit disclosure act, never as a side effect of someone reading their profile.
      params: [],
      surfaces: {
        chat: { hint: "The interest profile derived locally from this person's own activity." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'recordMemberPersonaProperties',
      circleScoped: false, verb: 'set',
      // ADMIN side: the circle admin owns the roster, so a member sends their released properties and the
      // admin records them. `memberWebid` comes from the AUTHENTICATED peer address at the call site,
      // never from the payload — a member speaks only for their own row.
      params: [
        { name: 'groupId',           kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'memberWebid',       kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'personaProperties', kind: 'object', required: true },
        { name: 'circleAddress',     kind: 'string' },
      ],
      resolves: [{ field: 'personaProperties', policy: 'content' }],
      surfaces: {
        chat: { hint: "Record a member's released persona properties on the circle roster (admin side)." },
        ui:   { control: 'page' },
      },
    },

    // ── Waking a device ─────────────────────────────────────────────
    // Registration only. WHETHER something may wake you is the recipient's own attention setting,
    // enforced on the device and at the relay; holding a token buys no right to interrupt.
    {
      id:   'subscribeWebPush', verb: 'add',
      params: [{ name: 'subscription', kind: 'object', required: true }],
      resolves: [{ field: 'subscription', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Register a web-push subscription for this device.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'unsubscribeWebPush', verb: 'remove',
      params: [{ name: 'endpoint', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: 'Remove a web-push subscription by endpoint.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'subscribeExpoPush', verb: 'add',
      params: [{ name: 'token', kind: 'string', required: true, ...ID_NONEMPTY }],
      resolves: [{ field: 'token', policy: 'content' }],
      surfaces: {
        chat: { hint: "Register this device's Expo push token (the mobile twin of subscribeWebPush)." },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'unsubscribeExpoPush', verb: 'remove',
      params: [{ name: 'token', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: "Remove this device's Expo push token." },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'getVapidPublicKey', verb: 'list',
      params: [],
      surfaces: {
        chat: { hint: "The relay's VAPID public key, which a browser needs before it can subscribe." },
        ui:   { control: 'page' },
      },
    },

    // ── Where the bytes rest ────────────────────────────────────────
    // The pod is a SHAPE, not a place — a contract any dumb medium can hold, and always ciphertext.
    // These ops say where a circle's bytes rest and let a person carry them off; none of them can
    // read anything, because the medium never holds plaintext.
    {
      id:   'getCircleStoragePolicy',
      circleScoped: false, verb: 'list',
      params: [{ name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: "Where this circle's data rests, and under which storage policy." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'setCircleStoragePolicy',
      circleScoped: false, verb: 'set',
      params: [
        { name: 'groupId',       kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'storagePolicy', kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'groupPodUri',   kind: 'string' },
      ],
      resolves: [{ field: 'storagePolicy', policy: 'content' }],
      surfaces: {
        chat: { hint: "Set where this circle's data rests. An admin decision — it moves everyone's bytes." },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'podSignInStatus', verb: 'list',
      params: [],
      surfaces: {
        chat: { hint: 'Whether this person is signed in to a Solid pod, read-only.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'encryptedBackup', verb: 'list',
      // Returns a SEALED archive. The passphrase never leaves the device and is not stored — losing it
      // loses the archive, which is the point: nobody else can open it either.
      params: [{ name: 'passphrase', kind: 'secret', required: true }],
      surfaces: {
        chat: { hint: "Produce a passphrase-sealed backup of this person's data." },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'restoreFromMnemonic', verb: 'set',
      // Destructive: adopts an identity from a phrase. `confirm` exists so a single stray call cannot
      // overwrite the identity in place.
      params: [
        { name: 'mnemonic', kind: 'secret',  required: true },
        { name: 'confirm',  kind: 'boolean' },
      ],
      surfaces: {
        chat: { hint: 'Restore this person\u2019s identity from a recovery phrase. Requires confirm:true.' },
        ui:   { control: 'button' },
      },
    },

    // ── Reading a circle back ───────────────────────────────────────
    // The catch-up reads. Each is scoped to ONE circle on purpose: you fetch the circle you are in,
    // never a cross-circle view, because a cross-circle read is exactly the re-linking the design refuses.
    {
      id:   'listMyCircles', verb: 'list',
      params: [],
      surfaces: {
        chat: { hint: 'The circles this person has joined.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'listCirclePostsSince', verb: 'list',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'sinceMs', kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Posts in one circle since a timestamp — the bulletin catch-up.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'listCircleChats', verb: 'list',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'sinceTs', kind: 'number' },
        { name: 'limit',   kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Chat messages in one circle, newest first, optionally since a timestamp.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getLatestPostAddedAt', verb: 'list',
      // The cheap "is there anything new" probe — a timestamp, so a poll costs one number rather than a feed.
      params: [{ name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: 'When the newest post in a circle arrived — the cheap freshness probe.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'listConsentingPeers', verb: 'list',
      // Who in this circle has agreed to be reachable for this purpose. Consent is the filter, not
      // membership: being in a circle is not by itself permission to be contacted.
      params: [{ name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: 'Members of a circle who have consented to be reached.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getPrivacyNotice', verb: 'list',
      params: [{ name: 'lang', kind: 'string' }],
      surfaces: {
        chat: { hint: 'The privacy notice text, in the requested language.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getMetrics', verb: 'list',
      // LOCAL counters only — this device's own tallies. Nothing is reported anywhere.
      params: [],
      surfaces: {
        chat: { hint: "This device's own local counters. Nothing here is sent anywhere." },
        ui:   { control: 'page' },
      },
    },

    // ── Joining, leaving, being removed ─────────────────────────────
    // Membership is the SPINE: signed statements every member folds for themselves, not an admin's table.
    // Five of these ops are thin wrappers whose state logic now lives in `@onderling/circles` (the §8c
    // migration, landed); stoop keeps the key-custody seam (`grantKey`/`revokeKey`) and injects it. The
    // params below are the SUBSTRATE's contract for those — read from circles, not guessed from the wrapper.
    {
      id:   'createGroupV2', verb: 'add',
      // Logic: @onderling/circles circleCreate.js
      params: [
        { name: 'groupId',               kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'name',                  kind: 'string' },
        { name: 'rules',                 kind: 'object' },
        { name: 'storagePolicy',         kind: 'string' },
        { name: 'groupPodUri',           kind: 'string' },
        { name: 'inviteExpiresInHours',  kind: 'number' },
        { name: 'inviteMaxRedemptions',  kind: 'number' },
        { name: 'keyRotationMode',       kind: 'string' },
        { name: 'rotationDays',          kind: 'number' },
      ],
      resolves: [{ field: 'membership', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Create a circle you administer, with its rules, storage policy and invite ceiling.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'redeemMembershipCode', verb: 'submit',
      // Logic: @onderling/circles circleMembershipWriters.js. The joiner presents their own per-circle
      // address WITH its proof; an unproven address is dropped at the substrate, never recorded.
      params: [
        { name: 'groupId',             kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'code',                kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'circleAddress',       kind: 'string' },
        { name: 'circleAddressProof',  kind: 'object' },
      ],
      resolves: [{ field: 'membership', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Join a circle by redeeming a membership code.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'verifyMembershipCodeForPeer', verb: 'confirm',
      // Logic: @onderling/circles. The ADMIN half of the peer-bridge join: when a joiner cannot redeem
      // locally, the admin verifies and answers with a statement the joiner mirrors.
      params: [
        { name: 'groupId',             kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'code',                kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'requesterWebid',      kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'circleAddress',       kind: 'string' },
        { name: 'circleAddressProof',  kind: 'object' },
      ],
      resolves: [{ field: 'membership', policy: 'spine' }],
      surfaces: {
        chat: { hint: "Admin side of a peer-bridged join: verify a joiner's code and confirm them." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'recordRemoteRedemption', verb: 'add',
      // The JOINER's local mirror of an admin-confirmed join. Carries both sides' per-circle addresses with
      // their proofs, so the joiner can reach the admin afterwards even with address-fallback off.
      params: [
        { name: 'groupId',                        kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'code',                           kind: 'string' },
        { name: 'codeId',                         kind: 'string' },
        { name: 'confirmedBy',                    kind: 'string' },
        { name: 'confirmedByCircleAddress',       kind: 'string' },
        { name: 'confirmedByCircleAddressProof',  kind: 'object' },
        { name: 'circleAddress',                  kind: 'string' },
        { name: 'circleAddressProof',             kind: 'object' },
        { name: 'peerDisplay',                    kind: 'string' },
        { name: 'expiresAt',                      kind: 'number' },
        { name: 'rules',                          kind: 'object' },
      ],
      resolves: [{ field: 'membership', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Record a join an admin confirmed over the peer bridge (the joiner\u2019s own mirror).' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'acknowledgeCaretaker', verb: 'update',
      // The caretaker signs for the appointment nobody made. When the last admin leaves, the roster
      // fold appoints a successor — derived, so that every device reaches it alone and offline, and
      // therefore silently: nothing recorded that it happened. This is the record.
      //
      // It grants nothing. The fold admits the statement only where it derived the same appointment
      // with the same seed, by which time the signer is already an admin. What it adds is that the
      // circle can see the new custodian KNOWS — an appointment nobody has acknowledged is a circle
      // whose custodian may not have noticed they have it.
      //
      // No `role` or seed parameter on purpose: a caller that could name the appointment it signs
      // for would be choosing one. The device reads the one its own fold reached.
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      // The acknowledgement rides the membership SPINE, like the role change it accompanies: two
      // conflicting statements from one author are a fork-proof, and every device must fold the same
      // answer to "does the person running this circle know that they are".
      resolves: [{ field: 'adminViaAcknowledged', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Confirm that you have seen that this circle is now yours to run.' },
        // A BUTTON, on the notice that tells them. The alternative — the device signing the moment it
        // renders the line — would make "acknowledged" mean "a screen was drawn", and the whole value
        // of the signature is that the circle can see the new custodian KNOWS. So it stays a person's
        // act; until they take it the notice keeps saying so, which for "a circle became yours" is
        // the right kind of persistence rather than nagging.
        ui:   { control: 'button' },
      },
    },
    {
      id:   'setMemberRole', verb: 'update',
      // Promote a member to admin, or demote an admin back to member. The producer for the
      // membership lane's `role` statement kind, which was declared with nothing writing it.
      //
      // The op's own check is the caller's convenience; the BINDING gate is the roster fold, which
      // re-derives on every device whether the author was an admin at that point in the causal
      // chain — so a client that skips the check emits a statement everyone else refuses. The fold
      // also answers a step-down that would empty the admin set by HANDING OVER — appointing a
      // caretaker from whoever is left — rather than by refusing it: a circle with members always
      // has someone who can run it, and a refusal only made the gentler exit the one that failed.
      params: [
        { name: 'groupId',      kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'memberWebid',  kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'role',         kind: 'enum', of: ['admin', 'member'], required: true },
      ],
      // A role is a SPINE fact: equivocation is an attack (two conflicting promotions from one
      // author are a fork-proof), and every device must fold the same answer to who runs the circle.
      resolves: [{ field: 'role', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Admin-only: make a member an admin of this circle, or take that back.' },
        // A BUTTON on the member roster, and a confirm before it runs. The confirm was declared alone
        // for a while, which is a declaration of how to ASK before doing something nobody could do:
        // with no control and no slash command, the only way a person could reach this op at all was
        // to ask the assistant for it in words. Handing someone authority over a circle is
        // consequential and easy to do by accident from a list — hence the same confirm gate the
        // task-scoped grant carries, now in front of a control that exists.
        ui:   { control: 'button', confirm: { severity: 'warn' } },
      },
    },
    {
      id:   'removeMember', verb: 'remove',
      // Logic: @onderling/circles. Admin-only, and NOT just a roster edit — it forces a key rotation and
      // reseal, so a removed member cannot read what comes next. The island guarantee.
      params: [
        { name: 'groupId',         kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'memberWebid',     kind: 'string' },
        { name: 'memberStableId',  kind: 'string' },
        { name: 'reason',          kind: 'string' },
        { name: 'policy',          kind: 'object' },
      ],
      surfaces: {
        chat: { hint: 'Remove a member from a circle. Admin-only; forces a key rotation and reseal.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'listGroupRoster', verb: 'list',
      // Logic: @onderling/circles listCircleRoster — including the foreign-caller gate, so a non-member
      // asking for a roster is refused at the substrate rather than by the caller remembering to check.
      params: [{ name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: "A circle's roster. Refused for a caller who is not in that circle." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'getCurrentMembershipCode', verb: 'get',
      params: [{ name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY }],
      surfaces: {
        chat: { hint: "The circle's current membership code, for sharing an invite." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'rotateMyGroupCode', verb: 'revoke',
      // Rotating INVALIDATES the old code — that is the point, and why it is `revoke` rather than `update`.
      params: [
        { name: 'groupId',               kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'inviteExpiresInHours',  kind: 'number' },
        { name: 'maxRedemptions',        kind: 'number' },
      ],
      resolves: [{ field: 'code', policy: 'spine' }],
      surfaces: {
        chat: { hint: 'Issue a fresh membership code and invalidate the previous one.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'editGroupRules', verb: 'update',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'rules',   kind: 'object', required: true },
      ],
      resolves: [{ field: 'rules', policy: 'content' }],
      surfaces: {
        chat: { hint: "Edit a circle's rules document." },
        ui:   { control: 'page' },
      },
    },
    {
      // The rules-update rider's RECEIVE half: land a peer-carried rules doc as the local mirror
      // head (idempotent by version; the statement's admin authority is verified at the caller).
      id:   'recordGroupRulesUpdate', verb: 'update',
      params: [
        { name: 'groupId',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'rules',     kind: 'object', required: true },
        { name: 'version',   kind: 'number', required: true },
        { name: 'updatedBy', kind: 'string', required: false },
      ],
      resolves: [{ field: 'rules', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Plumbing: record a peer-carried rules update locally (not user-invoked).' },
        ui:   { control: 'none' },
      },
    },
    {
      // The roster-seed rider's local write (pod-less enroll S1): land sibling-served trail rows
      // id-preserved so the roster projection has a head on a trail-less device. Device-set
      // authority is verified at the receiving module; this op guards shape + idempotency.
      id:   'recordRosterSeed', verb: 'update',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'rows',    kind: 'object', required: true },
        { name: 'members', kind: 'object' },
      ],
      resolves: [{ field: 'rows', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Plumbing: land roster-seed rows from a sibling device (not user-invoked).' },
        ui:   { control: 'none' },
      },
    },
    {
      // The rules-update rider's durable-head read: the preserved signed statement the catch-up
      // serves after the governance lane's audit window compacted the entry away.
      id:   'getGroupRulesUpdateStatement', verb: 'get',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Plumbing: read the preserved rules-update statement (not user-invoked).' },
        ui:   { control: 'none' },
      },
    },
    {
      id:   'postAnnouncement',
      circleScoped: true, verb: 'add',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'text',    kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      resolves: [{ field: 'text', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Post an announcement to a circle (admin).' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'whoAmI', verb: 'get',
      params: [],
      surfaces: {
        chat: { hint: 'Who the caller is on this device — webid, stable id, handle.' },
        ui:   { control: 'page' },
      },
    },

    // ── Reaching each other ─────────────────────────────────────────
    {
      id:   'recordPeerIntro', verb: 'add',
      // A peer announcing itself with an address. Recorded, not trusted: the address still has to prove
      // itself against the roster before anything is sent to it.
      params: [
        { name: 'groupId',      kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'peerAddr',     kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'peerDisplay',  kind: 'string' },
      ],
      resolves: [{ field: 'peerAddr', policy: 'content' }],
      surfaces: {
        chat: { hint: "Record a peer's introduction (address + display name) for a circle." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'addContactFromQr', verb: 'add',
      params: [{ name: 'payload', kind: 'object', required: true }],
      resolves: [{ field: 'contact', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Add a contact from a scanned QR payload.' },
        ui:   { control: 'button' },
      },
    },
    {
      id:   'acceptResponder',
      circleScoped: false, verb: 'confirm',
      params: [
        { name: 'requestId',       kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'responderWebid',  kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      resolves: [{ field: 'contact', policy: 'content' }],
      resolves: [{ field: 'acceptedBy', policy: 'claim' }],
      surfaces: {
        chat: { hint: 'Accept one of the people who responded to a request.' },
        ui:   { control: 'button' },
      },
    },

    // ── The circle fan ──────────────────────────────────────────────
    // The send/receive halves of circle-scoped fan-out. `msgId` + `ts` are the dedup pair: replay is normal
    // on a mesh, so every receiver must be idempotent, and these carry what makes that possible.
    // The INGEST ops take `fromPeerAddr` + `fromPubKey` from the AUTHENTICATED envelope, never the payload.
    {
      id:   'broadcastCircleGovernance', verb: 'share',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'event',   kind: 'object', required: true },
        { name: 'msgId',   kind: 'string' },
        { name: 'ts',      kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Fan a governance statement (propose/vote/resolve/rules-update) to a circle.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleKeyStatement', verb: 'share',
      // The group-key lane's fan. Like the other lanes' broadcasts this goes through the circle
      // fan-out core, so the statement leaves under the sender's PER-CIRCLE address — a raw
      // sendPeerMessage signs with the canonical identity, which every receiver refuses inside a
      // circle. `only` narrows the fan to the key-event's recipients, so a member the rotation is
      // sealed away from is not sent a version they could not open anyway.
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'event',   kind: 'object', required: true },
        { name: 'msgId',   kind: 'string' },
        { name: 'ts',      kind: 'number' },
        { name: 'only',    kind: 'object', schema: { type: 'array', items: { type: 'string' } } },
      ],
      surfaces: {
        chat: { hint: 'Fan a signed group-key statement (establish/rotate) to a circle\u2019s current key recipients.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleMembership', verb: 'share',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'event',   kind: 'object', required: true },
        { name: 'msgId',   kind: 'string' },
        { name: 'ts',      kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Fan a membership event to a circle.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleChatStatement', verb: 'share',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'event',   kind: 'object', required: true },
        { name: 'msgId',   kind: 'string' },
        { name: 'ts',      kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Fan a signed chat statement to a circle.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleTask', verb: 'share',
      params: [
        { name: 'groupId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'event',   kind: 'object', required: true },
        { name: 'msgId',   kind: 'string' },
        { name: 'ts',      kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Fan a task statement to a circle.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCirclePolicy', verb: 'share',
      params: [
        { name: 'groupId',    kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'policy',     kind: 'object', required: true },
        { name: 'fromActor',  kind: 'string' },
        { name: 'msgId',      kind: 'string' },
        { name: 'ts',         kind: 'number' },
      ],
      surfaces: {
        chat: { hint: "Fan a circle's policy to its members." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleRules', verb: 'share',
      params: [
        { name: 'groupId',    kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'rulesDoc',   kind: 'object', required: true },
        { name: 'fromActor',  kind: 'string' },
        { name: 'msgId',      kind: 'string' },
        { name: 'ts',         kind: 'number' },
      ],
      surfaces: {
        chat: { hint: "Fan a circle's rules document to its members." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleRecipe', verb: 'share',
      params: [
        { name: 'groupId',    kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'recipe',     kind: 'object', required: true },
        { name: 'fromActor',  kind: 'string' },
        { name: 'msgId',      kind: 'string' },
        { name: 'ts',         kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Fan a circle recipe (a shared template) to its members.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'broadcastCircleAddresses', verb: 'share',
      // Logic: @onderling/circles fanCircleAddresses. The send half of address announcing — each
      // announcement carries its own proof, and the receiver verifies before recording.
      params: [
        { name: 'groupId',        kind: 'string', ...ID_NONEMPTY },
        { name: 'announcements',  kind: 'object', schema: { type: 'array' } },
        { name: 'to',             kind: 'object', schema: { type: 'array', items: { type: 'string' } } },
        { name: 'msgId',          kind: 'string' },
        { name: 'ts',             kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'Announce this device\u2019s per-circle addresses to a circle, each with its proof.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'recordCircleAddressAnnouncement', verb: 'add',
      // Logic: @onderling/circles recordCircleAddress. The RECEIVE half — the proof is verified here and
      // an unproven address is dropped, which is what stops a peer claiming somebody else's address.
      params: [
        { name: 'groupId',             kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'memberWebid',         kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'circleAddress',       kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'circleAddressProof',  kind: 'object', required: true },
        { name: 'personaProperties',   kind: 'object' },
      ],
      resolves: [{ field: 'circleAddress', policy: 'spine' }],
      surfaces: {
        chat: { hint: "Record a member's PROVEN per-circle address. An unproven one is dropped." },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'ingestCircleMessage', verb: 'add',
      params: [
        { name: 'fromPeerAddr', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'fromPubKey',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'payload',      kind: 'object', required: true },
      ],
      resolves: [{ field: 'text', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Ingest a circle message from an authenticated peer.' },
        ui:   { control: 'page' },
      },
    },
    {
      id:   'ingestRemotePost', verb: 'add',
      params: [
        { name: 'fromPeerAddr', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'fromPubKey',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'payload',      kind: 'object', required: true },
      ],
      resolves: [{ field: 'text', policy: 'content' }],
      surfaces: {
        chat: { hint: 'Ingest a bulletin post from an authenticated peer.' },
        ui:   { control: 'page' },
      },
    },
  ],

  // first stoop web page via renderWeb.
  // adopt (2026-05-21) — `dataSource` declares the section's
  // data-fetch skill in the manifest, removing the client special-case.
  // second stoop web page via renderWeb:
  // `privacy.html` (closed-beta disclosure + data-location).  Picked
  // as the smallest read-only page (66 lines) — perfect fit for
  // `view.readOnly: true`.  Contacts (417 lines, heavy mutations) and
  // profile (591 lines, form-heavy) defer to later E.x slices.
  // third stoop web page via renderWeb:
  // `settings.html` (per-device + per-actor preferences).  Picked over
  // profile/contacts as the next-smallest-after-privacy + a clean fit
  // for the existing contract: `getSettings({})` is a param-free
  // dataSource skill (perfect fit) and the per-field mutations
  // (`updateSettings({patch})`, `setHopMode({global})`) live outside
  // the D.1 manifest as profile/plumbing skills (gap #4 territory).
  // Profile (591 lines — avatar resize / mnemonic / geocoding / backup,
  // many runtime-arg skills) and contacts (417 lines, heavy mutations)
  // defer to later E.x slices.
  //
  // Stoop has 16 web pages today (per Project Files/projects/audit-stoop-folio-surfaces.md).
  // After E.3, THREE pages are NavModel-driven (`mine.html`,
  // `privacy.html`, `settings.html`); 13 pages remain hand-built
  // (`index.html` noticeboard, `chat.html`, `contacts.html`,
  // `create-group.html`, `group.html`, `profile.html`, `onboard.html`,
  // `sign-in.html`, `auth-callback.html`, `push.html`, `restore.html`,
  // `welcome.html`, `metrics.html`) and will land in follow-on E.x
  // slices.  Same discipline B.1 used for tasks-v0 (just `dag.html`).
  //
  // The `mine` view's `type: 'request'` is the broadest stoop itemType
  // (legacy V0 — every kind of post canonicalises through it).  The
  // section is conceptually "items I posted", which is a *predicate*
  // over items, not a type — `listMyRequests` filters by addedBy=from
  // (the calling actor) and spans ALL of the user's post types
  // (ask/offer/lend), not just `request`.
  //
  // `dataSource` (locked 2026-05-21) declares this directly:
  // adapters call `fetchSectionItems(section, {callSkill})` which
  // honours `section.dataSource` and dispatches `listMyRequests({})`.
  // Removes the previous client special-case ("if section.id === 'mine'
  // then listMyRequests") — the manifest is now the source of truth.
  //
  // ──── E.2 — privacy view ──────────────────────────
  //
  // `privacy.html` is a closed-beta disclosure page: it renders the
  // privacy-notice sections + a small key/value summary of where the
  // user's data lives.  TRUE read-only — no forms, no mutations —
  // a perfect `readOnly: true` proof-point.
  //
  // The view's `type: 'group-rules'` is a placeholder (closest
  // semantic — privacy is "rules of the system").  It does NOT
  // describe the data the section renders (which is text sections,
  // not group-rules items).  Same pattern mine.html uses with
  // `type: 'request'` — the type is a manifest-shape requirement
  // (validateView pins type ∈ manifest.itemTypes) more than a real
  // descriptor.
  //
  // `dataSource: { skillId: 'getDataLocation' }` declares ONE of the
  // two fetches privacy.html performs.  `getDataLocation` takes no
  // params — perfect fit for `fetchSectionItems`'s static `args ?? {}`
  // contract.  The second fetch (`getPrivacyNotice({lang})`) needs a
  // RUNTIME-derived param (browser language) — the `dataSource`
  // contract is static args only, so the page keeps a direct
  // `callSkill('getPrivacyNotice', {lang})` for that fetch.  This is
  // a substrate gap (logged below) — may add a
  // `dataSource.argsFromContext` mechanism so language-aware skills
  // can be declared too.
  //
  // ──── substrate gaps surfaced by E.2 ─────────────────────────
  //   3. `view.dataSource.args` is STATIC (frozen at manifest-author
  //      time).  Privacy needs a RUNTIME lang param for
  //      `getPrivacyNotice`; no mechanism today to declare "fetch
  //      with browser lang".  Worked around: privacy.html calls
  //      `getPrivacyNotice` directly while the section's declared
  //      dataSource targets `getDataLocation` (param-free).  Logged
  //      as a follow-on — likely `dataSource.argsFromContext:
  //      {lang: '$lang'}` (or similar).
  //   4. `getPrivacyNotice` + `getDataLocation` are not manifest ops
  //      (they're read-only info-skills, not chat/slash-callable per
  //      's primary-flows discipline). `dataSource.skillId`
  //      is a FREE STRING (validate.js doesn't constrain it to
  //      `operations[].id`), so this is permitted but worth flagging:
  //      a manifest-driven page can call skills outside the manifest's
  //      op set. Forward-additive — could add an opt-in cross
  //      check.
  //
  // `readOnly: true` suppresses creative-verb auto-surface (
  // affordances like `register` ops would otherwise appear here).
  // Wildcard itemActions (`cancelRequest`) still surface in this
  // section's `itemActions[]` — the page IGNORES them (privacy
  // renders text sections + key/value rows, not items).
  //
  // ──── E.3 — settings view ──────────────────────────────
  //
  // `settings.html` is a per-actor + per-device preferences page:
  // poll-interval (device), hop-relay (device), online-window (device),
  // broadcastable + defaultShareLocation (shared / per-actor).  Read
  // path = `getSettings({})` — perfect fit for `fetchSectionItems`'s
  // static-args contract.  Mutation paths are the per-field skills
  // (`updateSettings({patch})`, `setHopMode({global})`) — neither is
  // in the D.1 manifest (they're profile/plumbing skills, outside the
  // "primary chat/slash flows" set per D.1 line 14).  Same dataSource-
  // outside-manifest gap #4 territory as privacy.
  //
  // The `settings` view's `type: 'group-rules'` is a placeholder
  // (same pattern privacy uses) — `validateView` pins type ∈
  // manifest.itemTypes, but the section's actual data is a SINGLETON
  // record (settings object), not a list of items. substrate
  // signal: NavModel sections assume `Array<item>`; "singleton-record"
  // views (settings / profile / current-status) don't fit that shape
  // cleanly. See substrate signals below.
  //
  // No `readOnly: true` — the page mutates via the per-field handlers.
  // But because the per-field skills aren't manifest ops, NO creative-
  // verb affordances surface here regardless of the readOnly flag (
  // only auto-surfaces ops with surfaces.ui or add/register verbs).
  // The wildcard `cancelRequest` itemAction surfaces in this section's
  // itemActions[] (rule) — the page IGNORES it (settings renders a
  // singleton record + per-field toggles, not items).
  //
  // ──── substrate signals surfaced by E.3 ──────────────────────
  //   5. NavModel sections assume `Array<item>` data.  Settings is a
  //      SINGLETON record (one merged object: per-device + per-actor
  //      fields).  Today this works — `getSettings({})` returns
  //      `{settings: {...}}` and the page extracts `.settings`
  //      directly — but `fetchSectionItems`'s "items extraction"
  //      contract doesn't apply. candidate: `view.shape:
  //      'record'` flag, or a `dataSource.extract: 'settings'` path
  //      that the helper honours, so adapters can render record views
  //      without app-side special-casing.
  //   6. Mutation paths for record-shaped views are per-field skills
  //      (`updateSettings({patch})`, `setHopMode({global})`), not
  //      add/remove of items. The current creative-verb model
  //      doesn't have a slot for "patch a settings field"; manifest
  //      ops would need a `verb: 'patch'` (non-canonical) or a new
  //      `view.fields[].opId` schema.  Deferred — current pages drive
  //      these directly until has a real signal-rich consumer.
  views: [
    {
      id:     'mine',
      title:  'My posts',
      type:   'request',     // broadest stoop itemType; see note above
      filter: { open: true },
      // explicit dataSource; `fetchSectionItems` will pick
      // this up and call `listMyRequests({})` instead of the rule-b
      // fallback `listOpen({type: 'request', open: true})`.
      dataSource: { skillId: 'listMyRequests' },
    },
    {
      id:       'privacy',
      title:    'Privacy — wat je moet weten',
      type:     'group-rules',  // placeholder; see note above
      readOnly: true,           // read-only disclosure page
      // (adopted 2026-05-21) — `getPrivacyNotice` is now
      // the explicit dataSource; lang arg substituted at call time
      // from the browser-supplied context (`$lang`).  Replaces the
      // workaround that direct-called the skill.
      dataSource: {
        skillId:         'getPrivacyNotice',
        argsFromContext: { lang: '$lang' },
      },
    },
    {
      id:    'settings',
      title: 'Instellingen',
      type:  'group-rules',  // placeholder; settings is singleton-record,
                             // not a list of group-rules items.
      // (adopted 2026-05-21) — shape: 'record' marks this
      // section as a singleton.  Adapter expects ONE record from
      // `getSettings`, not an array — matches the reality of the
      // settings page.
      shape:       'record',
      dataSource:  { skillId: 'getSettings' },
      // (adopted 2026-05-22) — declare a representative
      // subset of editable fields with patch declarations.  The
      // settings.html UI is rich (localisation + per-field custom UX); the
      // manifest is the source-of-truth for WHICH fields exist +
      // their patch ops, but UI rendering stays hand-coded.
      //
      // signal — wrapped-patch convention: `updateSettings`
      // takes `{patch: {<key>: <value>}}` (nested arg). 's
      // `{opId, argName}` model is FLAT — for updateSettings-backed
      // fields, `argName` is the settings-key name (semantic);
      // adapter wraps in `{patch: {...}}` on dispatch.  A future
      // could add `patch.argWrapper: 'patch'` to make this
      // explicit in the substrate.
      fields: [
        {
          name:     'hopThrough',
          type:     'boolean',
          label:    'Hop-relay (globaal)',
          // localisation key for Dutch-first surfaces. Consumer
          // side resolution; falls back to `label` if unknown.
          labelKey: 'settings.hop_label',
          // setHopMode takes `{global: <bool>}` directly — fits.
          patch:    { opId: 'setHopMode', argName: 'global' },
        },
        {
          name:     'pollIntervalMs',
          type:     'enum',
          label:    'Hoe vaak het prikbord ververst',
          labelKey: 'settings.poll_interval_label',
          choices:  [2000, 10000, 60000, 300000],
          // Wrapped-patch convention: dispatch is
          // `updateSettings({patch: {pollIntervalMs: <value>}})`.
          // Adapter knows the convention; manifest stays semantic.
          patch:    { opId: 'updateSettings', argName: 'pollIntervalMs' },
        },
        {
          name:     'broadcastable',
          type:     'boolean',
          label:    'Auto-skill-match',
          labelKey: 'settings.broadcastable_label',
          patch:    { opId: 'updateSettings', argName: 'broadcastable' },
        },
        {
          name:     'defaultShareLocation',
          type:     'boolean',
          label:    'Standaard locatie delen met nieuwe contacten?',
          labelKey: 'settings.default_share_location_label',
          patch:    { opId: 'updateSettings', argName: 'defaultShareLocation' },
        },
        // Other settings.html fields (online-every, online-duration,
        // …) remain to be declared.  Pattern is the same; not
        // surfacing all 8+ in this commit to keep the -adopt
        // proof small.  Forward-additive extensions land per-field.
      ],
    },

    // ──── E.4 — profile view (adopt) ─────────────────────────────
    //
    // `profile.html` is stoop's account/identity surface: handle +
    // displayName + holiday-mode + skills picker + location + recovery
    // + my-pods.  591 lines, FIVE sections, heavy custom UX (avatar
    // resize, mnemonic reveal-once, geocoding preview).  Like
    // settings.html, auto-rendering would regress UX — the page keeps
    // its rich hand-coded layout.
    //
    // Manifest's job here = source-of-truth for WHICH editable identity
    // fields exist + their patch ops. Mirrors settings's -adopt
    // pattern (commit 9e7003b): record-shape view + fields[] with
    // per-field {opId, argName}.  Page rendering stays unchanged.
    //
    // The `profile` view's `type: 'group-rules'` is a placeholder
    // (same pattern privacy + settings use).  `validateView` pins
    // type ∈ manifest.itemTypes, but the section's actual data is a
    // SINGLETON record (the calling actor's MemberMap entry), not a
    // list of group-rules items.  Adding 'profile' as a new itemType
    // would change the frozen 8-type set (per manifest-validation test
    // line 92-101); reusing the placeholder keeps the diff minimal +
    // matches the established convention for record-shape views.
    //
    // `dataSource: { skillId: 'getMyProfile' }` — `getMyProfile()`
    // returns `{entry, renderForCurrentGroup}`; the page already
    // extracts `.entry` (line 208 of profile.html: `r?.entry?.handle`).
    // Same "page extracts the record key from the envelope" pattern
    // settings uses with `.settings`.
    //
    // Fields chosen: 3 representative identity fields, all FLAT
    // dispatch (no argWrapper needed — getMyProfile-backed mutations
    // are all single-arg skills, not wrapped-patch like
    // updateSettings).  Avatar, mnemonic, backup, location, skills
    // picker, and my-pods sections remain hand-coded (see + signals
    // below — none of them fit fields[] cleanly).
    //
    // ──── + substrate signals surfaced by E.4 ─────────────────────
    //   7. `holidayMode` lives on the MemberMap entry (`entry.holidayMode`)
    //      — readable via `getMyProfile`.  But the dedicated reader
    //      `getHolidayMode()` returns `{holidayMode}` directly (separate
    //      skill). today assumes ONE dataSource skill per view;
    //      no slot for "field-specific read skill" alongside the
    //      record-level read.  Adapter has to either trust the record
    //      envelope or know to re-read per-field.  Out of scope here;
    //      page already reads holiday-mode separately.
    //   8. `avatarUrl` is bytes (data-URL after resize), not a primitive
    //      that fits 's `type: 'boolean' | 'enum' | string`. The
    //      avatar input is a file-picker with client-side resize
    //      (`fileToResizedDataUrl`) + dispatch to `setMyAvatarUrl({url})`
    //      and clear via `clearMyAvatar({})`. has no `'file'` or
    //      `'image'` field type + no notion of "client-side transform
    //      before dispatch".  Stays hand-coded.
    //   9. `skills` section is a list-shape WITHIN a record-shape view
    //      (the user has many skills, each editable in 3 dimensions:
    //      checked/status/freeTags). today is a flat `'record'`
    //      vs `'list'` choice per view — no nested shape.  Splitting
    //      profile into "profile-identity" (record) + "profile-skills"
    //      (list) is possible but would change the page's mental model;
    //      keeping it ONE view for now.
    //  10. `location` is also list-/wizard-shape (search → preview →
    //      confirm) with an intermediate geocode skill call. No
    //      slot for "multi-step mutation".  Stays hand-coded.
    //  11. `mnemonic` + `encryptedBackup` are SECURITY-sensitive
    //      one-shot reveals (mnemonic shows once) + dangerous-action
    //      flows (backup needs a passphrase). has no notion of
    //      "consent gate" or "one-shot read".  Stays hand-coded.
    //
    // None of these block E.4: the -adopt proof-point is the
    // record + 3 flat fields.  The signals are forward-additive
    // substrate work for later V0.x.
    {
      id:    'profile',
      title: 'Mijn profiel',
      type:  'group-rules',  // placeholder; profile is singleton-record,
                             // not a list of group-rules items.
      // shape: 'record' marks this section as a singleton.
      // `getMyProfile` returns `{entry, renderForCurrentGroup}`; the
      // page extracts `.entry` (mirrors settings's `.settings` envelope
      // extraction).
      shape:       'record',
      dataSource:  { skillId: 'getMyProfile' },
      // (adopted 2026-05-22) — declare 3 representative
      // identity fields with patch declarations.  All FLAT dispatch
      // (no argWrapper) — getMyProfile-backed mutations are
      // single-arg skills, not wrapped-patch like updateSettings.
      fields: [
        {
          name:     'handle',
          type:     'string',
          label:    'Handle (kleine letters, 3–32 tekens)',
          // localisation key for Dutch-first surfaces.
          labelKey: 'profile.handle_label',
          // setMyHandle takes `{handle: <string>}` directly — flat fit.
          patch:    { opId: 'setMyHandle', argName: 'handle' },
        },
        {
          name:     'displayName',
          type:     'string',
          label:    'Echte / weergavenaam (optioneel)',
          labelKey: 'profile.display_name_label',
          // setMyDisplayName takes `{displayName: <string>}` directly.
          patch:    { opId: 'setMyDisplayName', argName: 'displayName' },
        },
        {
          name:     'holidayMode',
          type:     'boolean',
          label:    'Vakantiemodus (skill-match overslaat me)',
          labelKey: 'profile.holiday_label',
          // `holidayMode` is reachable BOTH via the record's
          // dataSource (`getMyProfile` returns it under `.entry.
          // holidayMode`) AND via a dedicated `getHolidayMode` skill.
          // Adapters that want a single-field refresh (e.g. after the
          // user toggles it elsewhere) call this skill instead of
          // re-fetching the whole profile.  E.4 was the originating
          // signal; closed the substrate gap.
          readSkill: { skillId: 'getHolidayMode' },
          // setHolidayMode takes `{on: <bool>}` directly — argName
          // is the *skill arg* (`on`), not the field-on-entry name
          // (`holidayMode`).  Same semantic split settings's
          // hopThrough → setHopMode({global}) uses.
          patch:    { opId: 'setHolidayMode', argName: 'on' },
        },
        // Other profile.html fields (avatar, skills[], location,
        // mnemonic, encryptedBackup, my-pods) stay hand-coded — see
        // signals (7–11) above. Forward-additive: any of them
        // can land per-field when the substrate has a fit.
      ],
    },

    // ──── Part G dissolve (2026-06-17) — feed + contacts views ──────────
    // Folded in from the former mockStoopManifest.  APPENDED after the
    // E.x web-page views so the existing navmodel section order
    // (mine/privacy/settings/profile) is unchanged.  `validateView` pins
    // `view.type ∈ manifest.itemTypes`; 'post' + 'contact' are declared
    // as app-local types above.
    { id: 'feed',     title: 'Feed',     type: 'post' },

    // ──── D-mig-1a (objective D, step 1a) — project the live LIST-screen
    //      surfaces (contacts + noticeboard) FROM this manifest.  These two
    //      views make renderWeb able to project what the basis
    //      `LIST_SCREENS` literal (web/v2/circleApp.js) used to hardcode:
    //      the row LABEL field + the group/filter CATEGORY field.  The live
    //      list path now consumes these sections — `LIST_SCREENS` was retired
    //      repo-wide (D-mig-1b, 2026-07-07).
    //
    //  contacts → listContacts (appliesTo type:'contact'); the ContactBook
    //      rows carry a `category` field (LIST_SCREENS `categoryField:
    //      'category'`) and render `row.label` (default label field).
    {
      id:            'contacts',
      title:         'Contacts',
      type:          'contact',
      dataSource:    { skillId: 'listContacts' },
      labelField:    'label',
      categoryField: 'category',
      // D-mig-2 — the free-text filter grammar.  A contact row (the
      // listContacts reply adapter, realAgent.js) carries `label`
      // (displayName ?? handle ?? webid) AND a distinct `handle` field —
      // so searching by handle when the label shows a display name is a
      // GENUINE secondary field.  An item matches if the query hits label
      // OR handle (case-insensitive contains).
      searchFields:  ['label', 'handle'],
    },
    //  noticeboard → listOpen (spans ask/offer/lend; the reply adapter maps
    //      those canonical rows to the chat-shell `type:'post'`, same type
    //      the `feed` view uses).  Noticeboard rows group by `kind`
    //      (LIST_SCREENS `categoryField:'kind'`); labelField omitted — the
    //      default 'label' matches what listScreen.js renders (`row.label`).
    {
      id:            'noticeboard',
      title:         'Noticeboard',
      type:          'post',
      dataSource:    { skillId: 'listOpen' },
      categoryField: 'kind',
      // D-mig-2 — the free-text filter grammar.  A noticeboard post row (the
      // listOpen reply adapter, realAgent.js) sets `label = post.text` —
      // the label ALREADY IS the full post body.  There is no separate
      // title/summary field distinct from the label to search, so we
      // declare the default explicitly (`['label']`) rather than invent a
      // field the data doesn't carry.  Formalises the default: a noticeboard
      // search matches the post body, exactly as before.
      searchFields:  ['label'],
    },
  ],

  /**
   * Declared FLOWS (Surfaces home, batch 6) — a wizard is a flow through the waist, and the manifest
   * is where surfaces are declared (invariant #4). This is the FIRST one; the shape is
   * `{ id, kind, opId, steps: [{id, next}], needs, produces }`.
   *
   * A flow here is a DECLARATION of an existing state machine, not a second implementation: the join
   * wizard still runs `joinGroupState.js`'s numeric steps, whose exported `JOIN_FLOW_STEPS` names
   * them. The flow-integrity guard (G-S3, `scripts/flowIntegrity.test.js`) holds the two together —
   * declared ids ≡ exported ids, the `next` chain acyclic and fully reachable, `opId` declared in
   * this manifest's operations — so the declaration cannot drift from the machine it describes.
   */
  flows: [
    {
      id:    'joinGroup',
      kind:  'wizard',
      opId:  'joinGroupWizard',
      steps: [
        { id: 'invite',   next: 'consent'  },   // paste/scan + decode the invite
        { id: 'consent',  next: 'identity' },   // the rules gate: rules + privacy + capability consent
        { id: 'identity', next: null       },   // handle / persona / reveal / key choice → finalSubmit
      ],
      needs:    ['invite'],                     // the op's required param — what the flow consumes
      produces: ['membership-redemption'],      // the item the successful flow writes (both sides)
    },
  ],
};

export default stoopManifest;
