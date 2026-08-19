# Single-agent rule

**Rule.** Each app's service-context owns exactly **ONE**
`core.Agent` instance. Transports — mDNS, BLE, relay, rendezvous,
NKN, A2A, etc. — are **routes** plugged into that one agent via
`agent.addTransport(name, transport)` + a `RoutingStrategy`. They
are not agent-like entities; they are pluggable per-peer
reachability primitives the agent picks among at send time.

Apps with multiple scopes (groups, accounts, projects, circles, …)
keep per-scope state **outside** the agent — typically a
`Map<scopeId, ScopeState>` where each `ScopeState` has its own
`ItemStore` / `MemberMap` / `OfferingMatch` / mirror but **shares**
the agent. Skills register on the agent **once**, with a
context-resolver (`getBundle(args, ctx)`) so dispatch picks the
right scope based on the call's `args.scopeId` (e.g. `groupId`,
`circleId`) or the inbound envelope's pubsub topic.

## Why

A `core.Agent` owns transport-level identity (one pubkey), the
`RoutingStrategy`, the `PeerGraph`, the SecurityLayer, the skill
registry, and one mDNS service registration / one relay WebSocket
connection per registered transport. Spinning up N agents to
model N scopes creates:

- N parallel mDNS service registrations under the SAME identity →
  collisions or one-winner races.
- N concurrent WebSocket connections to the relay broker, all
  registered under the same pubkey → ambiguous routing.
- N PeerGraphs that don't share discovery state.
- N independent transport stacks → wasted battery + memory.
- Visibly confusing transport-level logs — hard to reason about
  what's actually happening on the wire.

This was a real bug in `apps/stoop-mobile` for several days
(tracked in `Project Files/Stoop/single-agent-refactor-2026-05-08.md`).
It's a regression that's easy to introduce — every "factory that
takes a transport and builds an Agent" tempts you to call it once
per scope. Don't.

## Anti-pattern

```js
// ❌ Wrong — each group gets its own Agent + its own transport stack.
for (const groupId of joinedGroups) {
  const agent = await buildMeshAgent({ identity, ... });   // one per group
  const bundle = await createNeighbourhoodAgent({ agent, ... });
  groups.set(groupId, bundle);
}
```

## Correct pattern

```js
// ✅ Right — one Agent for the app, N scope-states share it.
const meshAgent = await buildMeshAgent({ identity, ... });   // ONE total

// Skills register ONCE on the shared agent, group-aware.
for (const def of buildSkills({ getBundle, ...crossBundleDeps })) {
  meshAgent.skills.register(def);
}

// Per-group state on top of the shared agent — no new transports.
for (const groupId of joinedGroups) {
  const state = await buildGroupState({ meshAgent, groupId, ... });
  groups.set(groupId, state);
}

// getBundle resolves which group a skill call is for:
function getBundle(args, ctx) {
  const g = args?.groupId ?? _topicGroup(ctx?.envelope);
  return g ? (groups.get(g) ?? bootstrap) : null;
}
```

## When to lift to a substrate

This pattern is currently implemented per-app:
- `apps/stoop-mobile`'s `ServiceContext` + `buildGroupState`.
- (Future) `apps/tasks-v0` / `apps/tasks-mobile`'s equivalent for
  multi-circle.

When the second consumer (Tasks) implements it, lift the common
helpers to a substrate — likely `@onderling/scoped-skill-bus` or
folded into `@onderling/offering-match`. The shape worth lifting:

```js
buildScopedSkillBus({
  meshAgent,
  scopes,                  // Map<scopeId, ScopeState>
  buildSkills,             // app-specific skill builder
  resolveScopeId(args, ctx) // app-specific resolver
})
```

Until the second consumer exists, **each app copies the pattern
from this doc + the Stoop reference implementation**. Do not
pre-lift — by the rule of two, lift only when concretely needed
by two real apps so the API surface is informed by both.

## Where this rule applies

- All RN apps (`apps/*-mobile`).
- All long-lived Node apps (`apps/tasks-v0`, future bots, sync
  services).
- All apps that host a `core.Agent`, full stop. The CLI testbeds
  that spin up N agents in one process for end-to-end testing
  are the explicit exception — they're modelling N processes,
  not N scopes within a process.
