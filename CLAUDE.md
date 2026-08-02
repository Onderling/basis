# CLAUDE.md — the basis monorepo (org: Onderling)

Architecture-enforcement instructions for agents working here. **The model is settled; your job is to keep
the _code_ matching the _model_.** The recurring failure in this repo is drift — duplicated locales, mobile
reimplementing web, cross-app copy-paste — that crept in because nothing failed when it did. Treat drift as
a bug and, when you fix it, leave behind a check so it can't recur.

## The model (one sentence)
Every interface — **AI, GUI, slash command, deterministic gate** — compiles to the same `{opId, args}` and
hands it to `callSkill`; an app's **`manifest.js` is the single contract**, and pure projectors
(`renderChat` · `renderSlash` · `renderGate` · `renderWeb` · `renderMobile`) turn that one declaration into
every surface. AI and GUI are **peer compilers to the waist** — neither is privileged. The functionality the
op names resolves *wherever it lives*: a local handler · an external agent · a model · the Solid pod · an MCP
service · a scheduled job. Interfaces are pass-throughs; the manifest is the contract; the
substrate is the functionality.

> The model is right. **Make the architecture self-enforcing** so it stays right.

**Deeper architecture** — the waist, the end-to-end dispatch flow, the layers, and where this is going:
[`docs/architecture.md`](docs/architecture.md). The sentence above + the invariants below are the working summary.

## Before you debug a build/native failure
Check **`docs/agent-notes-known-gotchas.md`** first — known monorepo-resolution (EAS/Metro
`nodeModulesPaths`, workspace symlinks) and Android-12 native-permission traps that pass locally
but fail on device/CI. Don't re-bisect a trap that's already written down.
**Keep it current:** when you hit a new build/native/monorepo-resolution trap — or *introduce* one (e.g. a new
workspace dep that needs its `node_modules` link materialized) — record it there in the same turn. A read-first
file only helps if it's written to.

## Invariants — a violation is a bug, not a style nit
1. **Logic lives once, in shared code.** Web/mobile shells are **thin adapters/projectors**: platform UI +
   the transport/bundle adapter, *nothing else*. A shell must NOT carry dispatch / resolution / routing
   logic — that lives in shared `src/` (the basis app) or a substrate package. Writing logic in a shell that
   already exists in shared code → STOP and call the shared one. (This is exactly what the four "duplicated
   pairs" violated; see `apps/basis/docs/web-mobile-consolidation-plan.md`.)
2. **web ≡ mobile.** Neither platform is the "primitive" one. A shared string/op/behaviour must exist in
   BOTH — ideally **by construction** (one shared source both merge), not copied. New shared work lands in
   `src/`; each shell injects only its adapter. An **empty grep on the other shell is a FINDING, not a
   clearance** — wire the equivalent, or say in the same turn that there isn't one. (5× in July 2026: the
   rule never failed, *noticing* the violation did.)
3. **No duplication.** A string/op/function is defined ONCE. Editing the same thing in two files (e.g. a
   locale key in the web *and* mobile bundle) is the signal to consolidate — then add a guard so it can't
   recur. (`circle.*` locale is now one shared source `apps/basis/src/locales/`; do the same for the rest.)
4. **The manifest is the source of truth for surfaces.** Add an op/surface to `manifest.js`, never a
   per-shell switch statement. After any manifest change, regenerate + commit the coverage snapshot
   (`npm run coverage` in `apps/basis` → `docs/surface-coverage.md`).
5. **Three-layer dependency invariant:** `apps/` → `packages/{substrates}` → `packages/core` (the **kernel** —
   a lean set of ports + kernel logic). Concrete adapters live *outside* the kernel (`@onderling/transports`,
   `@onderling/pod-client`, `@onderling/vault`); nothing in the kernel depends *up* on an adapter. The dev-facing
   **SDK is `@onderling/sdk`** (the layered facade over the platform). Substrates compose the kernel + adapters and
   don't reinvent the kernel; apps compose substrates (kernel directly only with a justification in the app
   README). → detail: [`architectural-layering.md`](docs/conventions/architectural-layering.md).
6. **One agent per service-context.** Transports are routes into a single `core.Agent`; multi-scope state
   lives in per-scope `ItemStore`/`MemberMap` *outside* the agent. N agents for N scopes is an anti-pattern.
   → [`single-agent.md`](docs/conventions/single-agent.md).
7. **Functionality is placed by trust + latency — never default-to-server.** Sensitive compute (pods,
   sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (Privatemode/TEE).
   "Server-side" means *extracting* code that is already server-side (pod-hosting, proxy, private LLM), not
   moving private data onto an untrusted host. → [`pod-independence.md`](docs/conventions/pod-independence.md).
8. **Every user-facing string goes through `t()`** with a locale entry — hardcoded English is a defect.
   → [`localisation.md`](docs/conventions/localisation.md).
9. **Names are legible without the plans.** A code file — identifiers, titles, comments, UI labels — must read on its own; a
   name that only makes sense to someone who has read a plan/design doc (a project codename, a `report-flow`-style journey tag)
   is a defect. The `lint-codenames` guard (`scripts/lint-codenames.mjs`) enforces the codename half; keep new names
   self-explanatory. The same discipline applies in the plan docs — spell journeys/flows out, don't invent opaque tags.

## Further conventions
Project-wide rules beyond the invariants — concise here, full detail in [`docs/conventions/`](docs/conventions/):
- **App READMEs** follow one scheme (built-on · deviations · honest phase table) — [`app-readme-scheme.md`](docs/conventions/app-readme-scheme.md).
- **Web/mobile differences** are idiom or listed exceptions, never capability/vocab/consent drift — [`web-mobile-exceptions.md`](docs/conventions/web-mobile-exceptions.md).
- **Cross-app settings** split pod-side into portable `shared.json` + per-install `devices/<id>.json` — [`cross-app-settings.md`](docs/conventions/cross-app-settings.md).
- **Cross-pod references** use the `embeds: [{type, ref}]` field + a permission handshake, never inlined pod URLs — [`cross-pod-refs.md`](docs/conventions/cross-pod-refs.md).
- **Pod storage layout** is canonical, owned by `@onderling/pod-onboarding` — [`storage-layout.md`](docs/conventions/storage-layout.md).
- **This file's scope + size budget** — what belongs in `CLAUDE.md` vs `docs/`, and when to compress/enlarge it — [`doc-structure.md`](docs/conventions/doc-structure.md).
- **Shared vocabularies** (delivery states, entry kinds, roles, label maps) — the index of what already
  exists, and the rule that a new one needs a home + a guard — [`shared-vocabularies.md`](docs/conventions/shared-vocabularies.md).
- **Record a decision** when a choice closes off alternatives / would be re-litigated / shapes architecture (→ `docs/decisions.md`) or org (→ private) — [`decision-log.md`](docs/conventions/decision-log.md).
- **Log your OWN judgement calls as you make them — dated rule, review on 2026-08-13.** Any choice made
  without Frits goes into `plans/DECISIONS-FOR-REVIEW.md` **in the same turn as the change**, colour-coded
  (🟢 mechanical · 🟡 shapes something · 🔴 awkward to undo) and stating **how to undo it**. Not a batch at
  the end of a session: the file silently drifted three days in July 2026 and had to be reconstructed after
  the fact, which can only ever be partial — what you forgot is by definition absent. This is the same habit
  as `agent-notes-known-gotchas.md` (write it the turn you hit it), and distinct from `docs/decisions.md`,
  which is only for decisions Frits has *answered*. **On 2026-08-13 this rule is re-decided** — keep, narrow,
  or drop. It exists because it was forgotten once, not forever.
- **Naming is `onderling`; compatibility is a DATED licence** — no "canopy" identifiers; backwards
  compat **not required until 2026-08-31** (extended 2026-07-30), then it lapses and you ASK before breaking a persisted/wire
  format — [`naming-and-compatibility.md`](docs/conventions/naming-and-compatibility.md).

## How to work
- **Go through the SURFACE, never the transport.** App/shell code must not construct or drive
  `MdnsTransport` / `BleTransport` / `NknTransport` directly. Transports are adapters behind the mesh
  builder (`buildMeshTransports` → `createMeshAgent`) and the `Peer` façade; discoverability, advertising
  and routing are properties the surface exposes, not knobs an app reaches past it to set. Reaching for a
  transport is the signal that the surface is missing an affordance — add it there.
- **The enforceability test:** *could someone on a different app version get it anyway?* If yes, call it
  a convention/filter and put the real gate where it binds — [`enforceability.md`](docs/conventions/enforceability.md).
- **An idea is only dropped when Frits drops it.** Silence is not rejection. If you raise an option, a
  caveat, or a finding and it goes unanswered, it stays OPEN — carry it into the design/plan doc as an open
  item rather than quietly dropping it because the conversation moved on. When a thread has accumulated more
  open points than a reply can hold, **ask** which to keep rather than deciding for him.
- **Check whether it already exists — the locale file is the fastest index.** Before adding a set of states,
  a label map, or any small closed vocabulary, grep `apps/basis/src/locales/circle.en.json` for the word a
  user would see: if the product can already say it, the concept already exists in code. Then check
  [`shared-vocabularies.md`](docs/conventions/shared-vocabularies.md). Duplicate vocabularies do not break
  anything — they just make two parts of the app describe one fact differently — so nothing catches them.
- **Grep every identifier you introduce against the file you put it in**, especially state setters and
  navigation helpers: they read plausibly and are named differently per screen. `src/screens/**` has no test
  coverage, so nothing else will catch a typo there (→ `docs/agent-notes-known-gotchas.md`).
- **Prefer a fitness function to a manual check.** When you fix drift, add the test/lint that makes the same
  drift FAIL CI next time. This is the roadmap's step 0 — see `REMAINING-WORK.md` "★ Architectural spine".
  **A seam is not done until something passes through it:** write the test that CROSSES it — a real socket, a
  real boot — not unit tests either side. Two green tests flanking a dead seam is what inert wiring looks like.
- **When two layers hold the same fact, pin the AGREEMENT, not either value.** The relay held messages 5 min
  and the app 24 h — one system, two answers, neither chosen. A test reading both forces whoever changes one
  to change both, or to decide on purpose that they differ.
- **New functionality = add a manifest + projectors**, not a new app silo. Most apps dissolve into basis —
  their `manifest.js` stays the source of truth and the app *name* becomes a nav label. **The test is whether
  it needs its own interaction model** (Frits, 2026-07-28): stoop and tasks do not, so they reduce to close
  to a manifest; **folio does** — basis is a poor file manager — so it keeps a surface of its own.
- **Ship web first, then mobile** as separate steps/commits; don't bundle both platforms in one commit.
- **A device harness already exists — use it before hand-driving anything.** `apps/basis-mobile/e2e/` is a
  **Detox** suite (real emulator or attached phone, driven by `testID`s): `coldBoot`, `allWizards`,
  `circleScreens`, `restartSurvival`. `npm run detox:build` once per source change, then `npm run detox:test`
  (or `detox:test:attached` for the physical phone). Hand-driving with `adb input tap` + `screencap` is a last
  resort, not the default — pixel coordinates and `input text` have their own traps
  (→ `docs/agent-notes-known-gotchas.md`), and a whole afternoon went into them on 2026-07-30 while this
  suite sat unused. If a journey is not expressible here, that is a gap in the harness worth closing.
- **Verify the RESULT, not just the dispatch** — check the skill's return value, not only that a command
  fired (the device-run lesson; a gate can route while the op silently fails).
- **Keep the design-doc status overview current.** When you finish, supersede, or archive a plan/design doc,
  update its row (status + date) in `plans/DOC-STATUS.md` — the living lifecycle map of the plan corpus
  (status · 🗄 archive-ready · the reconciliation record). Stops parallel/stale plans creeping back.

## Where the truth is
- **Doc layout (task #66 model — `plans/PLAN-file-org-inventory.md`):** function is encoded in name/location and
  drives git. **Tracked/public:** `docs/**`, `README.md`, `QUICKSTART.md`, `CLAUDE.md`/`AGENTS.md`, app-local
  `apps/*/docs/` + CHANGELOGs. **Private/local-only (gitignored, one Obsidian vault):** `plans/` (living
  plans/designs/notes), `_archive/` (frozen finished docs), and root private-prefix docs (`PLAN-*`, `DESIGN-*`,
  `REMAINING-WORK.md`, …). Guard: `npm run lint:docs` — a tracked/public file must never link into `plans/`,
  `_archive/`, or outside the repo. New plan → `plans/`; a tracked doc links only to other tracked paths.
- **Master todo + roadmap:** `REMAINING-WORK.md` *(private/local — the local starting point)*.
- **Per-app truth:** `apps/<app>/manifest.js` + app-local CHANGELOGs + `apps/*/docs/`.
- **The architecture, in depth:** [`docs/architecture.md`](docs/architecture.md); overview in `README.md`
  ("One manifest, every surface" + "three layers"); web/mobile detail in
  `apps/basis/docs/web-mobile-consolidation-plan.md`.

*The feedback app is split out (github.com/Onderling/feedback); the platform now ships as published `@onderling/*` npm packages consumed like any third party — the substrate seam is a package boundary, not a repo split (see `docs/decisions.md`). **Private paths** (`plans/`, `_archive/`, `PLAN-*`) are local-only by design; public contributors work from `docs/` — see `CONTRIBUTING.md`.)*
