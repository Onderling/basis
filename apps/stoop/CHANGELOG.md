# Changelog — @onderling-app/stoop

## [Unreleased] — attachments are canonical `media` items (2026-07-10)

Media Phase 1 anti-drift tail: stoop's inline-bytes attachments now
ride the canonical media noun instead of a bespoke shape.

- `persistInboundAttachment` emits a schema-valid `@onderling/item-types`
  **`media` item** (`type/id/createdAt/createdBy/source` + the
  canonical `mime`/`width`/`height` hints). Stoop's extras
  (`bytes`, unsealed `thumbnail`, LOCAL-ONLY cache `ref`) ride as
  forward-additive fields — bytes stay at
  `mem://stoop/items/<itemId>/attachments/<attId>.<ext>`, exactly
  where they lived.
- New wire-ref convention: `source = {type:'stoop-att',
  ref:'stoop-att://<itemId>/<attId>'}` — install-independent (any
  instance resolves it via the item's attachment list + the existing
  `requestAttachment` round-trip); no local path / pod URL on the
  wire. `attachmentWireRef`/`parseAttachmentWireRef` exported.
- `toWireShape` is media-aware: canonical fields travel; the local
  `ref` (+ `dataB64`) is still ALWAYS stripped. Legacy records (old
  stored items; chat-p2p's receiver-built records) pass through in
  the legacy shape — mixed-version peers keep working because the
  render keys (`id`/`mime`/`bytes`/`width`/`height`/`thumbnail`)
  are unchanged in both shapes.
- **Leak fix:** `listCirclePostsSince` (joiner catch-up) shipped raw
  `source.attachments` INCLUDING the local `ref` — now routed
  through `toBroadcastShape` (Phase 39 privacy invariant).
- Web renderer reads the canonical media shape (writer-asserted
  `width`/`height` as layout hints), tolerant of legacy records.
- Honest scope: **shape consolidation only.** Stoop has no sealer on
  its post path (no group/circle content key is composed anywhere in
  the app), so the sealed-blob path (`@onderling/blob-gateway`
  `uploadBlob` — refuses plaintext by design) is the follow-up once a
  sealing seam exists; blob-gateway's manifest line then slots into
  `source` unchanged.
- Tests: `test/mediaAttachments.test.js` (10) validates against the
  REAL item-types registry (the drift guard), round-trips the flow,
  pins wire-shape compat + the leak fix + renderer equivalence.
  Full suite 733 passed + 1 skipped.

## [Unreleased] — basis browser composition (2026-05-23)

New export: `@onderling-app/stoop/browser` →
`createBrowserStoopAgent({bus, identityVault, localActor, group?, members?, persistDb?, label?})`.

Lets basis boot a real Stoop NeighbourhoodAgent on its shared
bus.  Replaces basis's ~85 lines of mock stoop handlers
(listFeed / postRequest / searchPosts / getStoopProfile /
revealPeer) with the actual 110-skill stoop agent.  ~6 skills
surface via chat slash commands; the rest are reachable via
`agent.callSkill('stoop', ...)` for future expansion.

Implementation: thin wrapper around `createNeighbourhoodAgent` that
generates an InternalTransport on the shared bus + restores/creates
identity from a vault.  Uses the slice-2a `persistDb` opt for
IndexedDB persistence in the browser.

Plan: `Project Files/basis/integration-plan-2026-05-23.md` §
": Stoop → basis browser".

594/594 stoop tests still green; no app-side changes.

## [Unreleased] — IndexedDBPersist adapter + persistPicker (2026-05-23)

Prerequisite for `Project Files/basis/integration-plan-2026-
05-23.md` (Stoop → basis browser).

New files
  - `src/lib/IndexedDBPersist.js` — browser-side equivalent of
    `FilePersist`; same `load/save/scheduleSave/flush/cancel`
    surface; raw IndexedDB (no idb-keyval dep) keyed
    `{dbName, storeName='snapshots', key='state'}`.
  - `src/lib/persistPicker.js` — `pickPersist({path?, dbName?, ...})`
    dynamically imports the right adapter so a browser bundle never
    pulls in `node:fs/promises`.  Rejects mutually-exclusive opts;
    returns null when caller wants in-memory only.

Agent.js change
  - Removed static `import { FilePersist }`; use `pickPersist` via
    a unified `persistArgs` block.  New `persistDb` opt accepts
    `{dbName, storeName?, saveDelayMs?}` for browser composition
    (mutually exclusive with the existing node-only `persistPath`).
  - Behaviour unchanged for existing callers — `persistPath` still
    routes to `FilePersist` exactly as before.

Tests + footprint
  - `test/IndexedDBPersist.test.js` (15 tests) — construction,
    round-trip, debounce / flush / cancel, two-instance sharing
    of the same dbName, dbName isolation
  - `test/persistPicker.test.js` (6 tests) — selection rules,
    mutual-exclusion guard, opt pass-through
  - `package.json` devDeps: + `fake-indexeddb` ^6.0.0
  - Stoop suite: 594 → 612 tests passing (+21 new + 0 regressions)

Next: (Stoop → basis browser composition via the
shared bus; uses this adapter to keep the CachingDataSource alive
across page reloads).

## [Unreleased] — first stoop web page via renderWeb

Opens Slice E (stoop web → renderWeb) of `PLAN-gui-chat-uplift.md`.
Migrates ONE web page (`mine.html`) to consume the NavModel computed by
`renderWeb(stoopManifest)`.  Remaining 15 pages stay hand-built and
will land in follow-on E.x slices — same discipline B.1 used for
tasks-v0 (just `dag.html`).

### Page migrated

- `web/mine.html` — my active posts + completions.  Chosen as the
  E.1 substrate-shape proof because (a) it's a single-list page (one
  skill, one `<ul>`), (b) the skill it calls (`listMyRequests`) IS
  in the D.1 manifest, and (c) it's strictly less risky than
  `index.html` (prikbord has filters + multi-intent tabs) or
  `privacy.html` (which calls `getPrivacyNotice` /
  `getDataLocation`, neither in the D.1 chat/slash-callable core).

### Pages deferred to follow-on E.x slices

`index.html` (prikbord), `chat.html`, `contacts.html`,
`create-group.html`, `group.html`, `profile.html`, `settings.html`,
`onboard.html`, `sign-in.html`, `auth-callback.html`, `push.html`,
`restore.html`, `welcome.html`, `metrics.html`, `privacy.html` — all
15 stay hand-built (unchanged) and continue to serve via every
launcher.

### Manifest delta

- Added ONE view `{id:'mine', title:'My posts', type:'request',
  filter:{open:true}}`.  `validateManifest` stays green; renderWeb
  emits a one-section NavModel for stoop.

### New bootstrap

- `bin/stoop-web.js` — minimal single-actor stoop bundle that
  `renderWeb(stoopManifest)`'s the NavModel and serves it as
  `/navmodel.json` + `/stoop-config.json` via
  `mountLocalUi({extraStaticFiles})`.  Mirrors
  `apps/household/bin/household-web.js` (substrate).
  Production launchers (`stoop-ui.js`, `stoop-testbed.js`) stay
  unchanged.

### New test

- `test/stoop-web.test.js` — 6 tests, all passing.  Covers
  `/navmodel.json` contents, `/stoop-config.json`, the
  `data-navmodel-section` marker on `/mine.html`, the agent card,
  legacy `/` still serves, and a `postRequest → listMyRequests`
  round-trip via LocalUiAuth.

### Substrate signals (flagged for Slice C / follow-on E.x)

- **Multi-type list-skills can't declare their data source in the
  NavModel.**  `listMyRequests` spans ALL post types
  (ask/offer/lend), but `view.type` is single-valued.  The `mine`
  view's `type: 'request'` is a placeholder; the adapter
  special-cases the section to call `listMyRequests({})` rather
  than `listOpen({type: 'request'})`.  Same special-case pattern
  household uses for `tasks` (listTasks) and `members` (no
  list-skill).  A follow-on substrate addition (e.g.
  `view.dataSource: {skillId, args}` or `view.predicate`) would let
  `mine` declare its own data source without the client special-case.
- **All-itemTypes ops don't surface as itemActions.**
  `cancelRequest` and `markReturned` (with lifecycle scope) span all
  stoop post types, but renderWeb's logic only matches via
  explicit `appliesTo.type` or a `type` enum param — neither of
  which fits "act on any of my posts".  mine.html's per-row buttons
  use the existing `renderMyItems` helper (kind-aware), not the
  NavModel's `itemActions[]`.  A `type: '*'` or
  `appliesTo.type: anyOfTypes` extension would close this.

Touch boundary: `apps/stoop/web/` + `apps/stoop/bin/` + `manifest.js`
only.  Concurrent agent (D.2) owns `apps/stoop/src/chat/`.

## [0.3.0] — 2026-05-14 — V2 substrate adoption (Q-B retirement + A-track UX + A2 + C-track)

The Stoop V2 web functional design's full substrate-adoption UX
surface shipped today, plus the mobile mirror (C-track) and the
Phase 52.9.2 `groupMirror` retirement.

### Q-B groupMirror retirement (Phase 52.9.2)

- `apps/stoop/src/groupMirror.js` deleted. The pubsub-tap mirror
  ("subscribe to every peer's `<group>/requests` topic; copy
  payloads to local itemStore") is replaced by the substrate path:
  `@onderling/notify-envelope` + `@onderling/pseudo-pod` with the
  Q-D Lamport version compare on receive. Clean break (no dual-run)
  because Stoop V1 has no production users.
- New `apps/stoop/src/substrateMirror.js` — `wireSubstrateMirror`
  + `attachSubstrateMirror`. Surface preserved (`{addPeer, stop,
  listPeers, backfillFrom, getPeers}`) so the testbed +
  `stoop-mobile`'s agentBundle/bootstrapBundle drop in.
- New `apps/stoop/src/lib/substrateStack.js` — per-bundle
  pseudoPod + podRouting + notifyEnvelope, with per-recipient
  transport routing via `agent.transportFor(addr)`.
- `apps/stoop/test/groupMirror-addPeer-race.test.js` deleted —
  the race it pinned is structurally impossible on the substrate
  path (receive is one global subscription, not per-peer).

### A-track UX surface (V2 web functional design §4)

- **A1 — `'stale-peer'` auto-heal** in `wireSubstrateMirror`:
  `pseudoPod.on('stale-peer')` → republish the local fresher copy
  back to the stale peer via `notifyEnvelope.publish`. Silent
  auto-heal (no UI affordance per the lean).
- **A2 — `fetch-resource` with `groupCheck`** registered on every
  Stoop bundle (Phase 52.2.x). `groupCheck(uri, ctx) ⇒
  mirror.getPeers().has(ctx.from)`. Defensive — closes the gap
  forward of envelope-only mode + cross-app embed-fetches.
- **A3 — storage-policy picker** in `/create-group.html`: four
  §II.2 policies (`no-pod` default / `centralised` /
  `decentralised` / `hybrid`). New `createGroupV2` opt
  `storagePolicy` + `groupPodUri`; persists in the rules item
  + pushes to `podRouting.setCirclePolicy`.
- **A4 — `embeds:[{type, ref}]` on `postRequest`** with chip
  rendering on prikbord cards (`renderEmbedChips` in `web/app.js`
  + CSS). Cross-pod refs (V2 web functional design §4b).
- **A5 — `/group.html` storage section + upgrade row**. New
  `setCircleStoragePolicy` skill (admin/coordinator-only,
  one-way: rejects downgrade to no-pod).
- **A6 — `/profile.html` "My Solid pods" section**: display
  pod-attach status via existing `podSignInStatus` + sign-out
  via `signOutOfPod`. Two-pod preset placeholder for V3.
- **A7 — agent-registry registration on bundle bring-up**
  (Phase 52.10). `attachSubstrateMirror` calls the
  `registerAgentBundle` helper (lifted into
  `@onderling/agent-registry`); idempotent CAS upsert; soft-fail.

### C-track — mobile mirror

- `apps/stoop-mobile/src/lib/{agentBundle,bootstrapBundle}.js`
  call `registerAgentBundle` at every bundle bring-up + expose
  `bundle.podRouting`. C2 stale-peer auto-heal inherits from
  `wireSubstrateMirror` (no mobile-side code change).
- `apps/stoop-mobile/src/screens/CreateGroupScreen.js` adds a
  storage-policy picker (4-radio + conditional pod-URI input).
- `apps/stoop-mobile/src/screens/PostComposeScreen.js` adds an
  embed-ref slot (type + ref + remove-chip; cap of 8).
- `apps/stoop-mobile/src/screens/ProfileMineScreen.js` adds a
  "My Solid pods" section + sign-out. Two-pod preset
  placeholder.

### Locales + tests

- EN + NL locales updated across web + mobile (`{text, doc}`
  shape preserved). audit-locales clean.
- New test files: `staleAutoHeal.test.js` (9), `agentRegistryWiring.test.js`
  (6), `embedsPost.test.js` (7), `storagePolicy.test.js` (12),
  `fetchResourceGate.test.js` (6). Mobile localesIntegrity test
  expanded to 593 keys.
- **Stoop A-track tests: 47/47** in the focused sweep across
  staleAutoHeal/agentRegistryWiring/embedsPost/storagePolicy/
  fetchResourceGate/testbed.

### Commits

- `2fcd335` — V2 substrate-adoption: Q-B groupMirror retirement + A-track UX surface
- `d14a6d5` — Stoop-mobile C-track (mobile mirror of A-track)
- `3a40294` — A2 fetch-resource + groupCheck

## [0.2.0] — 2026-05-06

V2 of what was H5 / neighbourhood-v0. Renamed in place; the package
is now `@onderling-app/stoop`.

Substrate extensions (Phase 1 — landed in `packages/`):

- `identity-resolver`: handle + avatarUrl on `MemberMap`; new `Reveals` class; pure `resolve()` function.
- `notifier`: `scheduleBefore({dueAt, leadMs, ...})` convenience.
- `item-store`: no change required (existing `Item.type` + `dueAt` cover Stoop's needs).

Relay extensions (Phase 2 — landed in `packages/relay`):

- `verifyBound({proof, connectingPubKey, rotationProof?})` closes the
  spoofing loophole + accepts `core.KeyRotation` rotation chains.
- `acceptedGroups[].revokedMembers` static blocklist.
- `acceptedGroups[].quotas: {msgsPerDay, maxConnections}`.

Stoop V1 skills (Phases 3, 6, 7, 10):

- `postRequest` — accepts `kind: 'ask'|'offer'|'lend'|'report'` + `dueAt`; auto-schedules a return reminder for lend.
- `markReturned` (lend lifecycle).
- `mutePeer` / `unmutePeer` / `listMutedPeers` — local-only filter.
- `reportPost` — `kind:'report'` audit item.
- `setMyHandle` / `setMyDisplayName` / `setPeerReveal` / `setGroupReveal` / `getMyProfile`.
- `createGroupWithRules` / `getGroupRules` / `acceptGroupRules` / `getOnboardingState`.
- `getDataLocation` / `getPrivacyNotice` / `markMnemonicShown`.
- `exportMyData` / `leaveGroup({deletePosts?})`.
- `listOpen` / `listMyRequests` now hydrate `addedByDisplay` via `identity-resolver.resolve()`.

Stoop V1 lib modules (Phases 4, 6, 8, 9):

- `lib/CachingDataSource.js` — local-first DataSource wrapper with write queue + `attachInner` mid-session.
- `lib/SyncCadence.js` — foreground-only periodic sync ticker.
- `lib/handle.js` — pure handle validator.
- `lib/localisation.js` — `i18next` wrapper; en + nl ship.
- `lib/RotationScheduler.js` — periodic `Agent.rotateIdentity` (foreground-only).
- `lib/PushPolicy.js` — humanInTheLoop + per-day cap + quiet-hours wrapper.
- `lib/UsageMetrics.js` — local counter for the V1 push-UX feedback loop.
- `lib/privacyNotice.js` — closed-beta privacy-notice content (NL/EN).
- `lib/itemTypes.js` — Stoop `Item.type` vocabulary constants.

Web (Phase 5, 7):

- `web/index.html` — prikbord with kind tabs (Alles / Vragen / Aanbod / Te leen) + per-post `…` menu (mute / report) + honest "Naam verbergen tot connectie" copy.
- `web/profile.html` — handle + display-name forms + default-render preview.
- `web/create-group.html` — six-question governance wizard.
- `web/privacy.html` — privacy notice + data-location.

Locales: `locales/{en,nl}.json` populated.

i18next as a dependency.  Dropped explicit pre-Stoop H5 wording from
the codebase (test expectations updated; CHANGELOG, README, bin
script names re-cast to `stoop-*`).

Tests: **143** in `apps/stoop`.  Plus substrate/relay deltas:
identity-resolver 30→49, notifier 40→45, relay 121→126.

## [0.1.0] — 2026-05-02

H5 V0 — initial release (non-anonymous).

- `createNeighbourhoodAgent({skillMatch, members?, itemBackend?})` factory.
- Skills: `postRequest`, `acceptResponder`, `cancelRequest`, `listMyRequests`, `listOpen`, `resolveMember`.
- 9 integration tests.

V0 = non-anonymous; Q-H5 anonymity model is parked.
