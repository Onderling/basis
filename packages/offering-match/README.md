# @onderling/offering-match

> **Layer: substrate.** Composes the `@onderling/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Post-Phase 4.2 contract:** OfferingMatch consumes a real `core.Agent` + `core.protocol.pubSub` directly. Do NOT reintroduce a `transport` shim or in-memory pubsub — the synthetic `InMemoryTransport` was the catastrophic case that triggered the substrate-vs-SDK audit.

Pubsub-of-skills + posture flag + closed-group governance for
matchmaking + claim flows.

This is **L1e** in the substrate-first plan
(`Project Files/Substrates/L1e-skill-match.md`).  Generalises Track A's
`SkillsPubSub` primitive (in flight in core); ships an `InMemoryTransport`
for V0 + tests, with a relay-backed transport coming when Track A
ships.

## Quick start

```js
import { OfferingMatch, InMemoryTransport } from '@onderling/offering-match';

const transport = new InMemoryTransport();   // V0; swap for relay-backed in production

// Bob's agent — declares skills + posture
const bob = new OfferingMatch({
  transport,
  group:      'household-1',
  localActor: 'https://id.example/bob',
  skills:     ['paint', 'drive'],
  posture:    { paint: 'always', drive: 'negotiable' },
});
await bob.start();
bob.subscribe(async ({ request, decide }) => {
  // For 'negotiable' skills, prompt the human and call decide()
  const ok = await promptUser(`Can you ${request.payload.text}?`);
  await decide(ok ? 'claim' : 'decline');
});

// Anne's agent — broadcasts a request
const anne = new OfferingMatch({
  transport,
  group:      'household-1',
  localActor: 'https://id.example/anne',
});
await anne.start();
const result = await anne.broadcast({
  requiredSkills: ['paint'],
  payload:        { taskId: 'T1', text: 'Repaint hallway' },
  timeoutMs:      30_000,
  expectClaims:   1,
});
// result.claims: [{actor, payload: {acceptedSkills}, at}]
```

## Posture flag

Per-agent, per-skill setting on the subscribing side:

| Posture | Behaviour when a matching request arrives |
|---|---|
| `'always'` | Auto-claim immediately.  Substrate fires `decide('claim')` before the handler runs. |
| `'negotiable'` (default) | Run the handler.  The handler typically prompts a human + calls `decide('claim'/'decline')`. |
| `'never'` | Substrate filters out before the handler runs. |

When a request requires multiple skills and the agent's postures
differ, the substrate uses the most-conservative posture across
matched skills (any `'never'` blocks; otherwise defer to handler).

## Group isolation

The `group` constructor argument scopes pubsub topics.  Agents in
different groups are invisible to each other on the same transport.
Real-world: each closed-group / household has its own group key;
the transport namespace mirrors that.

## Transport interface

```ts
interface OfferingMatchTransport {
  start():                Promise<void>;
  stop():                 Promise<void>;
  publish(topic, msg):    Promise<void>;
  subscribe(topic, fn):   () => void;
}
```

V0 ships `InMemoryTransport`.  V1+ swaps in a relay-backed transport
once Track A's SkillsPubSub primitive ships, plus an mDNS / BLE
transport for phone-side local matchmaking.

## Pattern source

Generalised from `packages/core/src/protocol/pubSub.js` (existing
topic pubsub) + Track D's `SkillsPubSub.js` (in flight) + the H4
+ H5 + H8 design docs.

## V0 simplifications

- Transport is single-process / in-memory.  Real distribution
  requires the relay-backed transport (V1+).
- No anonymity model (Q-H5 parked).
- No reputation / trust scoring on requesters.
- No persistence of unanswered requests (relay-side queue —
  Track E2b — is the mechanism for that, V1+).
- Skill-tag matching is exact substring; fuzzy / embedding match
  is V2+.
- No anti-spam / rate-limiting.  Closed-group governance via the
  group-key relay-allowlist is the V0 abuse mitigation.

## See also

- `Project Files/Substrates/L1e-skill-match.md` — sketch.
- `Project Files/Substrates/apps/{H4-tasks.md, H5-neighbourhood.md, H8-presence.md}` — primary consumers.
