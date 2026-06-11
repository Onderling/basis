# canopy

A platform for **decentralized agent apps** — web and mobile apps whose
users exchange messages, data, and tasks **without a required central
server**.  Each app declares its surface once, as data; a unified chat
shell composes them all, and a portable agent SDK gives every app
identity, transports, and peer-to-peer reachability underneath.

> **Working name in public material:** *Onderling*.  This monorepo is the
> engineering home; the agent SDK ships under the `@canopy/*` scope and the
> apps under `@canopy-app/*`.

---

## The apps

| App | What it does |
|---|---|
| **canopy-chat** | The front door — one chat UI. Slash commands (and a future LLM layer) dispatch to whichever app owns the operation. Ships as a static web bundle; the mesh agent runs **browser-side**. |
| **household** | Shared household state (chores, lists) on a Solid pod; chat- or Telegram-driven, optionally LLM-mediated. |
| **stoop** | Neighbourhood (*buurt*) sharing — borrow / lend / give, prikbord posts, skill-matching, closed groups with their own governance. |
| **tasks-v0** | Tasks and crews — claim, complete, review, schedule, availability, crew invites. |
| **folio** | Share files and folders to and from Solid pods. |
| **calendar** | Appointments and events with cross-peer invite + RSVP over the mesh. |

Each app has a React Native / Expo **mobile counterpart**
(`canopy-chat-mobile`, `stoop-mobile`, `tasks-mobile`, `folio-mobile`)
that composes the same portable core as its web build — web and mobile
are peers, neither is the "primitive" one.

---

## One manifest, every surface

This is the connective tissue that lets canopy-chat drive every app
without hard-coding any of them.  An app declares its surface **once**, as
data, in a `manifest.js` — its item types, operations, views, and
per-operation surface hints.  Four pure projectors turn that single
declaration into four surfaces:

```
                    manifest.js   (one per app)
                         │
      ┌──────────────────┼──────────────────┬──────────────────┐
  renderChat         renderSlash         renderWeb         renderMobile
  LLM tools +        /commands +         DOM pages         RN NavModel
  system prompt      grammar             + forms           (screens/nav)
```

- **`@canopy/app-manifest`** ships the schema, the validator, and the
  projectors (`renderChat` / `renderSlash` / `renderWeb` / `renderMobile`,
  plus **`renderGate`** — the deterministic *pre-LLM* half: it projects each
  op's `surfaces.slash.match` verbs into token-gate rules so common phrases
  ("add X", "done X") route without the model. `renderChat` is the LLM half;
  `renderGate`/`renderSlash` are the deterministic half — same manifest, both
  used by household's TG-bot and canopy-chat's circle bot).
- **`@canopy/manifest-host`** composes *N* apps' manifests at runtime —
  collision detection across command namespaces + reply-shape lookup.
- **`renderCoverage`** — a scan of which surfaces each op is wired for
  (op × chat/slash/gate/web·mobile/inline). Run `npm run coverage` in
  `apps/canopy-chat`; the snapshot lives at
  `apps/canopy-chat/docs/surface-coverage.md`. **⚠️ Keep it updated:**
  whenever you change a `manifest.js` (add/remove an op or a
  `surfaces.*` declaration), regenerate the snapshot (`npm run coverage`)
  and commit it, so the surface map never drifts from the manifests.

So canopy-chat's command bar is not a switch statement over apps; it is a
projection of the merged manifest.  Adding an operation to an app's
`manifest.js` makes it reachable from chat, slash, web, and mobile at
once.  Design intent:
[`DESIGN-navmodel-sketch.md`](./DESIGN-navmodel-sketch.md),
[`DESIGN-canopy-chat.md`](./DESIGN-canopy-chat.md).  Page-rendering policy
(when a surface is substrate-rendered vs. hand-coded):
[`DESIGN-tier-policy.md`](./DESIGN-tier-policy.md).

### Direction — apps dissolve into canopy-chat (decided 2026-06-11)

The manifest-per-app split is an **engineering** boundary, not a product one.
The chosen direction is to **dissolve the separate apps (stoop, tasks-v0,
feedback, …) into canopy-chat**: their `manifest.js` declarations stay (they
are the source of truth every projector reads), but the app *names* become
**navigation / reference labels** for groups of shared functionality inside
one unified chat surface — not separate apps, builds, or shells. Everything
already routes through the merged manifest, so this is a consolidation of
shells and packaging, not a rewrite. Treat new work as **adding manifests +
projectors to canopy-chat**, not standing up new app silos. This is why the
gate/slash/web/mobile/LLM surfaces are all manifest projections: one
declaration, every surface, one front door.

---

## How it works — the agent SDK

Four packages, pure-JS-first, running in browser, Node, and React Native.

- **`@canopy/core`** — identity + vault, security (SecurityLayer, hello
  handshake, capability tokens, group manager), transports (Relay / Local /
  Mqtt / Nkn / Rendezvous / Offline / Internal), routing, the `Agent` class,
  the skill registry + `defineSkill`, protocols (pubSub / taskExchange /
  messaging / …), and storage primitives (SolidPodSource, MergeContracts,
  FederatedReader, PodStorageConvention).
- **`@canopy/relay`** — Node-only WebSocket relay: rendezvous signalling +
  proxy fallback + multi-recipient fan-out + group auth + push wake.
- **`@canopy/pod-client`** — high-level Solid pod client: read, write, list,
  conflict resolution, tombstone tracking.
- **`@canopy/react-native`** — RN platform layer: BLE, mDNS, KeychainVault,
  MobilePushBridge, the `createMeshAgent` factory, polyfills + Metro preset.

Substrates (`packages/{item-store, identity-resolver, skill-match,
notifier, secure-agent, llm-client, …}`) compose the SDK into reusable
building blocks; apps compose substrates.  Full public surface, every
symbol with its `file:line`:
[`Project Files/Substrates/refactor/SDK-surface-map.md`](./Project%20Files/Substrates/refactor/SDK-surface-map.md).
Minimal hands-on agent: [`QUICKSTART.md`](./QUICKSTART.md).

### Single-agent rule

Every app builds **one** `core.Agent` per service-context.  Transports are
routes plugged into that agent, not parallel agent instances; multi-scope
semantics (groups, crews, accounts) live in per-scope `ItemStore` /
`MemberMap` state **outside** the agent and dispatch at the skill level.
Spinning up N agents to model N scopes is an anti-pattern.  Full rationale:
[`Project Files/conventions/single-agent.md`](./Project%20Files/conventions/single-agent.md).

---

## Reachability — transports

Two peers exchange messages over whichever path is currently usable.  No
app code chooses the path; a per-peer picker (`RoutingStrategy`) does,
based on which transports have a live link to the peer.

1. **Direct** — mDNS/TCP on the same LAN, BLE in Bluetooth range, or a
   WebRTC DataChannel across networks (relay-signalled, then the relay
   drops out of the data path). In-process transports cover tests + tabs.
2. **Relay** — `@canopy/relay` over WebSocket, in rendezvous mode (carries
   only SDP/ICE) or proxy-fallback mode (forwards `nacl.box`-sealed
   envelopes it cannot read).
3. **NKN** — `NknTransport` rides the public [NKN](https://nkn.org)
   messaging network; no operator to run, address is deterministic from the
   agent's Ed25519 seed.  Connects via **MultiClient** (several sub-client
   routes, better inbound reliability) with single-`Client` fallback.
4. **Hop / peer-as-relay** — a third agent relays for two peers who cannot
   reach each other, either as a plaintext bridge or a *sealed forward*
   (`nacl.box` blob the bridge can't open).  Hop-count + policy gating
   prevent abuse as an open relay.

---

## Architecture invariant — three layers

> **Apps depend on substrates, substrates depend on the agent SDK. This is
> a project-wide invariant — keep it top-of-mind.**

```
apps/                       ←  thin compositions; per-app glue + UI
  ↓
packages/{item-store, identity-resolver, skill-match, notifier,
  secure-agent, app-manifest, manifest-host, llm-client, …}
  ↓                            ←  substrates; reusable building blocks
packages/{core, relay, pod-client, react-native}
                               ←  the agent SDK; the foundation
```

Substrates compose the SDK and MUST NOT reinvent its primitives.  Apps
compose substrates and MAY use the SDK directly **only with an explicit
justification** in the app's README.  Required reading before authoring
code here:

- [`architectural-layering.md`](./Project%20Files/conventions/architectural-layering.md) — what each layer owns, what's not acceptable.
- [`app-readme-scheme.md`](./Project%20Files/conventions/app-readme-scheme.md) — every app under `apps/` follows this README scheme from its first commit.
- [`localisation.md`](./Project%20Files/conventions/localisation.md) — every user-facing surface ships translatable from commit one; substrates emit error codes, not strings.
- [`cross-app-settings.md`](./Project%20Files/conventions/cross-app-settings.md) — pod-side settings split into portable `shared.json` + per-install `devices/<id>.json`.
- [`pod-independence.md`](./Project%20Files/conventions/pod-independence.md) — local-only mode is the floor; the pod is the portability layer, not a runtime dependency.
- [`Substrates/policies.md`](./Project%20Files/Substrates/policies.md) — rule-of-two extraction policy (wait for the second independent need before generalising).

### Engineering principles

- **Local-only mode is the floor; pod is portability.** Every app works
  fully without an authenticated pod.  Shared-state apps without a pod fall
  back to SDK `MergeContracts` + relay `group-publish` for P2P replication.
- **Pod is truth, local cache is reality.** When a pod *is* configured it is
  authoritative but slow; UI reads from the local cache and syncs on a
  cadence with optimistic, queued writes.  A pod outage must not break the app.
- **Network identity rotation by default.** `Agent.rotateIdentity()` rotates
  the network keypair with grace-period broadcasts; the pod WebID stays
  stable.  Reduces long-term relay-traffic correlation.
- **Decentralised disclaimer.** There is no central support desk, abuse team,
  or trust authority — a structural property, not a bug.  Every app ships an
  onboarding disclaimer and treats *create-group* as a governance step.
- **Feedback loops on UX-load-bearing parameters.** Notification cadence,
  reminder rate, re-key TTL, etc. can't be pre-tuned from a spec — ship
  sensible defaults, expose dials, instrument from day one, adjust from data.

---

## Platform support — Android + Web (iOS out of scope, locked 2026-05-08)

V1 targets **Android + Web**.  iOS is acknowledged out-of-scope: Apple's
restrictions on background tasks, Web Push, peer-to-peer networking (no
mDNS, restricted BLE), and App Store review compound to make iOS V1
economics not worthwhile for a research preview.  Apps that happen to run
on iOS via Expo are welcome to; the project adds no iOS-specific code
paths, does not test on iOS, and does not block on iOS bugs.

### Pinned versions — do NOT bump without explicit approval

**Expo 52 is the ceiling** (React Native 0.76.9, React 18.3.1).  `npm audit
fix --force` will try to bump Expo past 52 — **do not run it**; the RN
bring-up traps are calibrated against this matrix.  Full matrix:
[`packages/react-native/docs/VERSION-MATRIX.md`](./packages/react-native/docs/VERSION-MATRIX.md);
trap log:
[`packages/react-native/docs/BRING-UP-NOTES.md`](./packages/react-native/docs/BRING-UP-NOTES.md).

---

## Running things

```bash
# Monorepo root — install + run the SDK package test suites
npm install
npm test                              # core + react-native + relay + pod-client + integration-tests
npm run test:core                     # individual suites: :rn :relay :pod-client :scenarios

# Start the relay (listens on :8787 by default)
npm run relay:start
```

Apps are pnpm-filtered workspaces:

```bash
# canopy-chat (web) — static-deployable
pnpm --filter @canopy-app/canopy-chat dev        # http://localhost:5173
pnpm --filter @canopy-app/canopy-chat build      # → dist/
```

```bash
# canopy-chat-mobile (Expo / Android)
cd apps/canopy-chat-mobile
npm install --legacy-peer-deps                    # one-time
./node_modules/.bin/expo run:android              # first boot (2–10 min, builds native)
npm start                                         # subsequent JS-only changes
```

---

## Status

**Research preview / PoC.**  The SDK package boundaries are stable
and core is in active development.  As of the current milestone:

- **canopy-chat web + `canopy-chat-mobile` shells are live**, both composing
  the same manifest-driven core.
- **Cross-device peer flows work over NKN** — contact QR exchange,
  direct messages, and group join/redeem verified on two physical Android
  phones (MultiClient transport + persisted identity).
- **Pods are opt-in**: every app runs fully local; OIDC sign-in + pod sync
  are an opt-in portability layer.
- **Operational hardening** (relay auth, public relay deployment, the
  per-device Agent Hub) remains on the roadmap.

Per-app phase tables and honest "demoable vs. primitive-complete" notes live
in each app's own `README.md` (e.g. `apps/canopy-chat/README.md`).
