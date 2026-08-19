# basis

**Basis** is a decentralized app for communities — households, neighbourhoods, clubs — where
people exchange messages, tasks, questions, and files **without a required central server**.
Everything runs on the user's own devices, encrypted end to end; a [Solid](https://solidproject.org)
pod is an optional portability layer, never a dependency.

This repository is the engineering home of Basis **and** the platform it stands on: the
**`@onderling/*` packages**, published on npm, that any application can build with.

```bash
npm install @onderling/sdk
```

Maintained by [Onderling](https://github.com/Onderling). License: Apache-2.0.

## Documentation

- **[Package index](docs/packages.md)** — every published `@onderling/*` package, what it is, and
  which executable journey verifies it.
- **[Tutorials](docs/tutorials/)** — your first agent · one manifest, every surface · a compatible
  tasks app.
- **[How-to guides](docs/how-to/)** — connect over a relay · persist to a pod · redact before
  sending · log safely and collect a bug report.
- **[API reference](docs/api/)** — per-function documentation, generated from source.
- **[Building compatible agents](docs/building-compatible-agents.md)** — the wire-level route (any
  language, no SDK required).
- **[Architecture](docs/architecture.md)** — how the pieces fit. Settled choices:
  [`docs/decisions.md`](docs/decisions.md).

Documentation is verified against the code: `npm run readme-fitness` asserts every documented
symbol exists, and `apps/sdk-journeys` executes the documented flows. Contributions welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md); vulnerabilities go to [SECURITY.md](SECURITY.md).

## One manifest, every surface

An app declares its operations **once**, as data, in a `manifest.js`. Pure projectors turn that
single declaration into every interface:

```
                    manifest.js   (one per app)
                         │
      ┌──────────────────┼──────────────────┬──────────────────┐
  renderChat         renderSlash         renderWeb         renderMobile
  LLM tools +        /commands +         DOM pages         RN screens
  system prompt      grammar             + forms           + navigation
```

Every interface compiles down to the same narrow waist and hands it to the dispatcher:

```
AI (LLM)  ─┐
GUI tap   ─┤→   { opId, args }   →   callSkill   →   functionality
slash     ─┤        the manifest is the contract      (local handler · peer agent ·
gate verb ─┘                                           model · pod · scheduled job)
```

AI and GUI are peer compilers to this waist — neither is privileged. Adding an operation to a
manifest makes it reachable from chat, slash commands, web, and mobile at once. Interfaces are
pass-throughs; functionality lives behind the waist and is placed by **trust and latency** —
sensitive compute stays on-device or in an attested enclave, never default-to-server.

## The platform — `@onderling/*` on npm

The kernel, adapters, and substrates ship as versioned packages
([index](docs/packages.md), 15 published, more as their APIs settle):

- **`@onderling/sdk`** — the developer facade: `createAgent()` + `connectSkill()` and re-exports of
  every layer below.
- **`@onderling/core`** — the kernel: identity, the `Agent`, skills, protocols, security, and the
  **ports** (`Transport` / `DataSource` / `ActorResolver`) that define compatibility.
- **`@onderling/transports`** — relay, NKN, MQTT, and WebRTC-rendezvous transports over the
  `Transport` port. Two peers use whichever path is currently reachable — LAN, Bluetooth, direct
  WebRTC, a self-hostable relay, or the public NKN network.
- **`@onderling/pod-client` · `@onderling/pseudo-pod` · `@onderling/vault`** — storage: Solid pods
  with client-side sealing, an in-memory pod for development, key vaults.
- **`@onderling/item-types` · `@onderling/item-store`** — the canonical item vocabulary and the
  shared lifecycle substrate (claims, completion, audit) that makes independent apps
  *data-compatible*.
- **`@onderling/app-manifest` · `@onderling/app-scaffold`** — the manifest schema + projectors, and
  a manifest-to-app scaffolder.
- **`@onderling/agent-registry` · `@onderling/attribute-charter`** — agents, personas, properties,
  and per-context disclosure: users decide per circle what they share, coarsely, with k-anonymity
  guards.
- **`@onderling/redaction` · `@onderling/logger` · `@onderling/oidc-session`** — supporting
  substrates.

Layering is a project invariant: apps compose substrates, substrates compose the kernel + adapters
([`architectural-layering.md`](docs/conventions/architectural-layering.md)).

## The apps

| App | What it does |
|---|---|
| **basis** (`apps/basis`, `apps/basis-mobile`) | The unified front door — one chat + GUI shell composing every module below through the merged manifest. Web is static-deployable; mobile is Expo/React Native. Web and mobile are peers — one shared core, two thin shells. |
| **household · stoop · tasks · folio · calendar** | Functionality modules — shared household state, neighbourhood sharing and offering-matching (*aanbod*), tasks and circles, pod file sharing, events with cross-peer RSVP. Their manifests are the source of truth; Basis composes them as one product. (`@onderling-app/tasks` is the task ledger; its directory is still `apps/tasks-v0`.) |
| **feedback** | Privacy-first community feedback — split to its own repository: [Onderling/feedback](https://github.com/Onderling/feedback). It consumes the published platform like any third party. |

## Engineering principles

- **Local-only is the floor; the pod is portability.** Every app works fully without a pod; with
  one, the pod is authoritative and the local cache is reality.
- **Placed by trust + latency.** Pods, sealing, and the confidential-LLM transport stay client-side
  or in an attested enclave (Privatemode/TEE) — "server-side" means extracting what is already
  server-side, never moving private data to an untrusted host.
- **Identity rotation by default**; the pod WebID stays stable while network keys rotate.
- **No central authority is a structural property** — apps ship governance affordances (group
  creation as a governance step), not a support desk.
- **Fitness functions over review discipline**: every architectural invariant that matters has a
  test that fails when it drifts — including the documentation.

## Platform support

Basis runs on **Android and the web** today. **iOS is on the roadmap**: Apple restricts background
networking, so a good iOS experience needs an always-on message holder and a reliable notification
path — infrastructure the companion-node work provides, and the same model apps like Signal use.

The mobile toolchain is pinned to **Expo 52** (React Native 0.76.9, React 18.3.1); newer versions
break the calibrated native setup, so check
[`VERSION-MATRIX.md`](packages/react-native/docs/VERSION-MATRIX.md) before changing it.

## Running things

```bash
npm install && npm test          # root: kernel + relay + pod-client + integration suites

pnpm --filter @onderling-app/basis dev     # the web app → http://localhost:5173
pnpm --filter @onderling-app/basis build   # static bundle → dist/

cd apps/basis-mobile                       # Expo / Android
npm install --legacy-peer-deps && ./node_modules/.bin/expo run:android
```

Each app and package carries its own test suite (`npx vitest run` in its directory); the
executable SDK journeys run with `cd apps/sdk-journeys && npm test`.

## Status

**Research preview.** Current state (2026-07):

- The platform is **published**: 15 `@onderling/*` packages on npm (tag `wave-1`), consumed by the
  split-out feedback app as the first external tenant.
- Basis web + mobile shells are live and compose the same manifest-driven core; cross-device peer
  flows verified on physical Android hardware.
- The **chat surface** is now conversational, not command-only: a guided onboarding and a standing
  help bot (a real peer member of a help circle) that answers from an in-app card deck first and, on
  consent, forwards to an LLM — with wording honest about whether that route is confidential. A
  systeem/licht/donker **theme toggle** is live on both platforms.
- **Tasks** gained co-ownership (`assignees[]`), a cross-circle "my tasks" view, sendable lists, and
  task-scoped delegation (**entrust** / *toevertrouwen*). A kring **Taken** tab exposes both.
- A person's **offering** (*aanbod*) is disclosure-controlled on three independent axes —
  **disclosed** (what you reveal, per circle, coarsely, with k-anonymity guards), **matchable**
  (matched on-device, never uploaded), and **requestable** (a neighbour's agent can request it, which
  mints a task you accept or refuse).
- Operational hardening (public relay deployment, deployment automation) is in progress.

Honest per-app phase notes live in each app's own README.

## Name history

The platform was developed as *canopy* (`canopy-mono`); in July 2026 it became **basis**, under the
**Onderling** organization, with packages scoped `@onderling/*`. Old links redirect.
