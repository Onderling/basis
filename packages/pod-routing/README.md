# @onderling/pod-routing

Storage-function → URI mapping for the Decentralised-Web-Agent
(DWA) stack. Apps ask "where does `sharing/tasks/abc` live?" and
the substrate answers per the user's policy (or sensible defaults
when the user hasn't customised anything).

Also owns the **per-write pod-reachability cache** that the
graceful-degradation gate consults before deciding whether to fan
out via the replication-ring or queue for later pod upload.

> Standardisation Phase **52.3**. See
> `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
> and the functional design §4.3.

---

## What it does

```js
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting } from '@onderling/pod-routing';

const pseudoPod = createPseudoPod({
  backend:  createMemoryBackend(),
  mode:     'standalone',
  deviceId: 'laptop-anne',
});

const routing = createPodRouting({
  pseudoPod,
  deviceId:     'laptop-anne',
  anchorPodUri: 'https://anne.pod',  // null for no-pod users
});

await routing.reload();   // pulls config from the pseudo-pod (if any)

routing.resolve('private/identity-vault');
//   → 'https://anne.pod/private/identity-vault'

routing.resolve('sharing/tasks/abc');
//   → 'https://anne.pod/sharing/tasks/abc'

routing.resolve('group/circle-abc/tasks/x');
//   → 'https://anne.pod/circle-abc/tasks/x'   (centralised circle)
//   or 'pseudo-pod://laptop-anne/group/circle-abc/tasks/x'  (no-pod circle)

routing.isPodReachable();          // true / false (cache-backed)
```

---

## Storage functions

The substrate ships with the canonical vocabulary from the
functional design §4.3.1:

| Function | Default routing (pod-having) | Default routing (no-pod) |
|---|---|---|
| `private/identity-vault`   | `<anchor>/private/identity-vault`         | `pseudo-pod://<device>/private/identity-vault` |
| `private/state/<app>`      | `<anchor>/private/state/<app>`            | `pseudo-pod://<device>/private/state/<app>`    |
| `private/drafts/<app>`     | `<anchor>/private/drafts/<app>`           | `pseudo-pod://<device>/private/drafts/<app>`   |
| `sharing/profile-public`   | `<anchor>/sharing/public/profile-card`    | `pseudo-pod://<device>/sharing/public/profile-card` |
| `sharing/<resource>`       | `<anchor>/sharing/<resource>`             | `pseudo-pod://<device>/sharing/<resource>`     |
| `group/<circleId>/<container>` | per circle policy (centralised → group pod; no-pod → pseudo-pod) | pseudo-pod replication-ring |
| `personal-in-group/<circleId>` | `<anchor>/personal-in-group/<circleId>`   | `pseudo-pod://<device>/personal-in-group/<circleId>` |

Apps can declare additional storage-function names:

```js
routing.registerStorageFunction('app-extension/cache');
```

The registry is purely a label hint — actual routing is decided by
the mapping table (see below).

---

## Resolution pipeline

```
resolve(storageFn, vars)
  → if storageFn starts with 'group/<circleId>/':
       (a) explicit mapping wins (a user-overridden 'group/<circleId>/*')
       (b) circlePolicy(circleId) decides:
           - centralised → groupPodUri/<circleId>/<tail>
           - no-pod / decentralised / hybrid →
               pseudo-pod://<device>/group/<circleId>/<tail>
  → else: match the storageFn against the merged mapping table
       (defaults + user overrides) by exact-match-first,
       longest-prefix-glob-second
  → returns null if no rule matches
```

Mapping URIs support `<varname>` substitution from the caller-
supplied `vars` object — e.g.
`resolve('private/state/<app>', { app: 'tasks' })` substitutes
`app` if the matched template contains `<app>`.

---

## Config resource

The user's mapping config lives at:

- `<anchor-pod>/private/storage-mapping` for pod-having users
  (read via `pod-client` once Phase 52.6 lands).
- `pseudo-pod://<deviceId>/private/storage-mapping` for no-pod
  users (V0).

In V0 the config is **always** read/written from the pseudo-pod,
even for pod-having users. The pod-side path activates with
Phase 52.6 (`pod-client` extensions).

Wire shape (forward-additive):

```json
{
  "version": 2,
  "defaultPolicy": "one-pod",
  "mappings": {
    "sharing/*": "https://anne.pod/sharing/",
    "group/circle-abc/*": "https://anne.pod/sharing/stoop/abc/"
  },
  "circlePolicies": {
    "circle-abc":     {"policy": "centralised", "groupPodUri": "https://anne.pod"},
    "household-xyz": {"policy": "no-pod"},
    "project-def":   {"policy": "decentralised"}
  },
  "updatedAt": "2026-05-11T10:00:00Z"
}
```

API:

```js
await routing.reload();
await routing.updateMapping({ fn: 'sharing/*', uri: 'https://other.pod/sharing/' });
await routing.setCirclePolicy('circle-xyz', { policy: 'no-pod' });
```

`reload()` pulls the latest config from the pseudo-pod. `null`
return = no config yet (defaults remain in effect). Throws
`INVALID_CONFIG` if the resource exists but isn't a parseable
object.

---

## Reachability cache

```js
routing.isPodReachable();                         // for the anchor pod
routing.isPodReachable('https://bob.pod');        // for any specific pod
routing.markPodReachable('https://anne.pod');     // pod-client calls this on success
routing.markPodUnreachable('https://anne.pod');   // and this on failure
```

Semantics (locked 2026-05-11):

- **Default verdict when unknown**: reachable. We err on trying —
  a failed write transparently falls back to the replication-ring
  queue. Assuming unreachable would gratuitously block writes.
- **Fresh failure wins** (within TTL) — a recent error pulls the
  verdict to `false`.
- **Fresh success overrides a fresh failure** — `pod-client`
  marks `reachable` on every successful round-trip.
- **TTL** defaults to 30 s; configurable via
  `reachabilityTTLms`.
- `pseudo-pod://` URIs always read as reachable.

The cache state is keyed per-target URI so multi-pod users
(e.g. private-on-A, sharing-on-B) get independent verdicts.

---

## API

```text
createPodRouting({ pseudoPod, deviceId, anchorPodUri?, reachabilityTTLms?, now? })
  → routing

// Resolution
routing.resolve(storageFn, vars?)        → uri | null
routing.circlePolicy(circleId)               → { policy, groupPodUri? }
routing.listStorageFunctions()           → string[]
routing.registerStorageFunction(name)    → void

// Reachability
routing.isPodReachable(uri?)             → boolean
routing.markPodReachable(uri?)           → void
routing.markPodUnreachable(uri?)         → void

// Config I/O
await routing.reload()                   → StorageMappingConfig | null
await routing.updateMapping({fn, uri})   → void
await routing.setCirclePolicy(circleId, p)   → void

// Introspection
routing.configResourceUri
routing.anchorPodUri
routing.deviceId
routing.config                           // current loaded config (frozen) or null
routing.defaults                         // computed default policy
```

---

## What V0 deliberately does not do

- **Read https:// config resources.** V0 always reads the config
  from the pseudo-pod. Pod-side reading lands with Phase 52.6.
- **WebID pointer-walk.** Functional design §4.3.6 describes
  reading `storage-mapping-uri` from the user's WebID profile via
  `@onderling/webid-discovery`. Deferred — no-pod users don't have
  a WebID; pod-having users get this with 52.6.
- **Migration logic.** Moving from one-pod to two-pod, or adding
  a second pod, requires ref-rewriting in already-written
  resources. Open question per the functional design §4.3.6.
- **`decentralised` and `hybrid` circle policies.** V0 treats both
  as "use the pseudo-pod replication-ring" (same as `no-pod`).
  Future work splits them: `decentralised` stores per-member on
  each member's pod; `hybrid` mixes per-resource.
- **Persistence of the reachability cache.** In-memory only.
  Restart resets verdicts to "unknown → reachable".

See `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
§4.3.6 for the full open-question list.

---

## Files

```
packages/pod-routing/
├── index.js
├── src/
│   ├── PodRouting.js         — createPodRouting()
│   ├── storageFunctions.js   — pattern matcher + var substitution
│   ├── defaultPolicy.js      — default mappings (pod-having + no-pod)
│   ├── reachability.js       — reachability cache
│   └── configResource.js     — pseudo-pod read/write helpers
└── test/                      — 63 tests
```
