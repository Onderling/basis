# Ports — the compatibility contract

A **port** is an interface that `@onderling/core` (the SDK kernel) defines and depends on, but does **not**
implement. The concrete implementations — the **adapters** — live outside the kernel: in `@onderling/transports`,
`@onderling/pod-client`, `@onderling/agent-registry`, or a third party's own package. The kernel talks to adapters
only through the port.

This is what lets the kernel stay small and lets anyone reimplement an adapter: **"compatible with the @onderling
SDK" means exactly "satisfies the port."** Two things make that concrete and checkable:

1. The port is a documented interface, exported from `@onderling/core`.
2. A **conformance harness** turns "satisfies the port" into a test you can run against any implementation.

> Implement the port **and** pass its conformance harness = your adapter is compatible.

*(This is the contract for **replacing an adapter**. For **adding functionality** — nouns, verbs, flows that run
inside Basis — see [`../extending.md`](../extending.md).)*

There are four ports today — three general adapters (`Transport`, `DataSource`, `ActorResolver`) and one
narrower store port (`StorageBackend`).

## `Transport` — the network adapter port

**Shape:** a base class, `packages/core/src/transport/Transport.js`, exported as `Transport` from
`@onderling/core`. An adapter `extends Transport`.

**What an adapter must do:**

- **Implement `_put(to, envelope) → Promise<void>`** — put one (already-encrypted, or `HI`-plaintext) envelope
  on the wire toward `to`. This is the *only* method a minimal adapter must override.
- **Call `this._receive(rawEnvelope)`** for each envelope it pulls off the wire, so the base class can run
  reply-correlation, auto-ACK, and dispatch.
- **Override the lifecycle hooks where relevant:** `connect()` / `disconnect()`, and — for *peer-scoped*
  transports whose reachability is per-peer (e.g. WebRTC rendezvous) — `canReach(peerAddress)` and
  `forgetPeer(address)`. Address-agnostic transports inherit the sensible defaults.

**What the base class provides for free** (an adapter must not re-implement these): the four interaction
primitives (`sendOneWay`, `sendAck`, `request`, `respond`, plus `sendHello`, `publishOneWay`,
`publishEnvelope`/`subscribeEnvelopes`), and three lifecycle behaviours layered on top of `_put`:

1. **Reply correlation** — `request`/`sendAck` register a pending promise keyed by the outbound envelope
   `_id`; an inbound `RS`/`AK` whose `_re` matches resolves it (and is not dispatched to the app).
2. **Auto-ACK** — an inbound `AS` envelope is acknowledged (`AK` back to the sender) *before* the `AS` is also
   dispatched to the application handler.
3. **Dispatch** — every other inbound envelope goes to the registered `receiveHandler` (or the `'envelope'`
   event when none is set).

**Reference adapters:** `InternalTransport` (in `@onderling/core`, in-process bus) and
`NknTransport` / `MqttTransport` / `RelayTransport` / `RendezvousTransport` (in `@onderling/transports`).

## `DataSource` — the storage adapter port

**Shape:** a base class, `packages/core/src/storage/DataSource.js`, exported as `DataSource`. An adapter
`extends DataSource`. Paths are opaque forward-slash keys (e.g. `notes/hello.txt`); every method is async.

**Contract:**

- `read(path)` → the stored value, or `null` when the path is absent.
- `write(path, data)` → create-or-overwrite; resolves when durable.
- `delete(path)` → remove the path; a **no-op** (never throws) when absent.
- `list(prefix='')` → every stored path that starts with `prefix`.
- `query(filter={})` → **optional** structured query. Adapters that can't support it leave the base method
  throwing; callers must treat `query` as best-effort.

**Reference adapters:** `MemorySource` / `IndexedDBSource` / `FileSystemSource` (in `@onderling/core`) and
`SolidPodSource` (in `@onderling/pod-client`).

## `StorageBackend` — the blind-ciphertext store port

**Shape:** a base class, `packages/core/src/storage/StorageBackend.js`, exported as `StorageBackend`. An adapter
`extends StorageBackend`. It is **deliberately narrower than `DataSource`**: three methods, ciphertext only.

**Why a separate, narrower port.** The whole point is that the *store* is a free choice, because the **seal** —
not the store's access control — gates who can read content. A caller seals a datum *above* this port (via the
seal resolver in `@onderling/pod-client`) and hands the resulting ciphertext down; the backend moves opaque bytes
it can never open. Keeping it separate from `DataSource` makes "the backend never sees plaintext" a property of
the **type**, not of discipline — there is no `read` that decodes and no `query` over cleartext.

**Contract:**

- `put(ref, ciphertext)` → store the opaque ciphertext under `ref` (create-or-overwrite); resolves when durable.
- `get(ref)` → the stored ciphertext, or `null` when `ref` is absent.
- `list(prefix='')` → every stored `ref` that starts with `prefix`.

`ref` is an opaque forward-slash key; `ciphertext` is an opaque string (a sealed envelope). It backs the sealed
per-circle chat log (`sealedMessageLog`, the `pod-signal`/`pod-only` data-move at rest — see `architecture.md`).

**Reference adapters:** `MemoryStorageBackend` (in `@onderling/core`) and `podStorageBackend` (in
`@onderling/pod-client`).

## `ActorResolver` — the actor-registry adapter port

**Shape:** a **structural (duck-typed) interface**, not a base class — a `@typedef` in
`packages/core/src/permissions/ActorResolver.js`. An adapter is any object matching the shape; there is no
class to `extend` and no runtime symbol to import (only the reference factory below). It resolves between an
agent's identifiers: `pubKey` (Ed25519, base64url), `webid` (URI), and `agentUri` (URI).

**Contract:**

- **`resolve(identifier)` (required)** → look up an agent by *any* of its identifiers; return the canonical
  `ActorRecord` on a hit, `null` on a miss. May be sync or async.
- `register(record)` (optional) — register an agent. Read-only adapters may omit it.
- `revoke(identifier)` (optional) — mark an agent revoked.

Core defines the interface but never imports the substrate; apps inject a resolver into core consumers
(`PolicyEngine`, `CapabilityToken.verify`) by dependency injection.

**Reference adapter:** `createInMemoryActorResolver()` (in `@onderling/core`, for tests + minimal apps); the
substrate implementation lives in `@onderling/agent-registry`.

## Conformance harness

The harness is the executable form of the contract. Each port ships an `assert…Conformance(makeImpl, {label})`
helper, exported from the **`@onderling/core/conformance`** subpath (source: `packages/core/src/conformance/`).
Point it at any implementation and it asserts the required methods exist **and** the port's behaviours
actually hold:

| Port | Helper | Reference impls it runs against |
|---|---|---|
| `Transport` | `assertTransportConformance(makePair, {label})` | `InternalTransport`, `RendezvousTransport` |
| `DataSource` | `assertDataSourceConformance(makeSource, {label, supportsQuery})` | `MemorySource` |
| `StorageBackend` | `assertStorageBackendConformance(makeBackend, {label})` | `MemoryStorageBackend` |
| `ActorResolver` | `assertActorResolverConformance(makeResolver, {label})` | `createInMemoryActorResolver` |

`assertTransportConformance` takes a factory that returns a *connected pair* `{ a, b, addrA, addrB, teardown }`
and exercises one-way delivery, request/response correlation, and `AS` auto-ACK end-to-end over the adapter's
own `_put`. (The `RendezvousTransport` run is gated on the `node-datachannel` WebRTC polyfill being installable,
and skips cleanly where it isn't — same as the existing rendezvous suite.)

A third party writing a new adapter wires the matching helper into their own test suite by importing the
first-class `@onderling/core/conformance` subpath — no relative paths, no copying:

```js
import { assertTransportConformance } from '@onderling/core/conformance';

it('MyTransport satisfies the Transport port', async () => {
  await assertTransportConformance(makeMyConnectedPair, { label: 'MyTransport' });
});
```

The helpers assert via `vitest`'s `expect`, so run them from a `vitest` test (vitest is a peer requirement of
this subpath); they are otherwise runner-agnostic — they only take your factory and assert.
