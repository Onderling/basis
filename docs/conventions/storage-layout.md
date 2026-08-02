# Convention: storage layout for `@onderling` pods

> **Status:** deliverable (per transition doc §V.5). Documents the
> canonical pod-resource layout that `@onderling/pod-onboarding`
> provisions and that `@onderling/pod-routing` consumes. Discovery
> happens via the WebID profile; the layout below is what
> third-party Solid-aware tools will find at the documented paths.
>
> **Locked 2026-05-14. AMENDED 2026-05-17** — storage-function names
> are now **type/domain-keyed, app-agnostic** (the former
> `<app>/<function>` rule is superseded); added the *cross-app
> type-indexable layout* standard (new section below). Rationale +
> full decision record: `TODO-GENERAL.md` 🔴 "Stoop pod-backed
> storage" (D3). This resolves the open question in the substrates-v2
> functional design §4.3.6.

## Discovery

A user's WebID profile (e.g.
`https://alice.solidcommunity.net/profile/card#me`) carries pointer
predicates that resolve to the user's `@onderling` pod-resource
URIs. After `pod-onboarding.provisionDefault()` ships, the profile
contains (at least):

| Predicate | Object | Meaning |
|---|---|---|
| `solid:storage` (already standard) | `<pod>/` | Pod root |
| `dec:storage-mapping-uri` | `<pod>/private/storage-mapping` | Storage-mapping config resource |
| `dec:agent-registry-uri` | `<pod>/private/agent-registry` | Agent-registry config resource |

`dec:` is `https://w3id.org/onderling/vocab#`.

These are written by `pod-onboarding.provisionDefault()` →
`patchWebidProfile({pointers, predicates})`. The exact predicate
URIs and the JSON-LD shape live in
`packages/pod-onboarding/src/webidPointers.js`.

**Third-party tool flow:**
1. Resolve the user's WebID.
2. Read the profile document.
3. Look up `dec:storage-mapping-uri` → fetch that resource → parse
   the JSON-LD storage-mapping config.

## Canonical sub-container layout

Each `@onderling` pod is provisioned with the following top-level
containers. Apps MUST use these names; third-party tools can
expect them.

```
<pod>/
├── private/             — owner-only ACP; no public access
│   ├── identity-vault       — encrypted vault blob (mnemonic-locked)
│   ├── storage-mapping      — storage-mapping config (this doc)
│   ├── agent-registry       — DEVICE index (see the naming note below)
│   ├── accounts/            — one per portable ACCOUNT (see "Accounts" below)
│   │   └── <accountId>/
│   │       ├── registry         — profiles, properties, key references
│   │       └── log/             — this account's event log
│   ├── state/               — per-user app state (NOT shareable; see standard)
│   └── drafts/              — unsynced drafts
├── sharing/             — default-deny ACP; per-resource overrides
│   ├── public/              — world-readable, owner-write ACP
│   │   └── profile              — public profile object (handle, displayName, skills, avatar)
│   ├── <type>/              — ONE container per canonical item-type
│   │                          (items/, offers/, tasks/, notes/, photos/, …);
│   │                          keyed by WHAT the object is — never by app
│   └── with-<webid>/        — per-recipient auto-share folders (Phase 52.16)
├── group/               — circle-scoped; location per the circle §II.2 policy
│   └── <circleId>/<type>/     — e.g. group/<circleId>/items/
└── inbox/               — public-write (LDP inbox convention)
```

**ACP defaults** (per `pod-onboarding/src/acpTemplates.js`):
- `/private/` — agent-locked. Only the owning agent reads/writes.
- `/sharing/` — default-deny per-resource. ACPs added explicitly
  when a resource is shared (Phase 52.16 `client.sharing.*`).
- `/sharing/public/` — world-readable, owner-write. Apps writing
  here are explicitly publishing.

## Accounts — the portable unit

**An account is a registry plus a log.** The registry says who you are; the log says what happened.
Everything a person sees — circles, screens, settings, rosters, history — is a projection over those two,
never a third stored copy. That split is not cosmetic: a materialised copy of derivable state is what
produced the stale-membership class of bug, so the rule is *derived views over durable records*.

```
<pod>/private/accounts/<accountId>/
    registry     — profiles, the own/inherit property graph, key REFERENCES
    log/         — the event log for this account
```

### Why circle data is NOT under an account

Circle data lives at `group/<circleId>/…` — keyed by **what it is**, not by who referenced it first. Two
consequences, both deliberate:

- **Sharing needs no index layer.** An account holds what is its own; anything shared already sits
  somewhere shared. Accounts do not need to be bags of pointers into a blob store.
- **Deleting an account cannot orphan a circle's history**, because that history was never inside it.

For genuinely shared non-circle data (two accounts, one set of contacts), the mechanism is the profile
property graph's **own vs inherit**: a property either holds a value or points at another profile's. One
mechanism, no second one.

### Key material is referenced, never inlined

The registry stores `{"ref": "<scheme>:<id>"}`, not key bytes. Today the resolver reads them from the
sealed registry itself; an external key manager later is a new scheme (`hsm:`, `remote:`) and a different
resolver. **Inlining the bytes would make that swap a migration of every stored registry** — the
indirection costs one field now and saves a rewrite later.

### The file is a serialised pseudo-pod

There is no separate backup format. A no-pod user's resources already live at
`pseudo-pod://<deviceId>/private/…` and `pod-routing` picks the location, so the exported file is the same
payload with a different carrier. **One serialiser, one restore path, one thing to test** — two formats
would be free to drift, and drifting formats have already cost us twice (delivery TTLs, membership views).

### ⚠ Naming: `agent-registry` and `accounts/` are different things

`agent-registry` (Phase 52.10) is a **flat index of device installations** for WebID↔pubKey lookup, and it
keeps that meaning. An **account** is a portable identity-plus-history. Two things, two names, on purpose —
one word for both is how the delivery-state and membership-view confusions started.

## Storage-mapping config

Resource at `<pod>/private/storage-mapping`. JSON-LD shape; mapping
table is keyed by **storage-function name** (a stable identifier
that apps know to look up) and valued by **destination URI**.

```json
{
  "@context":    { "dec": "https://w3id.org/onderling/vocab#" },
  "version":     1,
  "activeMap": {
    "items":           "<pod>/sharing/items/",
    "photos":          "<pod>/sharing/photos/",
    "profile-public":  "<pod>/sharing/public/profile",
    "notes":           "<pod>/private/notes/",
    "private/state":   "<pod>/private/state/"
  }
}
```

Storage-function names are **type/domain-keyed and app-agnostic**
(`<type>` or `<domain>/<type>` — e.g. `items`, `photos`,
`profile-public`, `group/<circleId>/items`). They name **what the
object is**, never **which app wrote it**. Apps register the
function names they use when bootstrapping; users edit the mapping
via app settings or (eventually) the Hub-web-console.

> **Amended 2026-05-17.** The former `<app>/<function>` rule is
> superseded. App identity is recorded as an *optional, non-enforced*
> object metadata field (`origin`) — **never** a path segment, and
> **never** consulted for routing, ACP, or indexing.

## Cross-app type-indexable layout (the standard — all repo apps)

**Mandatory practice for every app in this repo.** Because containers
are keyed by canonical item-type (not by app), **any app can
enumerate every object of a given type regardless of which app
created it.** A `task` written by app X is listable/renderable by
app Y (e.g. tasks-v0) as long as both speak the canonical
`@onderling/item-types` schema for that type. Concretely:

- One container per canonical type (`sharing/<type>/`, or
  `group/<circleId>/<type>/` for circle-scoped data); the type name is
  the `@onderling/item-types` taxonomy name.
- Cross-app **reuse** rides the shared `item-types` schema; cross-app
  **references** ride the `embeds: [{type, ref}]` field
  (`conventions/cross-pod-refs.md`). No per-app vocabulary
  translation.
- An app discovers another app's objects of type `T` by resolving
  the storage-function for `T` via `pod-routing` and `list()`-ing
  that container — no knowledge of the authoring app required.
- `origin` (optional object field) records the creating app for
  debugging / attribution / migration only. Its absence is valid;
  nothing may depend on it.
- App-private, non-shareable plumbing (caches, device settings,
  migration markers) lives under `private/state/` and MAY use an
  app sub-key there — it is never reused, so it is out of scope of
  this standard. App **settings** specifically follow the separate
  locked `conventions/cross-app-settings.md` convention.

Future-rewrite design: see
`../Substrates/storage-migration-design-2026-05-14.md`.

## Agent-registry resource

Resource at `<pod>/private/agent-registry`. JSON-LD list of the
user's agents (one entry per device / app installation). Used by
`@onderling/agent-registry` (Phase 52.10) for cross-device identity
lookups + by `@onderling/identity-resolver` (Phase 52.11) for
WebID↔pubKey resolution.

The list is owner-only by ACP; agents auto-register on first run
via `agent-registry.register(...)` with `withCAS` retry on etag
conflict (the user might be installing two apps simultaneously
on two devices).

## Pseudo-pod variants

For **no-pod users**, the same resources live in the local
pseudo-pod under `pseudo-pod://<deviceId>/private/...`. The
`configResourceUri({deviceId, anchorPodUri})` helper in
`packages/pod-routing/src/configResource.js` picks the right
location.

Apps that consume `pod-routing` don't need to branch — the
substrate handles it.

## Pinned decisions

- **One-pod default.** Most users have one pod that holds
  everything. Two-pod (private + household) is a deliberate
  user choice via the storage-mapping editor (future Hub-web-
  console,).
- **`with-<webid>/` auto-share folders** live under `/sharing/`,
  named with URL-encoded WebIDs. Phase 52.16 maintains them as
  ACP grants on supported pods; cap-token fallback otherwise.
- **`/inbox/` is open-write.** Conventional Solid LDP inbox; any
  agent can append. Use for notifications that DON'T need ACP
  per-resource configuration.

## Constraints + non-goals

- **No deep restructuring after V1.** Reorganising paths (e.g.,
  renaming a `/sharing/<type>/` container) is a storage-mapping
  migration concern; see migration-design doc. The substrate's
  job is not to make path layouts negotiable per-installation.
- **Cross-app reads go through canonical item-types, not vocabulary
  translation.** An app reading another app's objects of a type
  relies on the shared `@onderling/item-types` schema for that type
  (see `packages/item-types/README.md`); there is no per-app format
  translation layer. This is the mechanism that makes the
  type-indexable standard above work.
- **No path-versioning** ("v2" suffix on container names). The
  storage-mapping config IS the version layer; apps that bump
  their layout edit the mapping, not the path.

## Pointers

- `packages/pod-onboarding/src/provisionDefault.js` — pod-side
  provisioning + WebID-profile patch
- `packages/pod-onboarding/src/initialResources.js` — initial
  config + agent-registry shapes
- `packages/pod-onboarding/src/webidPointers.js` — predicate URIs
- `packages/pod-onboarding/src/acpTemplates.js` — default ACPs
- `packages/pod-routing/src/configResource.js` — config-resource
  read/write
- `packages/agent-registry/` — agent-registry CRUD
- `packages/item-types/` — canonical type taxonomy (separate
  concern; this doc is about pod layout, not item shapes)
- Substrates-v2 functional design §4.2, §4.3 — pod-onboarding
  and pod-routing substrate intent
