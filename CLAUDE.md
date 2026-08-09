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

**The five HOMES** (the design's organising frame, being made real — see `docs/architecture.md` as it
lands): **Agent · Circle · Pod · Surfaces · Connectivity**, plus the type **dictionary** they all speak.
Homes are the **places**, the five kinds are the **grammar**, and the dictionary's types are the **nouns**
(that word keeps its manifest meaning exclusively). Nothing lives outside a home.

## READ THIS FIRST — [`docs/architecture.md`](docs/architecture.md)
The waist, the dispatch flow, the layers, and **the data plane**: how circles, stores, item types and their
verbs actually relate (§3, "The data plane"). One sentence of it, because it decides most questions:

> **A circle owns one store; a store holds typed items; a type gets the standard verbs for free and adds
> its own where it needs them; and whatever the store holds is what syncs to the circle's other members.**

That file also lists **where the runtime does not match the model yet** — read those before concluding
something is unbuilt. The recurring failure here is not a wrong decision; it is a route that quietly
stopped following a right one, and the code kept working locally the whole time.

## Before you debug a build/native failure
Check **`docs/agent-notes-known-gotchas.md`** first — known monorepo-resolution (EAS/Metro
`nodeModulesPaths`, workspace symlinks) and Android-12 native-permission traps that pass locally
but fail on device/CI. Don't re-bisect a trap that's already written down.
**Keep it current:** when you hit a new build/native/monorepo-resolution trap — or *introduce* one (e.g. a new
workspace dep that needs its `node_modules` link materialized) — record it there in the same turn. A read-first
file only helps if it's written to.

## NEVER `rm -rf node_modules` here — this tree does not survive a clean reinstall
The install is a hand-accreted, FLAT (`.npmrc` `node-linker=hoisted`), per-app layout built with an old
package manager, over DUAL lockfiles (`package-lock.json` AND `pnpm-lock.yaml`, both tracked) and mixed
protocols (`workspace:`, `link:../../../feedback`, `file:`). There is NO `packageManager` pin. A clean
reinstall on the current node/pnpm exposes latent version conflicts the original lenient install tolerated
(`@noble/hashes` v1-vs-v2, `@scure/bip39` v1-vs-v2, `ws@7`-vs-`8` via `isomorphic-ws`, async-storage) and
does NOT come back — this has cost multiple sessions.
- A STALE workspace copy (an app's `node_modules/@onderling/<pkg>` doesn't reflect a source edit) -> replace
  ONLY that one with a symlink to the source: `rm -rf apps/<app>/node_modules/@onderling/<pkg> &&
  ln -s ../../../../packages/<pkg> apps/<app>/node_modules/@onderling/<pkg>`. Never reinstall the whole tree
  to pick up one edit.
- Diagnose dep conflicts with `npm run check:versions` (syncpack; internal `@onderling/*` protocol noise is
  filtered in `.syncpackrc.json`, leaving the real external conflicts).
- The proper fix (one package manager + one lockfile, pin `packageManager`/node, resolve the version splits)
  is the workspace-protocol migration — a scheduled task, not a mid-work reinstall.
- `.nvmrc` pins node (`20.19.5`); Expo/RN native versions live in
  `packages/react-native/docs/VERSION-MATRIX.md` — do not bump without reading it.

## Invariants — a violation is a bug, not a style nit
1. **Logic lives once, in shared code.** Web/mobile shells are **thin adapters/projectors**: platform UI +
   the transport/bundle adapter, *nothing else* — concretely, a shell does **composition and paint** and
   may contain **no gate, no projection, no verb**. A shell must NOT carry dispatch / resolution / routing
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
9. **Names are legible without the plans — and that includes REFERENCES.** A comment saying `B8`, `C4a`,
   `L13` or `J-CS8` is unresolvable for anyone without the private plan docs, and those are gitignored, so
   for a public reader it is unresolvable by construction. Name the thing (*"the address-fallback setting"*),
   not its row in a list. Journey tags **and checklist ids are both guarded** now (`lint-codenames`,
   baselined — do not grow it). Checklist ids were long recorded as unguardable because `B1`/`C3`/`L4`
   collide with real identifiers — true of a BARE token, but the **label form** `B4 — ` is punctuation,
   not a name, and does not collide (2026-08-03). Same for identifiers, titles and UI labels: a name
   that only makes sense to someone who has read a plan doc is a defect. Spell journeys out in the plans
   too, rather than inventing opaque tags to refer back to.

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
  (🟢 · 🟡 · 🔴), stating **the risk you are taking** and **how to undo it**. Not a batch at the end — the
  file drifted three days in July 2026 and could only be partly reconstructed. → [`decision-log.md`](docs/conventions/decision-log.md).
- **Naming is `onderling`; NO backwards compatibility needed** — no "canopy" identifiers; break persisted/wire
  formats freely, no dual-write / fallback / alias cruft (Frits, 2026-08-08 — standing rule; pre-launch, no
  external users, dev state re-derives) — [`naming-and-compatibility.md`](docs/conventions/naming-and-compatibility.md).

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
- **Check whether it already exists — the locale file is the fastest index.** Grep
  `circle.en.json` for the word a *user* would see before adding any small closed vocabulary. Duplicates
  break nothing, so nothing catches them. → [`shared-vocabularies.md`](docs/conventions/shared-vocabularies.md).
- **SEARCH before you BUILD — and before you CONCLUDE.** Before adding a cross-cutting concern (retention,
  logging, an emitter, a per-class table, any shared vocabulary) grep the WHOLE repo for the *concept* — not
  the exact name you have in mind — or send an Explore agent "does X already exist?". These almost always
  already live in a substrate, and a second copy is the drift the structural guards do NOT catch. **The same
  discipline binds a CONCLUSION**: before you claim something is missing, unbuilt, broken, or a "parallel
  structure", grep for the thing you're about to say doesn't exist — a wrong assessment sends real work in the
  wrong direction. *Worked examples (2026-08-06):* a count-based retention table was added to `entryKinds`
  while a duration-based one already lived in `eventLog.js` with a full compactor (one broad
  `grep -r "retention|compact|prune"` would have found it); and the test twin was called a "parallel
  structure" from reading ONE test, before grepping the harness's other connection modes — which turned out to
  cross the real transport seam over relay + NKN. **A plan/architecture note saying a thing is "being
  completed" is NOT evidence it is unbuilt — verify against the real code.** Duplicating logic → STOP and
  consolidate, then leave a guard so it can't recur.
- **Grep every identifier you introduce against the file you put it in**, especially state setters and
  navigation helpers: they read plausibly and are named differently per screen. `src/screens/**` has no test
  coverage, so nothing else will catch a typo there (→ `docs/agent-notes-known-gotchas.md`).
- **DONE = declared · implemented · tested · REACHED.** A thing is not done until you can **name its
  consumer** — the production path a person's action travels to it. A test that exercises the mechanism is
  not a consumer. *Why this is an invariant and not advice:* on 2026-08-03 an audit found the dominant
  remaining shape in every seam was **built-but-unadopted** — `createGrantsOverPeer`, `peerFacade`,
  `loadProfile` and `makeAgentTrailEntry` exported with **zero consumers**, plus a
  circle store that was mirrored with nothing writing to it and a BLE transport the app never constructs.
  Every one passed its tests. None of them ran. **Nothing fails when a seam is left inert** — so say what
  reaches it, or delete it.
- **Nothing runs PARALLEL to the main components.** Everything is one of: an **event-log entry**, a
  **projection** (a derived read-only view over the log or over sources), a **manifest op** reached through
  the waist (`{opId, args}` → `callSkill`), an **item type + its verbs**, or a **transport/adapter behind
  the surface**. There is no sixth kind. If a new thing does not fit one of those, that is the design
  question — do not add it beside them and hope.
  *Why:* a composer that routes actions but does NOT sit behind an op is **unreachable by construction** —
  every interface compiles to `callSkill`, so nothing can get to it, and whatever inline code IS reachable
  wins by default. That is not an accident of adoption; it is the architecture rejecting a foreign shape.
  `grantsOverPeer` (2026-07-26) is the worked example: a real security gate that guards a path nobody walks.
- **Do not call anything a "facade".** The word hid four different things here — a projection
  (`peerFacade`, which is `peerRows` in all but name), a waist-composer, a package re-export for DX, and a
  rename bridge. Say which one you mean. Naming a projection a facade also hides WHERE it belongs: a
  projection is built where its sources are and passed DOWN, which is why `peerFacade` could not be adopted
  at the call sites that only hold one row.
- **Prefer a fitness function to a manual check.** When you fix drift, add the test/lint that makes the same
  drift FAIL CI next time — and register it in the **`npm run guards` aggregate: a guard outside it does
  not exist.** This is the roadmap's step 0 — see `REMAINING-WORK.md` "★ Architectural spine".
  **After adding/removing/renaming a guard, run `npm run guard-index` and commit `docs/guards.md`** (the
  generated designed-vs-built map; its `--check` fitness test fails if it is stale, same contract as the
  surface-coverage snapshot). `npm run guard-status` prints live green/red — read a guard's OWN exit there,
  never `cmd | tail; echo $?` (that returns the pipe's exit, not the guard's — it has masked reds).
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
  **Detox** suite (real emulator or attached phone). Hand-driving with `adb input tap` is a last resort; a
  whole afternoon went into its traps on 2026-07-30 while this suite sat unused.
  → [`e2e/README.md`](apps/basis-mobile/e2e/README.md).
- **Verify the RESULT, not just the dispatch** — check the skill's return value, not only that a command
  fired (the device-run lesson; a gate can route while the op silently fails).
- **Keep the design-doc status overview current.** When you finish, supersede, or archive a plan/design doc,
  update its row (status + date) in `plans/DOC-STATUS.md` — the living lifecycle map of the plan corpus
  (status · 🗄 archive-ready · the reconciliation record). Stops parallel/stale plans creeping back.
- **Stay anchored — the plan DERIVES, it does not invent.** The *why* is [`docs/principles.md`], the *what/how*
  is `plans/PLAN-homes.md`. Every other plan/design doc is a **derivation** from those and a **child of an
  existing arc**, never a new authority. Resolve a fork by deriving from them and checking the invariants
  above — never by starting a fresh direction in a new doc. If a new thing does not map to a principle **and**
  a HOMES home, that is drift — stop and reconcile before continuing. Keep the two trackers live as you work:
  `plans/DOC-STATUS.md` (doc lifecycle) + `plans/DECISIONS-FOR-REVIEW.md` (every autonomous call), and
  sanity-check that mapping at each session's close (the wave-2 log in `DOC-STATUS.md` is the worked example).

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
