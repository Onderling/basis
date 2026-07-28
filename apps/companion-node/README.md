# companion-node

A user-hostable Node process that **remotely hosts Folio's already-relocatable
(`runtime:'browser'`) pod-file agent**, reachable by the user's own devices over
the mesh, acting on their pod. Everything from the skill-wire down already
exists and is reused as-is — folio's cores are injection-shaped, `buildFolioSkills`
derives the handlers, and `registerFolioAgent` was left for exactly this
composition — so this app is a **~200-line composition root**, not a new
substrate. This is **Slice R1** (LAN/trusted, no inbound gate); see the phase
table below for what R1 proves vs defers.

## Substrates

This app composes the following substrate packages (see
[`../../docs/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/relay` | Boots a local relay in-process (R1 hermetic proof) or connects to a shared one as a client. | The broker + offline-queue + optional blob-gate edge are the relay substrate's concern; the host is only a composition of it. |
| `@onderling/transports` (`RelayTransport`) | Connects the host agent to the relay by identity/pubKey. | Concrete network transports live outside the kernel by the three-layer invariant. |
| `@onderling/agent-registry` (`registerFolioAgent` → `registerAgentBundle` → `createAgentRegistry`) | Self-registers the host so a device discovers its pubKey + advertised capabilities. | The registry resource shape + CAS mutate + capability mirroring is the substrate's; the host just registers into it. |
| `@onderling/vault` (`VaultNodeFs`) | Persists the host keypair so its pubKey is stable across restarts (a device must be able to re-find the host). | The encrypted-file vault is the vault substrate's concern. |
| `@onderling-app/folio` (relative import into `src/`) | `buildFolioSkills`, `registerFolioAgent`, `FOLIO_CAPABILITIES`, the pure cores, and the `store` collaborators (`autoShare`, `folioPodList`, `folioSearch`) — **reused verbatim, not reimplemented**. | R1 consumes folio's relocatable agent; folio's cores are the functionality. |

**Cross-app coupling note:** folio's browser-boundary modules are imported by
**relative path into `apps/folio/src/`** (e.g. `../../folio/src/wireSkills.js`),
not via the `@onderling-app/folio` package barrel. Same rationale as folio's own
relative `wireSkill` import: folio's isolated `node_modules` resolves the folio
files' transitive `@onderling/*` deps, and the barrel/exports map doesn't surface
`agentCores`/`autoShare`/`cli/_podFactory`. The alternative — copying folio's
cores — would violate the no-duplication invariant. The coupling is deliberate
and load-bearing: **do not edit anything under `apps/folio/`; R1 only consumes it.**

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/core` | `Agent`, `AgentIdentity` | Constructs the host agent + its persisted identity, and (in the fitness test) the device agent. | No substrate wraps "construct an agent"; that's foundational — mirrors `browser.js`'s own `new Agent(...)`. |
| `@onderling/core` | `Parts` | Decodes wire replies in the fitness test. | The typed-payload layer is kernel; there's no substrate to route it through for a test assertion. |

## Shared UI helpers

N/A — single-shell, headless app (no user-facing UI surface).

## Bring it up

```bash
cd apps/companion-node
npm test          # the cross-process mesh fitness test (1 test)
# or, run a host:
node src/boot.js  # boots a local relay + host agent; prints the host pubKey
```

Env vars for `src/boot.js`:

| Var | Default | Meaning |
|---|---|---|
| `COMPANION_RELAY_URL` | *(unset ⇒ boot local relay)* | connect to a shared relay as a client (decision #5) |
| `PORT` | `0` (OS-assigned) | local-relay port (ignored when `COMPANION_RELAY_URL` is set) |
| `HOST` | `127.0.0.1` | local-relay bind host |
| `COMPANION_NODE_CONFIG_DIR` | `~/.config/onderling-companion` | where the host keypair is persisted |

No user-facing surface ⇒ no localisation section.

## What R1 proves vs defers — honest phase table

| Slice | Status | What it delivers |
|---|---|---|
| **R1 — the host process** | ✅ **done (this app)** | Boot relay (or connect) → build the Node `store` → register `buildFolioSkills` → connect `RelayTransport` → `registerFolioAgent`. A device discovers the host in the registry and invokes its `listFiles`/`readNote`/`searchNotes` over the **real** wire, getting **real** pod content back. **No PolicyEngine** (trusted LAN). |
| **R2 — inbound capability-token gate** | ⏳ pending | Attach `PolicyEngine` + `TrustRegistry`; mark pod-file skills `requires-token`; the device mints a skill-scoped `CapabilityToken`; the host verifies subject/scope/issuer-trust/revocation. First real activation of the parked gate. Marker: `// R2: attach PolicyEngine here` in `src/index.js`. |
| **R3 — BYO real-Solid pod (`agent-proxy`)** | ⏳ pending | Pod HTTP proxied back through the user's device OIDC session over the relay — no pod secret leaves the device. |

### What's REAL vs STUBBED in R1

**Real (not faked):**
- The **wire** — `RelayTransport` on both agents (the callSkill in-process
  fast-path is bypassed; this is the genuine encrypt → relay-forward → decrypt path).
- The **registry** — `createAgentRegistry` runs unchanged (real resource shape,
  real CAS mutate, real capability list); the device really lists the host.
- The **skill path** — `buildFolioSkills` → `wireSkill` → folio's pure cores.
- The **pod round-trip** — `listFiles({source:'pod'})` walks a genuine pod
  container via `listPodFolio` (a file that lives **only** in the pod backend).
- `PodCapabilityToken` issuance via folio's `autoShare` (the `shareFolder` core).

**Stubbed / deferred (documented in code):**
- **Pod auth/delegation** — the host holds folio's dev pod client
  (`FsBackedMockPodClient`) directly; no `CapabilityAuth` `pod-direct`
  `PodCapabilityToken` delegation yet (R1.5/R2). See `src/podSource.js`.
- **Registry storage** — an in-memory `Map` (`src/registryPod.js`), not a
  pod-backed resource; the two in-process agents share it as the honest analog
  of a shared pod resource. Real pod-backed mirror is later.
- **Inbound gate** — none (R2).
- **Media edge** — the `blobGate` option is passed **through** to `startRelay`
  (so the media edge can compose into this same process later) but nothing is
  wired in R1.

## What's in here

```
apps/companion-node/
├── README.md                 ← this file
├── package.json
├── src/
│   ├── index.js              ← startCompanionNode(opts) — the composition root
│   ├── boot.js               ← CLI boot (mirrors packages/relay/bin/relay.js)
│   ├── store.js              ← buildCompanionStore — the Node store the folio cores read
│   ├── podSource.js          ← buildDevPodSource — the R1 dev pod source (reuses folio's FsBackedMockPodClient)
│   └── registryPod.js        ← makeMemoryRegistryPod — in-memory registry pod (R1)
└── test/
    └── companionMeshFitness.test.js  ← the cross-process mesh acceptance test
```
