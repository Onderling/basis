# CLAUDE.md — the basis monorepo (org: Onderling)

Architecture-enforcement instructions for agents working here. **The model is settled; your job is to keep the
_code_ matching the _model_.** The recurring failure in this repo is drift (duplicated locales, mobile reimplementing
web, cross-app copy-paste) that crept in because nothing failed when it did. Treat drift as a bug and, when you fix
it, leave behind a check so it can't recur.

Each rule below is short on purpose: this file is loaded into every session. The cases behind the rules, with what
each mistake cost, are in [`docs/conventions/working-lessons.md`](docs/conventions/working-lessons.md). Read the entry
there before arguing that a case is an exception.

## The model (one sentence)
Every interface (**AI, GUI, slash command, deterministic gate**) compiles to the same `{opId, args}` and hands it to
`callSkill`; an app's **`manifest.js` is the single contract**, and pure projectors (`renderChat` · `renderSlash` ·
`renderGate` · `renderWeb` · `renderMobile`) turn that one declaration into every surface. AI and GUI are **peer
compilers to the waist**. The functionality the op names resolves *wherever it lives*: a local handler · an external
agent · a model · the Solid pod · an MCP service · a scheduled job.

**The five HOMES:** **Agent · Circle · Pod · Surfaces · Connectivity**, plus the type **dictionary** they all speak.
Homes are the places, the five kinds are the grammar, the dictionary's types are the nouns. Nothing lives outside a
home.

## Read first
- **[`docs/architecture.md`](docs/architecture.md):** the waist, the dispatch flow, the layers and the data plane (§3):
  > **A circle owns one store; a store holds typed items; a type gets the standard verbs for free and adds its own
  > where it needs them; and whatever the store holds is what syncs to the circle's other members.**

  It also lists **where the runtime does not match the model yet**: read those before concluding something is unbuilt.
- **[`docs/catalogue/`](docs/catalogue/README.md):** one page per capability area (what a person can do, where it
  lives, what proves it, what was decided not to build). Read the area's page before ruling something absent or
  building in it; every manifest op is on exactly one page (`lint-catalogue-ops`).
- **`docs/agent-notes-known-gotchas.md`** before debugging a build, native or monorepo-resolution failure. When you
  hit or introduce a new trap of that kind, record it there in the same turn.

## Never `rm -rf node_modules` here
The install is a flat (`node-linker=hoisted`), per-app layout over two lockfiles and mixed protocols; a clean
reinstall exposes version conflicts and does not come back.
- A stale workspace copy: replace ONLY that one with a symlink to the source (`rm -rf
  apps/<app>/node_modules/@onderling/<pkg> && ln -s ../../../../packages/<pkg> apps/<app>/node_modules/@onderling/<pkg>`).
- Dependency conflicts: `npm run check:versions`.
- `.nvmrc` pins node; Expo/RN native versions are in `packages/react-native/docs/VERSION-MATRIX.md`: do not bump
  without reading it.

## Invariants — a violation is a bug, not a style nit
1. **Logic lives once, in shared code.** A web/mobile shell does **composition and paint** and contains **no gate,
   no projection, no verb**; dispatch, resolution and routing live in shared `src/` (the basis app) or a substrate
   package. Writing logic in a shell that already exists in shared code → STOP and call the shared one.
2. **web ≡ mobile ≡ box.** No shell is the primitive one; the box (`apps/basis/bin/device-runner.mjs`) is a third
   shell, the same composition minus the paint. A shared string/op/behaviour exists in ALL, ideally by construction
   (one shared source), not copied. An **empty grep on another shell is a FINDING, not a clearance**: wire the
   equivalent, or say in the same turn that there isn't one. The seams every shell composes are declared in
   `scripts/shell-seams.mjs` (`lint-shell-seams`); a new seam, also a shared decision function a shell host must call,
   goes in that list in the same PR. What a shell SAYS is compared by `lint-locale-key-parity`.
3. **No duplication.** A string/op/function is defined ONCE. Editing the same thing in two files is the signal to
   consolidate, then add a guard so it can't recur.
4. **The manifest is the source of truth for surfaces.** Add an op/surface to `manifest.js`, never a per-shell switch
   statement. After any manifest change, regenerate + commit the coverage snapshot (`npm run coverage` in
   `apps/basis` → `docs/surface-coverage.md`). A GUI button, a tab and a slash command for the same act target the same op; a nav target is only
   for a view that no op backs.
5. **Three-layer dependency invariant:** `apps/` → `packages/{substrates}` → `packages/core` (the **kernel**: ports +
   kernel logic). Concrete adapters live outside the kernel (`@onderling/transports`, `@onderling/pod-client`,
   `@onderling/vault`); nothing in the kernel depends up on an adapter. The dev-facing SDK is `@onderling/sdk`. Apps
   compose substrates (the kernel directly only with a justification in the app README).
   → [`architectural-layering.md`](docs/conventions/architectural-layering.md).
6. **One agent per service-context.** Transports are routes into a single `core.Agent`; multi-scope state lives in
   per-scope `ItemStore`/`MemberMap` outside the agent. → [`single-agent.md`](docs/conventions/single-agent.md).
7. **Functionality is placed by trust + latency, never default-to-server.** Sensitive compute (pods, sealing, the
   confidential LLM transport) stays client-side or in an attested enclave.
   → [`pod-independence.md`](docs/conventions/pod-independence.md).
8. **Every user-facing string goes through `t()`** with a locale entry.
   → [`localisation.md`](docs/conventions/localisation.md).
9. **Names are legible without the plans, references included.** A comment, identifier, title or UI label that only
   makes sense to someone who has read a private plan doc (`B8`, `L13`, a journey tag) is a defect: name the thing,
   not its row in a list. Guarded by `lint-codenames` (baselined: do not grow it).

## Further conventions
Full detail in [`docs/conventions/`](docs/conventions/):
- **App READMEs** follow one scheme — [`app-readme-scheme.md`](docs/conventions/app-readme-scheme.md).
- **Web/mobile differences** are idiom or listed exceptions, never capability, vocabulary or consent drift — [`web-mobile-exceptions.md`](docs/conventions/web-mobile-exceptions.md).
- **Cross-app settings** split pod-side into portable `shared.json` + per-install `devices/<id>.json` — [`cross-app-settings.md`](docs/conventions/cross-app-settings.md).
- **Tunable constants go through the parameter register** (`param({key,scope,kind,default})`), never a bare literal; not for unit multipliers, crypto formats or enums — [`parameters.md`](docs/conventions/parameters.md).
- **Cross-pod references** use `embeds: [{type, ref}]` + a permission handshake, never inlined pod URLs — [`cross-pod-refs.md`](docs/conventions/cross-pod-refs.md).
- **Pod storage layout** is canonical, owned by `@onderling/pod-onboarding` — [`storage-layout.md`](docs/conventions/storage-layout.md).
- **This file's scope + size budget** — [`doc-structure.md`](docs/conventions/doc-structure.md).
- **Shared vocabularies**: the index of what exists; a new one needs a home + a guard — [`shared-vocabularies.md`](docs/conventions/shared-vocabularies.md).
- **Record a decision** when a choice closes off alternatives, would be re-litigated or shapes the architecture (→ `docs/decisions.md`) — [`decision-log.md`](docs/conventions/decision-log.md).
- **Read the decisions before you change a behaviour.** Grep `docs/decisions.md` first; a decision there binds until Frits reverses it in the same file. A claim that something is absent or undesigned names what was read (the catalogue page, the manifests, `plans/` incl. `archive/`).
- **Log your OWN judgement calls as you make them**: any choice made without Frits goes into `plans/DECISIONS-FOR-REVIEW.md` in the same turn as the change, colour-coded (🟢 · 🟡 · 🔴), with the risk taken and how to undo it.
- **Naming is `onderling`; NO backwards compatibility needed**: no "canopy" identifiers; break persisted and wire formats freely, no dual-write, fallback or alias — [`naming-and-compatibility.md`](docs/conventions/naming-and-compatibility.md).

## How to work
The long form of each, with its case: [`working-lessons.md`](docs/conventions/working-lessons.md).

**Before you build or conclude**
- **Search before you build, and before you conclude.** Grep the whole repo for the *concept*, not the name you have
  in mind, before adding a cross-cutting concern and before claiming something is missing, unbuilt, broken or a
  parallel structure. A plan note saying a thing is "being completed" is not evidence it is unbuilt: verify in the code.
- **Check whether it already exists.** Grep `circle.en.json` for the word a user would see before adding a small
  vocabulary ([`shared-vocabularies.md`](docs/conventions/shared-vocabularies.md)); for anything that sends, holds,
  fans, syncs, serves or wakes, find your verb in [`carrying-index.md`](docs/conventions/carrying-index.md) first.
- **Nothing runs parallel to the main components.** Everything is an event-log entry, a projection, a manifest op
  reached through the waist, an item type + its verbs, or a transport/adapter behind the surface. There is no sixth
  kind; a thing that fits none is a design question, not something to add beside them.
- **New functionality = a manifest + projectors**, not a new app silo; an app keeps a surface of its own only when it
  needs its own interaction model (folio does, pinboard and tasks do not).
- **Go through the surface, never the transport.** App/shell code does not construct or drive a transport
  (`MdnsTransport`, `BleTransport`, `NknTransport`); a missing affordance is added to the surface (the mesh builder,
  the `Peer` projection).
- **The enforceability test:** could someone on a different app version get it anyway? Then it is a convention; put
  the real gate where it binds — [`enforceability.md`](docs/conventions/enforceability.md).
- **Do not call anything a "facade".** Say which it is: a projection, a waist-composer, a package re-export, a rename
  bridge.
- **Stay anchored.** The why is `docs/principles.md`, the what/how is `plans/PLAN-homes.md`; every other plan derives
  from those and is a child of an existing arc. A new thing that maps to no principle and no home is drift.

**While you diagnose**
- **Prove the harness before you blame the product.** A harness that reassembles the app measures itself: check it is
  composed the way a shell composes it. Prefer driving the real app (`test-browser/`, `window.onderlingSurface` /
  `onderlingDispatch` / `onderlingCall`).
- **A comment describes what it describes.** Quote a comment as context; quote the implementation as a finding.
- **After the second wrong reading, instrument.** One `console.info` in the path, one run, then remove it.
- **A probe that cannot name its branch is not evidence.** A helper returning `null` for two reasons says which.
- **Subtract the declared differences before calling it a disagreement.** Two views of one fact often differ on purpose.
- **Verify the result, not just the dispatch**: the skill's return value, not only that a command fired.
- **A device harness exists** (`apps/basis-mobile/e2e/`, Detox): use it before hand-driving with `adb`.

**When is it done**
- **A fix needs a test that is red first**, seen failing for the reason you claim.
- **DONE = declared · implemented · tested · REACHED.** Name the consumer: the production path a person's action
  travels to it. A test is not a consumer. Nothing fails when a seam is left inert, so say what reaches it or delete it.
- **A seam is not done until something passes through it**: a test that crosses it (a real socket, a real boot).
- **Prefer a fitness function to a manual check**, registered in `npm run guards`: a guard outside the aggregate does
  not exist. After adding, removing or renaming a guard: `npm run guard-index` and commit `docs/guards.md`. Read a
  guard's own exit (`npm run guard-status`), never `cmd | tail; echo $?`.
- **When two layers hold the same fact, pin the agreement**, not either value.
- **Grep every identifier you introduce against the file you put it in**; `src/screens/**` has no test coverage.
- **The verification ladder.** Rungs 0–2 (the one red-first test · the affected tests + guards · the cheapest REAL
  thing) before the PR; the CI gate gates the merge; the browser tail runs after the merge and gates the release. A
  shell, transport or box change never skips rung 2 — [`verification-ladder.md`](docs/conventions/verification-ladder.md).
- **Live-LLM tests run only with `LIVE_LLM=1`** and never on a machine holding the production key.

**Git, shells and Frits**
- **Branch per feature; the trunk moves by merge.** `development` is the trunk, `live` the release branch: never
  commit straight onto either (`.githooks/pre-commit`, set once per clone with `git config core.hooksPath .githooks`;
  `lint-branch-hygiene`). Push to `live` only with guards + both suites green.
- **Ship web first, then mobile**, as separate commits.
- **Shared checkout, two agents:** a tracked file is edited only in a worktree (`plans/tools/mk-worktree.sh`), never
  in the shared `canopy-mono` checkout, whose branch is never switched. At session start and before stopping,
  `git status --short` there is empty or the change is named in the state file with its owner. An unowned change is
  reported, never stashed, never reverted blind.
- **Never `git stash` in this repo.** Commit the WIP on the branch, or `git diff > x.patch` and apply it back.
- **A question put to Frits and not answered gets a ledger row with `? Needs Frits` before the session ends**; the
  table at the top of `REMAINING-WORK.md` is generated from that marker, never edited.
- **An idea is only dropped when Frits drops it.** Silence is not rejection: an unanswered option, caveat or finding
  stays open in the design doc. With more open points than a reply can hold, ask which to keep.
- **Keep `plans/DOC-STATUS.md` current** when you finish, supersede or archive a plan or design doc.

## Where the truth is
- **Doc layout** ([`docs/repository-layout.md`](docs/repository-layout.md)): tracked/public are `docs/**`, `README.md`,
  `QUICKSTART.md`, `CLAUDE.md`, `apps/*/docs/` and CHANGELOGs. Private and gitignored are `plans/` (overviews at its
  top; `live/` the design of record for work not done, `notes/` settled reference, `briefs/` dated task docs that open
  with a status header, `archive/<YYYY-MM>/`; shape held by `lint-plans-structure`), `_archive/` and root `PLAN-*`,
  `DESIGN-*`, `REMAINING-WORK.md`. A tracked file never links into `plans/`, `_archive/` or outside the repo
  (`npm run lint:docs`).
- **Master todo + roadmap:** `REMAINING-WORK.md` (private).
- **Per-app truth:** `apps/<app>/manifest.js` + app-local CHANGELOGs + `apps/*/docs/`.
- **The architecture, in depth:** [`docs/architecture.md`](docs/architecture.md); web/mobile detail in
  `apps/basis/docs/web-mobile-consolidation-plan.md`.

*The feedback app is split out (github.com/Onderling/feedback); the platform ships as published `@onderling/*` npm
packages (see `docs/decisions.md`). Public contributors work from `docs/` — see `CONTRIBUTING.md`.*
