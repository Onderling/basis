# Architectural layering — kernel > substrates > apps

> **This is a project-wide invariant.** Any AI or human working on this
> repo MUST keep it top-of-mind. New code that violates the layering
> needs an explicit, in-PR justification.

---

| | |
|---|---|
| **Status** | locked 2026-05-04 |
| **Triggered by** | substrate-vs-kernel refactor audit (`Project Files/Substrates/refactor/00-Overview.md`) discovered 5 of 10 substrates were reinventing primitives the kernel already provided. |
| **Companion docs** | [`./app-readme-scheme.md`](./app-readme-scheme.md), `../Substrates/policies.md`, `../Substrates/refactor/00-Overview.md` |

---

## The principle in one paragraph

The codebase has **three layers**, and dependencies flow strictly
downward: **apps** depend on **substrates**, **substrates** depend on
the **kernel** (`@onderling/core`) + its **adapters** (`@onderling/transports`,
`@onderling/pod-client`, `@onderling/vault`). Apps **may** consume the kernel
directly when no substrate fits, but every such direct dependency must be
**justified explicitly** in the app's README. Substrates **must not**
reinvent primitives the kernel already provides — if the substrate's API
is reshaping something the kernel has, the substrate is wrong, not the
kernel. (The dev-facing **SDK is `@onderling/sdk`** — the layered facade over
the whole platform; see [`../architecture.md`](../architecture.md).)

```
┌───────────────────────────────────────────────────────────────────┐
│  apps/                                                            │
│  Apps compose substrates.  Direct kernel use is allowed when      │
│  justified — see app-readme-scheme.md.                            │
└────┬────────────────────────────────────────────────────────────┬─┘
     │                                                            │
     │ (preferred)                                  (allowed with  │
     ▼                                               justification)│
┌───────────────────────────────────────────────────────────────┐  │
│  packages/{item-store, agent-ui, offering-match, notifier,    │  │
│            identity-resolver, sync-engine, chat-agent,        │  │
│            llm-client, oauth-vault, pod-search}               │  │
│  Substrates compose core.  They MUST NOT reinvent kernel      │  │
│  primitives.  When they do, that is a bug — see audit.        │  │
└────────────────────────────┬──────────────────────────────────┘  │
                             │                                     │
                             ▼                                     ▼
┌───────────────────────────────────────────────────────────────────┐
│  packages/core — the KERNEL: Agent, envelope, skill registry,     │
│  callSkill gate, identity, InternalTransport, + the PORTS          │
│  (Transport / DataSource / ActorResolver). Concrete ADAPTERS live  │
│  OUTSIDE: @onderling/transports, @onderling/pod-client, @onderling/vault.   │
│  Dev entry = @onderling/sdk (the facade over the whole platform).     │
└───────────────────────────────────────────────────────────────────┘
```

---

## What each layer owns

### The kernel + adapters — `packages/core` + `@onderling/transports` · `@onderling/pod-client` · `@onderling/vault`

The foundation. **Stable** — substrate + app authors read it as a reference, not modify it casually.

- `@onderling/core` — the **KERNEL**: identity, security, routing, the `Agent` class, skill registry +
  `defineSkill`, protocols (pubSub, SkillsPubSub, taskExchange, messaging, …), permissions (PolicyEngine,
  CapabilityToken, GroupManager), `InternalTransport`, and the **ports** (`Transport`/`DataSource`/`ActorResolver`,
  see [`ports.md`](./ports.md)). It holds **no concrete adapters** and depends *up* on nothing (guarded by
  `packages/core/test/layering.enforcement.test.js`).
- `@onderling/transports` — the concrete network transports (`Nkn`/`Mqtt`/`Relay`/`Rendezvous`), extracted OUT of the
  kernel; each an adapter over the `Transport` port.
- `@onderling/pod-client` — high-level Solid pod read/write/list/conflict **plus** the on-pod storage adapters
  (`SolidPodSource`/`PodExporter`) and on-pod identity (`IdentityPodStore`/`IdentitySync`) — all moved out of core.
- `@onderling/vault` — the Vault family (memory / local-storage / IndexedDB / node-fs / OAuth).
- `@onderling/relay` — relay broker + offline queue + multi-recipient fan-out + group auth + push wake.
- `@onderling/react-native` — RN platform layer (polyfills, Metro preset, BLE/mDNS/Keychain adapters, MobilePushBridge).
- `@onderling/sdk` — **the developer SDK**: the layered facade over the whole platform (low layer re-exports the
  above; high layer = `createAgent` / `connectSkill`).

### Substrates — `packages/{item-store, agent-ui, ...}` (L1a–L1j)

Reusable building blocks **on top of** the kernel + adapters. Each substrate is shaped
by **at least two consumer specs** before its API locks (rule of two —
see `policies.md`).

**Substrate authors MUST:**
- Compose kernel + adapter primitives directly. If you find yourself implementing
  something that "looks like" a `Vault` / `Transport` / `MergeContract` /
  `OAuthVault` / event emitter — stop. The kernel + adapters have it.
- Declare every kernel/adapter package they use in `package.json` `dependencies`
  (or `peerDependencies` for RN). Zero `@onderling/*` deps is a code
  smell for a substrate; the audit flagged that as the structural
  signature of SDK-bypass.
- Use `core.Emitter` (not `node:events`) so RN consumers don't break.
- Use `core.genId` (not inline ULID copies).
- Document substrate↔substrate boundaries explicitly. If L1f notifier
  needs a `MessagingBridge`-shaped thing and L1c chat-agent already has
  one, import L1c's; do not redefine.

**Substrate authors MUST NOT:**
- Reinvent transports, vaults, auth, merge contracts, push primitives,
  skill registries, identity, or any other kernel or adapter abstraction.
- Ship "InMemory*" fakes that have no production partner. If your
  substrate's only concrete implementation is an in-memory backend, it
  isn't built on the kernel — it's parallel to it.
- Reach into another substrate's internals. Compose via the public
  exports.

### Apps — `apps/*`

Thin compositions. App-specific glue + UI on top of substrates.

**Apps MUST:**
- Declare in their README which substrates they consume and what for
  (see [`app-readme-scheme.md`](./app-readme-scheme.md) for the
  required sections).
- **Justify every direct kernel use.** Direct dependencies on
  `@onderling/core` / `@onderling/relay` / `@onderling/pod-client` /
  `@onderling/react-native` are allowed but must be listed in the
  README with a one-line reason — typically "no substrate yet for X".
  An unjustified direct kernel dep is treated as a bug; either the app is
  reaching past a substrate that should have served it, or a substrate
  needs to be created (rule of two when a second app needs it).
- Stay extraction-clean (cf. `coding-plans/track-H-apps.md` §
  "Extraction-friendly rules"): never import from sibling app source;
  use only public package APIs.

**Apps MAY:**
- Use the kernel directly *when no substrate fits*, with the README
  justification above. Folio mobile is the canonical example: it uses
  `pod-client.PodClient` and `core.Bootstrap` directly because no
  substrate currently wraps that flow, and the layering would actually
  hurt at this stage.

**Apps MUST NOT:**
- Ship code that another app should consume. Cross-app imports are
  banned. If app A has a thing app B wants, it goes to a substrate
  (after rule-of-two).
- Modify substrate, kernel, or adapter source from inside `apps/`. PRs touching
  packages must call themselves out as such.

---

## How to handle disagreement with the kernel

When a substrate or app needs something the kernel *almost but not quite*
provides, the choices are:

1. **Compose** what's there + add app/substrate-local logic. Default
   answer.
2. **Extend the kernel** with a small additive change — a new method, a
   new export, a re-export of an existing internal. Open a PR against
   `packages/core` (or wherever fits). This is what we did for
   `RelayTransport.registerPushToken` and `SolidPodSource.list({recursive})`
   on 2026-05-04 — both were small, additive, and shipped with tests
   in the same session.
3. **Lift a pattern from a working app or substrate** to the kernel or to
   a substrate, after the rule-of-two check. The audit identified
   several such candidates (Household's `MemberWebIdMap`, Folio's
   `serviceBuilder` pattern).

**What is NOT acceptable:**
- Forking a kernel abstraction inside a substrate.
- Reinventing a kernel abstraction inside an app to dodge an awkward fit.
- "Quick fixes" that bypass core because composing seemed too hard.

When in doubt, the audit doc
(`../Substrates/refactor/00-Overview.md`)
records the decisions and what the failure modes look like.

---

## Apps must not import from other apps (locked 2026-05-06)

> **Apps under `apps/` MUST NOT import from sibling apps.** If two
> apps need to share code — a factory, an Agent subclass, a
> service builder, anything — the shared code goes into a substrate
> under `packages/`, not into an app one of them depends on.

Reasoning:

- Cross-app imports create undeclared dependency graphs and silent
  divergence pressure (one app evolves; the other inherits or forks).
- Substrates are the project's mechanism for "two consumers want the
  same thing"; the rule-of-two policy is built around them.
- App lifecycles diverge: one may be sunset, renamed, or
  experimentally refactored while the other expects stability. A
  substrate has clearer versioning and review surfaces.
- An app importing from another app reads as "this *is* a substrate
  pretending not to be one"; the right move is to extract.

**Platform-shell exception (locked 2026-05-08).** When two apps in
`apps/` are **platform-shells of the same product** (e.g. `apps/folio`
+ `apps/folio-mobile`, `apps/stoop` + `apps/stoop-mobile`, or
`apps/tasks-v0` + `apps/tasks-mobile` — the `-v0` desktop suffix still
counts as the shared shell),
the mobile shell MAY import the SyncEngine / Agent subclass +
app-specific hook implementations from the desktop / shared shell.
This is acknowledged as a single-product dependency, not a
cross-app coupling. Three constraints apply:

1. **The two packages name-relate.** `apps/folio-mobile` ↔ `apps/folio`;
   `apps/stoop-mobile` ↔ `apps/stoop`; `apps/tasks-mobile` ↔
   `apps/tasks-v0`. Same product, separate platform shells.
2. **The dep is on the shared shell only, never the reverse.** Mobile
   imports from desktop; desktop never imports from mobile.
3. **All genuinely-platform-agnostic code is still substrate-shaped.**
   The mobile shell's package.json should show ONE
   `@onderling-app/<sibling>` dep + N `@onderling/...` substrates, not
   a sprawl of cross-app subpath imports.

When `apps/folio-mobile` was scoped before 2026-05-08 it had THREE
cross-app subpath imports (`/rn/serviceFactory`, `/rn/backgroundTasks`,
implicit barrel). Phases 40.2-40.3 + the 2026-05-08 follow-up
collapsed them to ONE: `import { SyncEngine } from '@onderling-app/folio'`
for the SyncEngine subclass. The remaining import is the legitimate
single-product dependency this exception covers.

**Substrate-of-substrates / share substrates between apps**: still
requires rule-of-two and substrate extraction (see Stoop V3 Phases
40.2-40.3 for the canonical lift).

**Verification:** `grep -r "@onderling-app/" apps/*/src apps/*/package.json`
should return zero matches **other than**:
- self-references in comments / package.json `name` fields,
- platform-shell deps from `<app>-mobile` to `<app>` (above).

As of 2026-05-08:
- `apps/folio-mobile` matches the platform-shell exception once
  (`SyncEngine` from `@onderling-app/folio`).
- No other cross-app imports exist.

---

## Shared UI-glue helpers between platform shells (locked 2026-05-10)

> **Project-wide invariant.** When the same product has both a
> desktop shell (`apps/<product>`) and a mobile shell
> (`apps/<product>-mobile`), every pure-fn helper that shapes UI
> behaviour from the substrate's data — display-status mappers,
> form-shape builders, event-kind classifiers, role/actor resolvers
> — lives **once** in the desktop shell under `apps/<product>/src/ui/`.
> Both shells import from there. Neither shell may keep a local copy
> with diverging behaviour.

This rule formalises a regression pattern we hit during 2026-05
mobile bring-up: each shell ended up with its own version of "is
this task ready to mark complete?" / "what's the effective status
of this item?" / "what payload does the addTask form build?" — and
the two copies drifted. Bug fixes landed on one side and not the
other, leading to silent UX divergence.

**What goes into `apps/<product>/src/ui/`:**

- Pure-fn helpers that take substrate-shape data and return UI-shape
  data (status pills, role labels, button-disabled gates, error
  classifiers, form-payload builders).
- Lookup tables / taxonomies that drive UI rendering decisions
  (status → colour-token, kind → label key, role → permission map).
- Inbox/notification event classifiers (`kindOf`, `proposalIdOf`).
- Effective-actor / alias resolvers (when the dispatch layer's
  `from` differs from the role-table's keying — desktop's relay
  path + mobile's pubKey path both hit this).

**What does NOT go in `src/ui/`:**

- Anything that imports from `react-native`, `expo-*`, or DOM/`window`
  globals — those belong in the per-platform shell.
- React components, JSX, hooks. Components stay platform-local.
- Network / I/O. Helpers must be deterministic pure functions.

**Test discipline:**

- Tests for `apps/<product>/src/ui/*.js` live in
  `apps/<product>/test/ui-*.test.js` and run on the desktop's
  vitest config (Node only, no RN polyfills required).
- The mobile shell does not duplicate these tests; it imports
  the helper and trusts the shared coverage.

**Re-export shims:** when the mobile shell keeps a local module as
a stable import path (`apps/<product>-mobile/src/lib/<name>.js`)
that re-exports the shared helper, use `export * from
'@onderling-app/<product>/ui/<name>'` rather than an explicit named
list. Explicit lists silently drop new exports (we hit this with
`buildAddSubtaskArgs` on 2026-05-10 — added in the shared module,
missed on the shim, surfaced as a runtime "is not a function" on
the device). `export *` is identical at runtime and tree-shakes
the same.

**Locale parallel.** Strings that both shells render (status labels,
role labels, privacy-notice items) live in
`apps/<product>/locales/shared/{en,nl}.json` and are imported by
both shells. Each shell keeps its own
`{mobile,desktop}.<keys>.json` for platform-specific copy
(camera-permission rationale, "Tap + to add a task", …).

**Verification:** `grep -r "@onderling-app/<product>/ui/" apps/<product>-mobile`
should return ≥ 1 match per shared helper. A new helper that lives
in only one shell is a smell — extract before merging.

**Examples (Tasks, locked 2026-05-10):**

- `apps/tasks-v0/src/ui/taskStatus.js` — `describeTaskStatus`,
  `shouldOfferForceComplete`, `shouldProposeSubtask`. Imported by
  `apps/tasks-mobile/src/screens/*.jsx` AND `apps/tasks-v0/web/app.js`.
- `apps/tasks-v0/src/ui/composeArgs.js` — addTask payload builder.
- `apps/tasks-v0/src/ui/inboxClassify.js` — inbox event taxonomy.
- `apps/tasks-v0/src/ui/effectiveActor.js` — pubKey ↔ webid
  resolution against the alias map.

---

## Mobile substrates live in their own packages (locked 2026-05-08)

**RN-specific code MUST NOT be added to cross-platform substrates.**
When a substrate gains a React-Native-only adapter, helper, or
runtime, that work goes into a separate package.

The canonical pattern:

| Cross-platform substrate | RN-specific sibling |
|---|---|
| `@onderling/sync-engine` | `@onderling/sync-engine-rn` (planned, lifts folio-mobile's `serviceFactory`) |
| `@onderling/pod-client` | `@onderling/oidc-session-rn` (planned, lifts folio-mobile's `OidcSessionRN`) |
| `@onderling/core` | `@onderling/react-native` (already shipped — KeychainVault, AsyncStorageAdapter, BLE/mDNS transports, MobilePushBridge) |

Reasons:

1. **Bundle hygiene.** Pulling `expo-secure-store` or
   `react-native-keychain` into a Node-only build via a transitive
   import is the kind of breakage that's hard to debug. Separation
   prevents it.
2. **Peer-dependency surface.** RN substrates carry RN peer deps;
   web/Node substrates don't. Mixing them inflates every consumer's
   peer-dep list.
3. **Test isolation.** RN substrate tests need RN polyfills; the
   cross-platform tests don't. Keeping them separate keeps each
   substrate's vitest config narrow.
4. **Fork-friendliness.** A user who wants to swap our RN adapter
   for their own (Capacitor, Tauri-mobile, …) can replace one
   `*-rn` package without touching the cross-platform layer.

**Naming:** `*-rn` suffix is preferred. The existing
`@onderling/react-native` predates this rule and stays as the
RN platform layer (polyfills + Metro preset + canonical
KeychainVault / AsyncStorageAdapter / transport bridges); new
RN-specific substrates follow the suffix pattern instead of
piling onto `@onderling/react-native`.

**When a substrate gets an RN sibling**: add the `*-rn` package
under `packages/`, mark the cross-platform substrate as the
"shared core" in its README, and cross-link.

**Verification:** any new file under `packages/<not-rn>/` that
imports from `react-native`, `expo-*`, or `@react-native-*` is a
violation. Lint rule TBD.

---

## Strict layering: core MUST NOT import substrates (locked 2026-05-11)

> **Project-wide invariant.** The dependency direction is one-way:
> **apps → substrates → core**. `@onderling/core` (and the
> substrate-adjacent foundation packages `@onderling/relay`,
> `@onderling/pod-client`, `@onderling/react-native`) never imports
> from a substrate package. Anything that requires substrate-side
> knowledge belongs in the substrate's plan, not core's.

This rule formalises a pattern surfaced during the 2026-05-11
standardisation work: a doc revision had core re-exporting a
substrate's API as a "convenience wrapper" (see the reverted
`packages/core/src/identity/webid.js` shim and the deprecation
re-exports of `Vault*` / `SolidVault`). Each such re-export
flips the dependency arrow and shrinks the substrate boundary
into noise. After 2026-05-11 we make a deliberate choice
whenever the pull is tempting.

### Why one-way

- Substrates depend on **stable** primitives. Core moves slowly;
  substrates iterate. If core re-exports from a substrate, core's
  stability claim is gone — every substrate change becomes a
  core change.
- A substrate that can be deleted without touching core is a
  substrate. A substrate that can't is core's problem.
- Tests stay focused: core's tests use minimal fakes; substrate
  tests use real substrate code. No circular setup.

### What "core needs from substrates" becomes instead

Where core's logic needs substrate-supplied capabilities, core
provides one of four mechanisms — none of which import any
substrate:

| Mechanism | Used for | Examples |
|---|---|---|
| **Opaque slot on `Agent`** | Substrate hands core an object; core stores + exposes via a getter; the substrate decides the shape. | `agent.webid` (Phase 50.2), `agent.pseudoPod` (50.3), `agent.agentRegistry` (50.8) |
| **Interface / contract** (JSDoc-defined type) | Substrate implements; core consumes via injection. Core ships the interface definition + an in-memory test helper. | `ActorResolver` (Phase 50.9) — implemented by `@onderling/agent-registry`; injected into `PolicyEngine` + `CapabilityToken.verify` |
| **Skill-shape factory** | Core ships the wire contract (input shape, error codes, output shape) as a `defineSkill`-returning factory; substrate supplies the storage backing via a callback. | `makeFetchResourceSkill({read})` (Phase 50.3) — the pseudo-pod substrate registers the skill on the agent with its own `read` |
| **Duck-typed binding method** | Core invokes a well-known method (`setHost('hub', binder)`) on each opaque slot that implements it. Slots without the method are silently skipped. | `agent.bindToHub(binder)` (Phase 50.12) — fan-out to pseudo-pod / agent-registry / webid slots |

Every one of these patterns lets the substrate stay invisible
to core while letting apps + facades wire things up cleanly.

### Transitional compat shims — REMOVED (2026-07-05)

The Phase 50.1/50.1.A migrations left time-limited deprecation
re-exports in core (`SolidVault` from `@onderling/oidc-session`;
`Vault*` from `@onderling/vault`) — deliberate layering violations
awaiting removal. The **2026-07-05 de-fat deleted all of them**
(and moved the concrete transports → `@onderling/transports`,
pod-storage + on-pod identity → `@onderling/pod-client`). Core now
imports/re-exports **nothing** from an adapter, and
`packages/core/test/layering.enforcement.test.js` fails CI if any
returns. **New compat shims are not allowed** — depend on the
**port**, not a re-export.

### Where "consume substrate X" work lives

When the coding plan describes a phase as "core consumes the
\<substrate\>", the actual code lives in the **substrate's**
coding plan, not core's. Core's coding plan may ship one of:

- A new opaque slot on `Agent` (small, e.g. Phase 50.8.1).
- An interface definition + injection point (e.g. Phase 50.9).
- A skill-shape factory (e.g. Phase 50.3's
  `makeFetchResourceSkill`).
- A duck-typed binding fan-out (e.g. Phase 50.12's
  `bindToHub`).

The substrate's plan ships the substrate itself + the
implementation that plugs into core's slot / interface /
factory / binder.

**Phases lifted out of core's coding plan 2026-05-11** as a
result of this rule:

- Phase 50.4 (VaultMemory pod write-through) → `@onderling/vault`
  substrate plan.
- Phase 50.6 (pseudo-pod V1 write-through queue) →
  `@onderling/pseudo-pod` substrate plan (forthcoming).
- Phase 50.13 (consume interface-registry) →
  `@onderling/interface-registry` substrate plan (forthcoming);
  core may add a slot + duck-typed binding fan-out if useful.
- Phase 50.14 (consume protocol) → `@onderling/protocol`
  substrate plan (forthcoming).
- Phase 50.15 (AIDL surface V2 plumbing) →
  `@onderling/react-native` Phase 51.11.

### Verification

- Grep `packages/core/src/**/*.js` for imports from any
  `@onderling/<adapter-or-substrate>` package. As of the 2026-07-05
  de-fat there are **no acceptable matches** — the deprecation
  re-exports are gone. `packages/core/test/layering.enforcement.test.js`
  guards this (kernel imports/re-exports nothing from vault /
  oidc-session / transports / pod-*).
- Grep `packages/core/package.json` `dependencies` for any
  `@onderling/*` — there should be **none** at runtime (`@onderling/vault`
  is a devDependency for the kernel's tests only).
- Grep substrate package.json files for circular references
  to `@onderling/core` in `dependencies` (devDeps for tests are
  fine).

---

## Verification

Two ongoing checks for the layering invariant:

1. **Substrate audits.** `Project Files/Substrates/refactor/L1*-refactor.md`
   contain per-substrate findings. The execution checklist
   `01-Execution-Checklist.md`
   tracks remediation. After Phase 5 lands, the substrates should compose
   the kernel + adapters cleanly; if any later commit reintroduces a layering violation,
   it should surface in code review against this doc.

2. **App↔SDK bypass audit.** Tracked under HIGH PRIORITY in
   `../TODO-GENERAL.md`. Runs after substrate
   refactors land. Flags any app that imports from `@onderling/core` /
   `@onderling/relay` / `@onderling/pod-client` / `@onderling/react-native`
   without a corresponding justification in the app README.

Both are honest checkpoints, not gates — the invariant is what matters
day to day, and the audits are the safety net.

---

## Safety-by-default for cross-peer apps (locked 2026-05-23)

After the v0.7.S0–S8 security pass landed, every safety primitive
(persistent identity, SecurityLayer, mute/block, helloGate, signed
WebID claim, passphrase vault, WebAuthn, identity-resolver, capability
tokens, TrustRegistry, PolicyEngine, signed audit log, GroupManager,
A2A-TLS, rate-limit, migrateVaultToPod, PFS) lives behind a single
checkbox-style opt on the `@onderling/secure-agent` factory.

### Rule

**New apps that compose a real network transport (NKN, WebRTC, relay)
MUST use `createSecureAgent({...})` to build their cross-peer agent.**

Per-property opt-outs require a grep-able comment co-located with the
manual wiring so the decision is auditable:

```js
// SECURITY: opted out — rate limit disabled for file-transfer burst.
const sa = await createSecureAgent({ rateLimit: false });
```

Apps may still build in-process topology (e.g. basis's
`hostAgent` + `chatAgent`) manually; the factory is for the
cross-peer surface.  Pass `opts.bus` to share an InternalBus across
factory-built + manually-built agents (see
`apps/basis/src/web/realAgent.js` for the canonical pattern).

### Per-app safety checklist

When adding cross-peer support to an app — OR when reviewing an
existing app's adoption — walk this checklist:

| # | Opt | Default rec. | Notes |
|---|---|---|---|
| 1 | `identityVaultPrefix` | `<app>-id:` | so two apps on one origin don't clash |
| 2 | `muteListVaultKey` | `<app>-mute` | persistent mute survives reload |
| 3 | `helloGate` | depends | PSK / group-token / off — match threat model |
| 4 | `webidClaim` | `{ webid }` on sign-in | pod-publish the signed binding |
| 5 | `passphrase` | from passkey if available | promotes vault to AES-GCM IndexedDB |
| 6 | `webAuthnUnlock` | `{ rpId, prfSalt: '<app>/v1' }` | only when the browser supports PRF |
| 7 | `identityResolver` | wire when MemberMap exists | enables mute-fanout |
| 8 | `trustRegistry` | true when peer-trust matters | foundation for caps + policy |
| 9 | `capabilityIssuer` | true when granting peer access | required for skill-call gating |
| 10 | `policyEngine` | true when both trust + caps are wired | composes them |
| 11 | `auditLog` | `{ vaultKey: '<app>-audit' }` | autoLog of every safety event |
| 12 | `groupManager` | true for closed-group apps | auto-threads into policy |
| 13 | `a2aTls` | only if composing A2ATransport | otherwise no-op |
| 14 | `rateLimit` | true for consumer-pace apps | disable for bursty transfer flows |
| 15 | `usePerfectFwdSec` | true when threat model warrants | partial PFS today; app opts-in payloads |

### How to verify adoption

Two checks the reviewer runs:

1. **Factory call present.** Grep `createSecureAgent\(` in
   `apps/<app>/src/web/realAgent.js` (or the equivalent boot file).
2. **No surprise opt-outs.** Grep `SECURITY: opted out` — every hit
   should have a reason in the same line.

Optionally: every cross-peer app SHOULD ship a `journeys-security.test.js`
in the style of `apps/basis/test/journeys-security.test.js` —
≥6 tests exercising the SEAMS between primitives (mute persistence,
audit autoLog, rotation-mid-conversation, etc.).

### Why a factory + checkbox rather than per-app helpers

Before the factory, each new app re-wired identity persistence +
SecurityLayer + auto-HI + rotation manually.  A single missed
`transport.useSecurityLayer(...)` ships envelopes plaintext.
Safety bugs slipped through silently.  The factory makes those
wirings the default and surfaces opt-outs in code review.

### Migration recipe (for the next cross-peer app)

The concrete steps when adopting `@onderling/secure-agent` in an
existing app, or wiring a new one:

1. **Add the dep.**  In `apps/<app>/package.json`:
   ```json
   "@onderling/secure-agent": "workspace:*"
   ```
   Then `pnpm --filter <app> install`.

2. **Build the cross-peer agent via the factory.**  In whichever
   file currently constructs the Agent + transport (typically
   `src/web/realAgent.js` or equivalent boot file):
   ```js
   import { createSecureAgent } from '@onderling/secure-agent';

   const sa = await createSecureAgent({
     bus,                                      // share with in-process agents
     identityVaultPrefix: '<app>-id:',
     muteListVaultKey:    '<app>-mute',
     auditLog:            { vaultKey: '<app>-audit' },
     // ... add opts from the checklist as the app's needs grow
   });
   const chatAgent = sa.agent;
   ```
   Pass `opts.bus` from a shared `InternalBus` so the factory-built
   agent can talk to other in-process agents (e.g. an app's
   `hostAgent`).  Otherwise the factory builds its own siloed bus.

3. **Delegate existing controller methods to `sa.*`.**  Keep the
   external surface the app's UI consumes (e.g. `sendPeerMessage`,
   `rotateChatIdentity`, `securityStatus`); rewrite their bodies as
   thin pass-throughs:
   ```js
   sendPeerMessage(addr, payload) { return sa.peer.sendTo(addr, payload); }
   rotateChatIdentity(opts)       { return sa.rotateIdentity(opts); }
   securityStatus()               { return sa.securityStatus(); }
   ```
   This keeps the diff small + the UI untouched.  Late-bind
   `nknLib` / `onPeerMessage` via `sa.peer.connect({ nknLib, onPeerMessage })`
   when the CDN script loads.

4. **Surface the new ops in the manifest + slash commands.**  Add
   `/mute`, `/unmute`, `/muted`, `/audit-tail` (+ extend
   `/security-status` to report the new wired primitives).  See
   `apps/basis/manifest.js` and
   `apps/basis/src/web/localBuiltins.js` for the reference
   implementation.

5. **Copy the journey template + adapt.**  Take
   `apps/basis/test/journeys-security.test.js` as a starting
   point — at minimum verify mute persistence, audit autoLog,
   identity rotation, and `/security-status` reports every wired
   primitive.  Add app-specific seams (e.g. file-transfer apps
   should test that rate-limit doesn't choke legitimate bursts).

Done in a single PR per app — the basis reference adoption
(`779190c` + `a1ccb14` + `600e751`) is ~−60 LOC in `realAgent.js`,
+11 new tests, and unlocks every safety primitive behind a
checkbox.

See `Project Files/basis/security-roadmap-2026-05-23.md` for
the full per-slice rationale and `packages/secure-agent/README.md`
for the per-opt API.

## The APP layer rule (added 2026-07-28)

Invariant 5 states the layering for `packages/`. It never stated it for `apps/`, which left a real question
unanswered: may a mobile shell import an app directly?

**No. A shell imports its COMPOSER, and nothing else from `apps/`.**

```
shells (basis-mobile · stoop-mobile · folio-mobile)
  → their composer (basis / stoop / folio)
    → apps (stoop · tasks · folio · calendar · agents)
      → packages/ → core
```

A shell reaching past its composer into an app is a bypass, and it is exactly what lets logic drift into a
shell (invariant 1) — the composer is where an op is resolved, so a shell that can reach an app directly can
resolve one itself.

**Checked 2026-07-28:** every shell already obeys this in source. `basis-mobile`'s 26 `@onderling-app/*`
imports all go through `basis`; stoop-mobile → stoop; folio-mobile → folio. Only the *declared* dependencies
had drifted (four apps listed in `basis-mobile/package.json` that nothing imported); those were removed.

Guarded by `apps/basis-mobile/test/shellLayering.test.js`.



## The homes and the packages (added with the homes design)

The system's design-level units are the five **homes** — Agent · Circle · Pod · Surfaces · Connectivity —
plus the shared type dictionary. A home is a contract (state it owns · gates it exposes · a guard that
makes bypass fail); **packages are where a home's code sleeps**, and the layering in this file is the
BUILD dimension, orthogonal to homes. Two consequences for packages:

- **End state: a package's public API = its home's gates.** Barrels stop exporting internals; the
  unreached-exports guard is the enforcement, and its per-package `reasons` record the verdicts.
- Home-shaped package renames (e.g. the membership engine consolidating into `@onderling/circles`) ride
  the compatibility licence — dated in `naming-and-compatibility.md` — not ad-hoc breaks.
