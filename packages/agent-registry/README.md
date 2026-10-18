# @onderling/agent-registry

The user's agents listed in one canonical pod resource. Implements
core's `ActorResolver` interface so `PolicyEngine` +
`CapabilityToken.verify` can bridge between identifier shapes
(pubKey / webid / agentUri / agentId / deviceId).

---

```
npm install @onderling/agent-registry
```

## Quick start

```js
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry, makeActorResolver } from '@onderling/agent-registry';

const pseudoPod = createPseudoPod({ /* … */ });
const registry  = createAgentRegistry({
  pseudoPod,
  anchorPodUri: 'https://anne.pod',   // or omit + supply deviceId for no-pod
});

await registry.register({
  agentId:      'laptop-anne',
  pubKey:       '<base64>',
  webid:        'https://anne.pod/profile#me',
  agentUri:     'https://anne.pod/profile#me/agent/laptop',
  role:         'device',
  name:         'Anne (laptop)',
  deviceId:     'laptop-anne',
  capabilities: ['pinboard', 'tasks'],
});

await registry.lookup('<base64>');                  // by pubKey
await registry.lookup('https://anne.pod/profile#me'); // by webid

// Bridge into core's ActorResolver-shaped consumers.
const resolver = makeActorResolver(registry);
agent.policyEngine.setActorResolver(resolver);
```

---

## Wire shape

Lives at `<anchor-pod>/private/agent-registry` (or
`pseudo-pod://<deviceId>/private/agent-registry` for no-pod users):

```json
{
  "v": 1,
  "agents": [
    {
      "agentId":   "laptop-anne",
      "pubKey":    "<base64>",
      "webid":     "https://anne.pod/profile#me",
      "agentUri":  "https://anne.pod/profile#me/agent/laptop",
      "role":      "device",
      "name":      "Anne (laptop)",
      "deviceId":  "laptop-anne",
      "capabilities": ["pinboard", "tasks"],
      "signedAt":  "2026-05-11T10:00:00Z",
      "revokedAt": null
    }
  ],
  "updatedAt": "2026-05-11T10:00:00Z"
}
```

Forward-additive: extra fields on agents tolerated; renames require a
new entry path.

---

## API

```text
createAgentRegistry({ pseudoPod, anchorPodUri?, deviceId?, resourceUri?, maxRetries?, onPersistentConflict?, now? })

await registry.register(entry)              // create or update by agentId
await registry.lookup(identifier)            // pubKey / webid / agentUri / agentId / deviceId
await registry.revoke(identifier)            // sets revokedAt
await registry.updateCapabilities(id, caps)  // replace caps array
await registry.list()                        // full agent list (frozen)
await registry.reload()                      // re-read from pod

registry.resourceUri                          // computed URI
```

```text
makeActorResolver(registry) → ActorResolver
  // implements core's ActorResolver interface (resolve / register / revoke)
  // resolve(identifier) → { pubKey, webid, agentUri, role, capabilities, revokedAt } | null
```

---

## Concurrency

Each mutation reads the current resource (with its etag), applies the
change, and writes back with `If-Match: <etag>`. On `CONFLICT`
(`412`-shaped error from the pseudo-pod's underlying store) we
backoff + retry (default 3 attempts, exponential 10/50/200 ms). After
exhausting retries, the substrate surfaces a `PERSISTENT_CONFLICT`
error and fires the caller-supplied `onPersistentConflict` callback —
typical UX: prompt the user to reload.

Note: pseudo-pod V0/V1 doesn't yet enforce CAS itself. The
substrate-level retry helper is wired so that when a pseudo-pod
backend gains etag-aware writes, the agent-registry substrate gets
concurrency for free.

---

## What V0 deliberately does not do

- **Cross-user resolution.** This registry holds ONE user's agents.
  Apps that need to bridge across users use the existing
  `@onderling/identity-resolver` MemberMap on top.
- **Signature verification.** The `signedAt` field exists for
  audit-trail consumers; the substrate does not verify the
  signature on read. Real-pod ACPs gate write access.
- **Bulk migrate.** No batch register / revoke API. Apps loop over
  individual calls; each enjoys the per-entry CAS retry.
- **WebID profile patching.** Pointer predicates on the user's WebID
  profile (`dec:agent-registry-uri`) are wired by
  `@onderling/pod-onboarding`.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/agent-registry`).
