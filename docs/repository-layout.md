# Repository layout

How this monorepo is arranged: the three layers of code, the apps and packages, and where documentation lives.

## The layers — kernel · adapters · substrates · apps

Code depends downward only — **apps → substrates → kernel**. This is a project-wide rule (see
[`conventions/architectural-layering.md`](./conventions/architectural-layering.md)):

```
apps/                          thin compositions — per-app glue + UI
  ↓
packages/{substrates}          reusable building blocks (item-store, offering-match, notifier, pod-client, …)
  ↓
packages/core                  the KERNEL — a lean set of PORTS (Transport/DataSource/ActorResolver)
                               + kernel logic (Agent, envelope, skill registry, PolicyEngine permission gate,
                                 invokeAgentSkill)
```

Substrates compose the kernel + adapters and must not reinvent the kernel. Apps compose substrates, and may use
the kernel directly **only with an explicit justification in the app's README**.

- **The kernel (`core`)** holds only ports + kernel logic. The concrete **adapters** live outside it — network
  transports in `@onderling/transports`, Solid-pod storage + on-pod identity in `@onderling/pod-client`, the vault
  family in `@onderling/vault` — and nothing in the kernel depends *up* on an adapter (guarded by
  `packages/core/test/layering.enforcement.test.js`).
- **`@onderling/sdk` is "the SDK"** — the dev-facing **facade** over the whole **platform** (kernel + adapters +
  substrates): a *low* layer that re-exports the pieces (pass your own explicitly) and a *high* layer
  (`createAgent` · `connectSkill`). See [`conventions/ports.md`](./conventions/ports.md) for the contract a
  third-party adapter satisfies.
- The substrate tier is a **gradient**: runtime-foundation (vault, oidc-session, pod-client) → feature
  (offering-match, notifier, …) → facade (secure-agent, agent-provisioning). Extracted under a **rule of two**.
- A region the layers omit: a **deployment / hosting layer** (pod-hosting, relay/proxy, private-LLM enclave,
  rollout) *outside* the client apps; the `feedback` deployment occupies it today.

## `apps/` — the products

Each shared app has a web build and a React Native / Expo mobile counterpart; web and mobile are **peers**,
neither is the primitive one. The direction is that the separate apps **dissolve into
`basis`** — their `manifest.js` stays the source of truth, the app *name* becomes a navigation label.

| App | What it does |
|---|---|
| **basis** (+ `-mobile`) | The front door — one chat/command UI that composes every app's manifest. Static web bundle; the mesh agent runs browser-side. |
| **household** | Shared household state (chores, lists) on a Solid pod; chat- or Telegram-driven. |
| **stoop** (+ `-mobile`) | Neighbourhood (*buurt*) sharing — borrow/lend/give, prikbord, offering-matching (*aanbod*), closed groups with their own governance. |
| **tasks-v0** (+ `tasks-mobile`) | Task ledger (`@onderling-app/tasks`) with DAG dependencies, offering-based dispatch, role-aware governance, co-ownership, and task-scoped delegation. |
| **folio** (+ `-mobile`) | Markdown notes/files mirrored to and from a Solid pod. |
| **calendar** | Appointments/events with cross-peer invite + RSVP over the mesh. |
| **archive**, **import-bridge-v0**, **presence-v0** | Pod-content search (FTS5); external-document import; presence attestation — *presence is heading toward a **compatibility surface** for external "Proof-of-X" attestors, not a plain app.* |
| **mesh-demo**, **sdk-smoke** | Not products — a mesh demo and a two-device SDK smoke harness. |

Every app follows the [`app-readme-scheme.md`](./conventions/app-readme-scheme.md); its own `README.md` has the
honest "demoable vs. primitive-complete" phase table.

## `packages/` — the platform (kernel · adapters · SDK) + substrates

**Kernel + adapters (what `@onderling/sdk` re-exports):**
- `core` — the **KERNEL**: the `Agent`, envelope/parts, skill registry, the `PolicyEngine` inbound-permission
  gate, the inter-agent invoke (`invokeAgentSkill`), identity,
  `InternalTransport`, and the **ports** (`Transport`/`DataSource`/`ActorResolver` — see
  [`conventions/ports.md`](./conventions/ports.md)). Concrete adapters live outside it.
- `transports` (`@onderling/transports`) — the concrete network transports (Nkn/Mqtt/Relay/Rendezvous), each an
  adapter over the kernel's `Transport` port.
- `pod-client` — high-level Solid pod client (read/write/list/patch, conflict resolution, tombstones) **plus** the
  on-pod storage adapters (`SolidPodSource`/`PodExporter`) and on-pod identity (`IdentityPodStore`/`IdentitySync`).
- `vault` — the Vault family (memory / local-storage / IndexedDB / node-fs / OAuth) over the kernel's vault port.
- `relay` — Node WebSocket relay: rendezvous signalling + proxy fallback + fan-out + group auth + push wake.
- `react-native` — RN platform layer: BLE, mDNS, KeychainVault, push bridge, `createMeshAgent`, Metro preset.
- `sdk` (`@onderling/sdk`) — **the developer SDK**: the layered facade — re-exports the above (low layer) + adds
  `createAgent()` / `connectSkill()` (high layer). "Import one thing, done."

**The manifest layer** (one declaration → every surface):
- `app-manifest` — the manifest schema, validator, and pure projectors (`renderChat`/`renderSlash`/`renderGate`
  /`renderWeb`/`renderMobile`). `manifest-host` composes N apps' manifests at runtime. Plus `interface-registry`,
  `protocol`, `chat-nav`, `web-adapter`, `agent-ui`.

**Data & pod substrates:** `item-store`, `item-types`, `local-store`, `pseudo-pod`, `pod-routing`,
`pod-onboarding`, `notify-envelope`, `sync-engine` (+ `-rn`), `pod-search`, `calendar-emission`.

**Identity & security:** `vault`, `oidc-session` (+ `-rn`), `agent-registry`, `agent-provisioning`,
`webid-discovery`, `identity-resolver`, `secure-agent`.

**Interaction & matching:** `chat-agent`, `chat-p2p`, `offering-match`, `notifier`, `circles`, `llm-client`,
`redaction`, `online-cadence`. **Testing:** `integration-tests` (cross-component scenarios).

Substrates are extracted under a **rule of two** — generalise on the second independent need, not the first.

## Documentation

A file's *function* is encoded in its name/location, and that decides whether git tracks it.

**Tracked → public (this repo):**
- `docs/**` — general documentation (this tree) + the [conventions](./conventions/).
- `README.md`, `QUICKSTART.md` — overview + hands-on.
- `CLAUDE.md` / `AGENTS.md` (any dir) — agent-facing guides that live next to the code they describe.
- `apps/*/docs/` + per-app `README.md` + CHANGELOGs.

**Ignored → private (local-only, never published):**
- Working plans, designs, and notes. These churn and are half-formed, so they stay off the public repo by
  design — kept locally (and backed up to a private remote), browsable in one editor/vault.

**The guard:** `npm run lint:docs` (`scripts/lint-doc-refs.mjs`, wired into CI) fails if a public file links
into a private path or outside the repo, and if anything private is tracked. That keeps references valid on a
fresh clone and stops the public/private split from drifting.
