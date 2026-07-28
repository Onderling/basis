# @onderling/sdk

The layered developer facade over the onderling platform — the kernel
(`@onderling/core`) plus the default adapters (`@onderling/vault`,
`@onderling/transports`, `@onderling/pod-client`), packaged as **one import**.
The fast path is "import one thing, connect your app functions to skills,
done"; when you need more control you drop to a lower level and wire the
adapters yourself. The kernel stays de-fatted — the defaults live here, in
the facade, never back in `@onderling/core`.

Every sub-path below is a real entry in `package.json` `exports`. Nothing
here is aspirational; if a symbol isn't in the code it isn't documented.

```
npm install @onderling/sdk
```

## The three import levels

### Level 2 — batteries included (`@onderling/sdk/high`)

The fast path. Three helpers that inject the defaults so a lone agent
"just works" with no network config.

```js
import { createAgent, connectSkill, wireSkill } from '@onderling/sdk/high';

// createAgent: build + start a core.Agent with a VaultMemory identity and an
// in-process InternalTransport (or a RelayTransport if you pass relayUrl).
const agent = await createAgent();

// connectSkill: map a plain app function onto a skill by name.
connectSkill(agent, 'greet', (args) => `Hi ${args.name}`);
```

- `createAgent(opts)` — Tier-3 "run as an agent". Defaults: `VaultMemory`
  vault, restore-or-generate `AgentIdentity`, in-process `InternalTransport`
  (loopback-capable, so local skills run with no network). Overridable:
  `identity`, `vault`, `transport`, `relayUrl`, `bus`, `skills`, `peers`,
  `label`, `autoStart`, `config`. Returns the started `core.Agent`.
- `connectSkill(agent, name, appFn, opts?)` — Tier-1 plain function → skill.
- `wireSkill(coreFn, op, { storeFor })` — manifest-op → skill handler.

### Level 1 — explicit adapters (sub-path slices)

Take only the pieces you need and wire them yourself. Each slice is exactly
one part of the platform:

| Import | Re-exports |
| --- | --- |
| `@onderling/sdk/core` | the whole kernel `@onderling/core` — `Agent`, `AgentIdentity`, `InternalBus`, `InternalTransport`, `OfflineTransport`, `Parts`, the ports, … |
| `@onderling/sdk/transports` | `NknTransport`, `MqttTransport`, `RelayTransport`, `RendezvousTransport` |
| `@onderling/sdk/vault` | `Vault`, `VaultMemory`, `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`, `OAuthVault`, `makeAuthorizedFetch` |
| `@onderling/sdk/pod` | the whole `@onderling/pod-client` surface — `PodClient`, `SolidPodSource`, `ConflictResolver`, sealing / sharing / tombstones, … |

```js
import { Agent, AgentIdentity } from '@onderling/sdk/core';
import { RelayTransport }       from '@onderling/sdk/transports';
import { VaultMemory }          from '@onderling/sdk/vault';

const id = await AgentIdentity.generate(new VaultMemory());
const agent = new Agent({ identity: id, transport: new RelayTransport({ identity: id, relayUrl }) });
await agent.start();
```

### Level 0 — the barrel (`@onderling/sdk`)

Everything from every slice, plus the high-layer helpers, in one import —
for convenience. The barrel is the *sum* of the slices, so any
`import { X } from '@onderling/sdk'` resolves to the same symbol as the slice
it came from.

```js
import { createAgent, connectSkill, Agent, VaultMemory, RelayTransport } from '@onderling/sdk';
```

## `connectSkill` vs `wireSkill`

Both turn something into a `core` skill handler; they differ in what drives
the shape.

- **`connectSkill(agent, name, appFn)`** — handler-based, manifest-agnostic.
  Maps one plain function to one skill by position. It decodes the inbound
  parts into friendly `args` and calls `appFn(args, ctx)`. Use it for quick
  ad-hoc skills and for wiring where there is no manifest op.
- **`wireSkill(coreFn, op, { storeFor })`** — manifest-driven. It *generates*
  the handler from a `manifest.js` operation declaration (`{ id, params,
  visibility, … }`): decode → validate `args` against `op.params` → resolve
  the per-scope store via `storeFor(ctx)` → call `coreFn(store, args, ctx)`.
  Use it when the manifest is the contract and per-scope state lives outside
  the single agent (CLAUDE.md invariant #6).

## `@onderling/sdk/requires` — the capability vocabulary

The declarative seam between an app's needs and the SDK slices. An app
declares a `requires: [...]` list drawn from a small, fixed vocabulary; a
validator checks it.

```js
import { CAPABILITIES, validateRequires } from '@onderling/sdk/requires';

CAPABILITIES; // ['core', 'transports', 'vault', 'pod', 'high']

validateRequires(['core', 'vault']);
// → { ok: true, unknown: [], missing: [] }

validateRequires(['core', 'blockchain']);
// → { ok: false, unknown: [{ capability: 'blockchain', code: 'ERR_REQUIRES_UNKNOWN_CAPABILITY' }], missing: [] }
```

Exports: `CAPABILITIES`, `REQUIRES_CODES` (stable diagnostic codes — branch
on codes, not message text), `validateRequires(requires, { available? })`.
This is the vocabulary `@onderling/app-scaffold` validates against before it
generates anything.

## `@onderling/sdk/testing` — the `local ≡ wire` fitness harness

`describeLocalWireFitness(config, { describe, it, expect })` proves an
extracted core behaves identically whether it is called **directly** (the
local route, over its store) or **through the wire** (wrapped by `wireSkill`,
registered as a `defineSkill`, invoked over the serialized parts path on a
real agent). It asserts two things:

1. **Equivalence** — each representative case yields the same result on both
   routes once volatile fields (ids, timestamps, per-route actor identity,
   sync envelopes) are stripped.
2. **Route parity** — the extracted-core id set, the wire-registration id
   set, and the manifest-op id set line up, so an op can't exist on one
   route but not the other.

It is framework-agnostic (you pass in `{ describe, it, expect }`, so the SDK
carries no test-runner dependency) and parameterized per app. Also exported:
`stripVolatile`, `diffRouteParity`, `DEFAULT_VOLATILE_KEYS`.

## `@onderling/app-scaffold`

A sibling package (not re-exported by the SDK) that turns a manifest into a
runnable skeleton.

```js
import { scaffoldApp } from '@onderling/app-scaffold';

const { files, warnings } = scaffoldApp({ manifest, requires: ['core', 'high'], appId: 'my-app' });
```

It validates `requires` via `@onderling/sdk/requires` (unknown capability → a
coded throw, nothing scaffolded), then emits `package.json` + `manifest.js` +
`src/index.js` (a `createAgent` entry with one `wireSkill` stub per manifest
operation) + a README stub. The generated app's sole dependency is
`@onderling/sdk`; every capability resolves through an SDK sub-path. Fill in the
per-op cores and you have a working app.

## Substrates alongside the SDK

Some platform functionality ships as its own published package and is
consumed directly, **not** re-exported through this SDK — for example
`@onderling/redaction` (config-driven redaction) and `@onderling/pseudo-pod`
(a Solid-shaped local store). Import those from their own package names; the
SDK's job is the kernel + default-adapter facade, not a barrel over every
substrate.

## Where this sits in the layering

Apps build on substrates, substrates build on the kernel (`@onderling/core`)
plus its adapters. `@onderling/sdk` is the developer-facing **facade** over
that whole stack — the low levels
re-export the kernel and adapters; the high level adds the opinionated
helpers. Full detail:
[`docs/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/sdk`).
