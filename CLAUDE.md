# CLAUDE.md — canopy monorepo

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
service · a scheduled job. Interfaces are pass-throughs (`doorgeefluik`); the manifest is the contract; the
substrate is the functionality.

> The model is right. **Make the architecture self-enforcing** so it stays right.

## Invariants — a violation is a bug, not a style nit
1. **Logic lives once, in shared code.** Web/mobile shells are **thin adapters/projectors**: platform UI +
   the transport/bundle adapter, *nothing else*. A shell must NOT carry dispatch / resolution / routing
   logic — that lives in shared `src/` (canopy-chat) or a substrate package. Writing logic in a shell that
   already exists in shared code → STOP and call the shared one. (This is exactly what the four "duplicated
   pairs" violated; see `apps/canopy-chat/docs/web-mobile-consolidation-plan.md`.)
2. **web ≡ mobile.** Neither platform is the "primitive" one. A shared string/op/behaviour must exist in
   BOTH — ideally **by construction** (one shared source both merge), not copied. New shared work lands in
   `src/`; each shell injects only its adapter.
3. **No duplication.** A string/op/function is defined ONCE. Editing the same thing in two files (e.g. a
   locale key in the web *and* mobile bundle) is the signal to consolidate — then add a guard so it can't
   recur. (`circle.*` locale is now one shared source `apps/canopy-chat/src/locales/`; do the same for the rest.)
4. **The manifest is the source of truth for surfaces.** Add an op/surface to `manifest.js`, never a
   per-shell switch statement. After any manifest change, regenerate + commit the coverage snapshot
   (`npm run coverage` in `apps/canopy-chat` → `docs/surface-coverage.md`).
5. **Three-layer dependency invariant:** `apps/` → `packages/{substrates}` → `packages/{core, relay,
   pod-client, react-native}` (the SDK). Substrates compose the SDK and don't reinvent it; apps compose
   substrates (SDK directly only with a justification in the app README).
6. **One agent per service-context.** Transports are routes into a single `core.Agent`; multi-scope state
   lives in per-scope `ItemStore`/`MemberMap` *outside* the agent. N agents for N scopes is an anti-pattern.
7. **Functionality is placed by trust + latency — never default-to-server.** Sensitive compute (pods,
   sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (Privatemode/TEE).
   "Server-side" means *extracting* code that is already server-side (pod-hosting, proxy, private LLM), not
   moving private data onto an untrusted host.
8. **Every user-facing string goes through `t()`** with a locale entry — hardcoded English is a defect.

## How to work
- **Prefer a fitness function to a manual check.** When you fix drift, add the test/lint that makes the same
  drift FAIL CI next time. This is the roadmap's step 0 — see `REMAINING-WORK.md` "★ Architectural spine".
- **New functionality = add a manifest + projectors**, not a new app silo. Apps are dissolving into
  canopy-chat: their `manifest.js` stays the source of truth, the app *name* becomes a nav/reference label.
- **Ship web first, then mobile** as separate steps/commits; don't bundle both platforms in one commit.
- **Verify the RESULT, not just the dispatch** — check the skill's return value, not only that a command
  fired (the device-run lesson; a gate can route while the op silently fails).

## Where the truth is
- **Master todo + roadmap (themes + the architectural spine):** `REMAINING-WORK.md`.
- **Per-app truth:** `apps/<app>/manifest.js` + app-local CHANGELOGs + `apps/*/docs/`. (`Project Files/` is
  gutted — do **not** treat it as current.)
- **The model, in prose:** `README.md` ("One manifest, every surface" + "Architecture invariant — three
  layers"), `PLAN-manifest-gate-surfaces.md`, `apps/canopy-chat/docs/web-mobile-consolidation-plan.md`.

*(This file will be re-scoped when the repo splits — clients vs substrate/functionality vs feedback-app vs
third-party-via-SDK; see the spine. The per-repo CLAUDE.md will narrow to that repo's slice of the waist.)*
