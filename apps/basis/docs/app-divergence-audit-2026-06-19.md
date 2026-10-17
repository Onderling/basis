# Cross-app divergence audit — 2026-06-19

Triggered by the live-LLM household test (Frits): "first every app should work without a pod
(peer-sync items); second, no single production transport — a router picks the best route."
This audit maps (A) storage/sync, (B) architectural consistency, (C) the transport stack.
Sources: two parallel Explore passes + a transport deep-dive. File:line evidence inline.

---

## A. Storage + sync capability matrix

| App | No-pod peer item-sync | Solid/sealed POD storage | Backing store | Fan-out / receive |
|---|---|---|---|---|
| **household** (as hosted in basis) | **NONE** | **NO** (host path) | `InMemoryStore` (in-memory, lost on reload) | **NONE** |
| household (standalone app) | NONE | latent (`HouseholdPod`/`HybridPodStore`, not wired into the host) | InMemoryStore or HybridPodStore | NONE |
| **tasks-v0** | **YES** — `substrateMirror.js` (add + updates + remove) | YES (storage policy → SolidPodSource) | `ItemStore` over `CachingDataSource` (write-through) | `notify-envelope` + `pseudo-pod`; stale-peer auto-heal |
| **pinboard** | **YES** — `substrateMirror.js` (**add only**) | YES (storage policy + sealed circle pod) | `ItemStore` over `CachingDataSource` | `notify-envelope` + `pseudo-pod`; `ingestRemotePost`/`ingestKringMessage`/`backfillFrom` |
| **folio** | N/A (file↔pod model, not item-mirror) | YES (pod-native by design; `@onderling/sync-engine`) | local files ↔ pod | SyncEngine diff/push-pull (not envelope fan-out) |
| **calendar** | **NONE** for events | partial (only the `.ics` FEED write-throughs; events don't) | `@onderling/pseudo-pod` directly (in-memory default) | none for events; RSVP/invite via injected `inviteAttendee`/`publishEvent` |

**Key gaps:**
- **household is the outlier with ZERO replication** — no `substrateMirror`, no `notify-envelope`, no `pseudo-pod`,
  no publish/ingest. An item added on device A never reaches device B. (`realAgent.js:109` `new HouseholdStore()`.)
  Also **no persistence** in the hosted path (in-memory → lost on reload), unlike tasks/pinboard (CachingDataSource +
  pod) and calendar (feed write-through). Its pod layer (`apps/household/src/pods/*`) is **latent/dead** vs basis.
  → **OBJ-2.** The reference to copy: `tasks-v0/pinboard substrateMirror.js`.
- **tasks vs pinboard mirror scope differs:** tasks fans out add+update+remove; pinboard fans out **add only** (relies on a
  separate claim pubsub + `ingest*`). Worth unifying the mirror's op coverage.
- **calendar** uses `pseudo-pod` directly (rejected ItemStore — it strips event custom fields) and only persists the
  feed file, not the event records. The most divergent backing store of the item apps.

---

## B. Architectural consistency punch-list (post Part-G)

App-origin ↔ `manifest.app` is clean for all 5, and there are **no exact `/slash` collisions**. The drift is in the
**realAgent adapter layer**, **reply-shape contracts**, and **where brief/search/embed decls live**. Ranked:

1. **[HIGH] realAgent dispatch branches are non-uniform.** Five `appOrigin===` branches, five shapes: tasks (~155 lines,
   full adapter + aliases + arg transforms + `adaptTasksReply`), pinboard (~255 lines, adapter + i18n + NKN fan-out side-
   effect + `adaptPinboardReply`), **household** (adapter runs at *registration* time `:258`, not at dispatch — different
   layer than the others), **folio** (dispatches RAW — no adapter), **calendar** (no own branch — re-enters via
   `callSkill('household','calendar_'+opId)` `:1166`; co-mounted on the household host with a `calendar_` prefix).
2. **[HIGH] Reply-shape contract enforced for 3, assumed for 2.** household/tasks/pinboard have explicit adapters +
   attach `_sync`(`simulateSync()`); **folio + calendar pass raw** — no shape-normalization seam, no `_sync` (can't show
   the per-row stale badge). Latent drift: a non-conforming skill reply renders wrong with nothing to catch it.
3. **[MED-HIGH] brief/search/embed decls live in 3+ places.** calendar+tasks inline; **pinboard+folio monkey-patched in
   `mockManifests.js:121-137`** (half-dissolved — Part G folded everything else but these); **household's `search` decl
   is only on the dead mock fixture** (`mockAgent.js:219`) so the REAL household manifest has no search → household is
   silently absent from `/find`.
4. **[MED] tasks-v0 declares `brief` TWICE** (`listOpen` order:20 `tasks_briefSummary` + `listMine` order:5
   `briefSummary`) — `/brief` picks up both. No other app double-declares.
5. **[MED] household adapter at the wrong layer** (registration vs dispatch) — in-process callers get already-adapted
   shapes; tasks/pinboard callers get raw. Plus household-only host shims (`addMember`/`getChoreSnapshot`/`resolveContact`).
6. **[MED] composition is ad-hoc per app:** tasks/pinboard/folio each get a `createBrowser*Agent` factory + isolated
   identity vault; **household has NO factory** (in-process skill loop, the only app imported by *relative path*
   `../../../../household/src/index.js` — "not a workspace dep yet"); **calendar has no agent** (co-mounted on the
   household host with a `calendar_` prefix). Three apps isolated, two share `hostAgent`.
7. **[MED-LOW] gate verb ownership is by scattered comments, no registry.** Cross-app bare-token contention
   (accept/reject/cancel/share/claim) resolved case-by-case. **household is the only app with a `slashGrammar` block +
   a `systemPrompt`** (`apps/household/manifest.js:316-356,45`); the others drive off per-op `surfaces.slash.match`.
8. **[LOW-MED] household ops never declare `chat.reply`** (only `hint`) — works only because the adapter shapes it;
   under-specified vs the others.
9. **[LOW] itemTypes canonicalization uneven:** calendar canonical; tasks mixes canonical+app-local; **pinboard abuses
   `type:'group-rules'` as a view placeholder** in 3 views; household has a `typeAliases` map where `task`→`errand`
   *and* a real `task` type (naming hazard).
10. **[LOW] embeds/snapshot uneven:** household has a `getChoreSnapshot` handler but **no `embed:` manifest decl** → can't
    be `/embed`-ed via the manifest path the others use.

**Suggested uniformity order:** (1) give folio+calendar reply adapters or a shared-contract test + attach `_sync`; (2)
move pinboard+folio brief/search/embed into their real manifests + add household's missing `search`; (3) de-dupe tasks
`brief`; (4) give calendar its own agent/branch (stop tunneling through household); (5) move the household adapter to
dispatch-time; (6) add household `chat.reply` kinds + an `embed` decl.

---

## C. Transport stack — the OBJ-1 diagnosis (CORRECTED)

**The transports + router ALL exist** — including mdns + ble (I was wrong earlier that they'd need building):
- Core router: `core/routing/RoutingStrategy.js` (priority `internal>local>mdns>rendezvous>relay>nkn>mqtt>ble`,
  reachability/latency-based) + `Agent.addTransport(name,t)`.
- Core transports: `Internal/Local/Mqtt/Nkn/Relay/Rendezvous/Offline/HubDelegate`.
- **RN-native transports: `packages/react-native/src/transport/MdnsTransport.js` + `BleTransport.js` + `NknTransport.js`.**
- **`packages/react-native/createMeshAgent.js` wires the FULL mesh:** builds mdns/ble/relay/nkn + `RoutingStrategy`,
  `agent.addTransport('mdns'|'ble'|'relay'|…)` (`:101-203`) → the router picks the best available route. This is the
  exact thing Frits described — and it's built.

**But basis does NOT use the mesh.** It uses `createSecureAgent` (`realAgent.js:160`), which has its OWN, simpler
peer model: NKN (`connectPeer({nknLib})`) + relay (`connectRelay({relayUrl})`) selected by a `transportMode`
('nkn'|'relay'|'both', default 'nkn') picker in `sendToPeer`. It **deliberately does NOT** call `agent.addTransport` or
use `RoutingStrategy` (`createSecureAgent.js:703-709,753`), and it wires **no rendezvous/mdns/ble**. basis
auto-connects **NKN only**; relay is **manual** (`/relay connect`). (basis-mobile dynamic-imports `MdnsTransport`
but only for the "nearby" peer-list feature, not for routing.)

**⇒ There are TWO parallel transport stacks:** the full **mesh/router** (`createMeshAgent`, RN, used by `pinboard-mobile`,
`createMeshAgent` consumers) and the **secure-agent** (NKN+relay, no router, used by basis). The router has
exactly one live route in basis → it behaves "NKN-only." **OBJ-1 is a reconciliation, not a build.**

**The architectural fork for OBJ-1:**
- **(i) Extend `createSecureAgent`** to register its transports with `RoutingStrategy` (`addTransport`) + auto-connect
  relay + rendezvous (web-capable) so the router selects — minimal churn to basis, but duplicates mesh logic.
- **(ii) Migrate basis onto `createMeshAgent`** (or a shared core) so there's ONE stack with the full router —
  cleanest end state, bigger change (secure-agent has the security/mute/HI/circle-override layer the mesh would need).
- **(iii) Unify:** lift the secure-agent's security layer into the mesh's transports so `createMeshAgent` IS the secure
  multi-transport agent — the "right" long-term shape, the largest change.

Platform reality: web can do **nkn, relay, rendezvous (WebRTC), mqtt**; **mdns + ble are RN/native only**. So the web
app maxes at nkn/relay/rendezvous; mdns/ble are mobile-only routes.
