# @onderling/webid-discovery

> **Layer: substrate.** WebID-profile pointer-walk + resolution.
> Authored 2026-05-11 as part of the standardisation P1 work (Phase
> 50.2 — see `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`).

## What it does

The standardisation plan writes a small set of **pointer predicates**
onto each user's WebID profile (§II.3 + §II.8 of the plan), telling
clients where to fetch the heavy state resources:

| Predicate (full IRI / short) | Points at |
|---|---|
| `dec:storage-mapping-uri` | `<anchor-pod>/private/storage-mapping` |
| `dec:agent-registry-uri`  | `<anchor-pod>/private/agent-registry`  |
| `dec:audit-log-uri`       | `<anchor-pod>/private/audit-log`       |

This substrate provides:

- **`discoverPointers(webidUri, { fetch })`** — fetch the WebID
  profile + parse the pointer predicates out of it (Turtle or
  JSON-LD).
- **`resolvePointers(pointers, { read })`** — for each pointer,
  fetch the pointed-at resource via a caller-supplied reader
  (typically the pseudo-pod's `read` method).
- **`WebIdCache`** — in-memory cache of pointers + resolved
  resources, with optional heartbeat refresh + event emission.

The substrate has **no runtime dependency on `@onderling/core`** or
on `@onderling/pod-client`. Callers wire in their own `fetch`
(authenticated or anonymous) and `read` (pseudo-pod, pod-client,
or a test shim).

## Public API

```js
import {
  discoverPointers,
  resolvePointers,
  WebIdCache,
  WEBID_PREDICATES,
} from '@onderling/webid-discovery';
```

### `discoverPointers(webidUri, { fetch })`

```js
const { pointers, raw } = await discoverPointers(
  'https://alice.example/profile/card#me',
  { fetch: agent.oidc.getAuthenticatedFetch() }
);
// pointers = {
//   storageMappingUri?: 'https://alice.pod/private/storage-mapping',
//   agentRegistryUri?:  'https://alice.pod/private/agent-registry',
//   auditLogUri?:       'https://alice.pod/private/audit-log',
// }
// raw = unparsed profile body
```

Throws `FETCH_FAILED` (with `.status`) on non-2xx response;
`INVALID_ARGUMENT` on bad input.

### `resolvePointers(pointers, { read, onError? })`

```js
const resolved = await resolvePointers(pointers, {
  read: pseudoPod.read.bind(pseudoPod),
  onError: (err, key, uri) => console.warn(`resolve ${key} failed:`, err),
});
// resolved = {
//   storageMapping?: <whatever read returned>,
//   agentRegistry?:  <whatever read returned>,
//   auditLog?:       <whatever read returned>,
// }
```

Per-pointer read failures are caught (surfaced via `onError`); the
overall call only fails if `pointers` or `read` is invalid.

### `WebIdCache`

```js
const cache = new WebIdCache({
  webid:       'https://alice.example/profile/card#me',
  fetch:       agent.oidc.getAuthenticatedFetch(),
  read:        pseudoPod.read.bind(pseudoPod),
  heartbeatMs: 60_000,  // default; pass 0 to disable
});

await cache.refresh();
cache.pointers.storageMappingUri;  // → URI
cache.storageMapping;              // → resolved resource

cache.start();   // begin heartbeat
cache.on('refresh', ({ pointers, resolved }) => { /* react */ });
cache.on('error',   (err) => { /* heartbeat refresh failed */ });
cache.stop();
```

`WebIdCache` extends `node:events.EventEmitter`. Heartbeat
intervals are `unref`'d so they don't keep the Node process alive
on their own.

## Where this substrate sits

```
                          @onderling/core
                                │
                                ▼
                  ┌─────────────────────────────┐
       wires this substrate via                  │
       core.identity.webid (small wrapper)       │
                                │                │
                                ▼                ▼
                  ┌───────────────────────┐  ┌────────────────┐
                  │ @onderling/webid-      │  │ @onderling/     │
                  │   discovery (this)    │  │   pseudo-pod   │
                  │ - discoverPointers    │  │ (P1 substrate, │
                  │ - resolvePointers     │  │  forthcoming)  │
                  │ - WebIdCache          │  └────────────────┘
                  └───────────────────────┘
                                ▲                ▲
                                │                │
                  callers wire `fetch` + `read` in:
                  - `fetch` = oidc-session's authenticated fetch
                  - `read`  = pseudo-pod.read OR pod-client.fetch
```

## Predicate namespace

Predicates live under `https://onderling.org/ns#`. Short form is
`dec:` (matched by `discoverPointers`'s Turtle parser without
requiring a `@prefix` declaration). Both forms are recognised:

- `<https://onderling.org/ns#storage-mapping-uri>` (full IRI)
- `dec:storage-mapping-uri` (short)

JSON-LD profiles can use either the full-IRI key, the short-name
key, or the `@id`-wrapped object form.

## Bring it up

```bash
cd packages/webid-discovery
npm install
npm test
```

## Tests

- `test/discoverPointers.test.js` — JSON-LD + Turtle parsing,
  fetch integration, error cases.
- `test/resolvePointers.test.js`  — per-pointer resolution,
  error handling, invalid args.
- `test/WebIdCache.test.js`       — refresh state, events,
  heartbeat cadence, idempotent start, disappearing pointers,
  per-pointer failure preserves previous value.

## See also

- [`@onderling/oidc-session`](../oidc-session/) — typically supplies
  `fetch` for authenticated profile reads.
- [`@onderling/pseudo-pod`](../pseudo-pod/) (forthcoming, P1) —
  typically supplies `read` for resolving pointers.
- `Project Files/SDK/core-v2-functional-design-2026-05-11.md`
  §4b — design context.
- `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
  §4.3 — storage-mapping pod resource; §4.6 — agent-registry pod resource.
