# Working lessons: the rules in `CLAUDE.md`, with the cases behind them

`CLAUDE.md` is loaded into every agent session, many times a day, so it holds each rule in one or two lines. This file
holds the long form: the worked examples, what each mistake cost, and the dates. It is the text that stood in
`CLAUDE.md` until 2026-11-26, moved here unchanged except for one corrected sentence about the package-manager pin.

Read the entry here when a rule in `CLAUDE.md` looks arbitrary, or before arguing that a case is an exception to it.
A new lesson gets its one-line rule in `CLAUDE.md` and its story here, in the same change
([`doc-structure.md`](doc-structure.md)).

## Never `rm -rf node_modules` here: this tree does not survive a clean reinstall
The install is a hand-accreted, FLAT (`.npmrc` `node-linker=hoisted`), per-app layout built with an old
package manager, over DUAL lockfiles (`package-lock.json` AND `pnpm-lock.yaml`, both tracked) and mixed
protocols (`workspace:`, `link:../../../feedback`, `file:`). The package manager is pinned
(`packageManager` in the root `package.json`), the two lockfiles are still both there. A clean
reinstall on the current node/pnpm exposes latent version conflicts the original lenient install tolerated
(`@noble/hashes` v1-vs-v2, `@scure/bip39` v1-vs-v2, `ws@7`-vs-`8` via `isomorphic-ws`, async-storage) and
does NOT come back — this has cost multiple sessions.
- A STALE workspace copy (an app's `node_modules/@onderling/<pkg>` doesn't reflect a source edit) -> replace
  ONLY that one with a symlink to the source: `rm -rf apps/<app>/node_modules/@onderling/<pkg> &&
  ln -s ../../../../packages/<pkg> apps/<app>/node_modules/@onderling/<pkg>`. Never reinstall the whole tree
  to pick up one edit.
- Diagnose dep conflicts with `npm run check:versions` (syncpack; internal `@onderling/*` protocol noise is
  filtered in `.syncpackrc.json`, leaving the real external conflicts).
- The proper fix (one lockfile, resolve the version splits)
  is the workspace-protocol migration — a scheduled task, not a mid-work reinstall.
- `.nvmrc` pins node (`20.19.5`); Expo/RN native versions live in
  `packages/react-native/docs/VERSION-MATRIX.md` — do not bump without reading it.

## How to work, with the cases behind each rule
- **Go through the SURFACE, never the transport.** App/shell code must not construct or drive
  `MdnsTransport` / `BleTransport` / `NknTransport` directly. Transports are adapters behind the mesh
  builder (`buildMeshTransports` → `createMeshAgent`) and the `Peer` façade; discoverability, advertising
  and routing are properties the surface exposes, not knobs an app reaches past it to set. Reaching for a
  transport is the signal that the surface is missing an affordance — add it there.
- **The enforceability test:** *could someone on a different app version get it anyway?* If yes, call it
  a convention/filter and put the real gate where it binds — [`enforceability.md`](enforceability.md).
- **A question put to Frits and not answered gets a ledger row with `? Needs Frits` before the session ends;
  the table at the top of `REMAINING-WORK.md` is GENERATED from that marker (`npm run guards`), never edited.**
- **An idea is only dropped when Frits drops it.** Silence is not rejection. If you raise an option, a
  caveat, or a finding and it goes unanswered, it stays OPEN — carry it into the design/plan doc as an open
  item rather than quietly dropping it because the conversation moved on. When a thread has accumulated more
  open points than a reply can hold, **ask** which to keep rather than deciding for him.
- **Check whether it already exists — the locale file is the fastest index.** Grep
  `circle.en.json` for the word a *user* would see before adding any small closed vocabulary. Duplicates
  break nothing, so nothing catches them. → [`shared-vocabularies.md`](shared-vocabularies.md).
  The same for anything that sends, holds, fans, syncs, serves or wakes: find your verb in
  [`carrying-index.md`](carrying-index.md) first — the neighbour is usually there.
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
- **PROVE THE HARNESS BEFORE YOU BLAME THE PRODUCT.** A harness that reassembles the app measures
  itself. Before reporting any defect found through one, establish that it is composed the way a SHELL
  composes it — same factory, same options, same lifecycle. *Cost (2026-08-27):* `walk-peer` boots
  `bootRealAgentNode` without `taskLane: true`, so it has no device log, so no membership rider, so
  nothing fans — by design. Two "product defects" diagnosed against it (a role change that never
  propagated, items that never crossed) were both that. A day. The shells hand their device log
  (`circleApp.js`); the journeys' shared boot asks for it (`_app.mjs:207`); the walk harness did not.
  **Prefer driving the real app** (`test-browser/`, two Chromium contexts, `window.onderlingSurface` /
  `onderlingDispatch` / `onderlingCall`) over any composition you assemble yourself.
- **A COMMENT DESCRIBES WHAT IT DESCRIBES.** The repo's comments are unusually good, which makes them
  unusually easy to over-read. A docstring about a projection's SHAPE is not a statement about its
  SOURCE. Quote a comment as context; quote the IMPLEMENTATION as a finding. *Cost:* "the two roster
  ops differ in shape, not source" — from a comment about `{addr, role}` vs rich rows — reported as a
  verified difference. Reading both bodies showed the narrow one also lacks founders and the whole
  spine fold. Same class as the plan-doc rule above, one level lower.
- **AFTER THE SECOND WRONG READING, INSTRUMENT.** If two attempts to explain a behaviour from the code
  have failed, stop reading and make the running system say what it is doing — a `console.info` in the
  path, one run, then remove it. *Cost:* three readings produced three wrong mechanisms for the founder
  lockout; one diagnostic produced the answer in a single run, and it was a state transition
  (`trailRows: 0 → founders:[me]`, then `trailRows: 1 → founders:[]`) that no amount of reading was
  going to surface.
- **A PROBE THAT CANNOT NAME ITS BRANCH IS NOT EVIDENCE.** A helper returning `null` for two different
  reasons will eventually report the wrong one as a product failure. Make every probe say WHICH branch
  it took. *Cost:* `getInvite` returned `null` both when the ⋯ menu had no invite item and when the
  modal had not yet rendered its code — an hour chasing a live selector that was never wrong, and the
  refusal it was actually hitting turned out to be a real and larger defect.
- **SUBTRACT THE DECLARED DIFFERENCES BEFORE CALLING IT A DISAGREEMENT.** Two views of one fact often
  differ ON PURPOSE. Read what each declares it excludes and compare like with like. *Cost:*
  `listGroupRoster` omits the CALLER by design; comparing it to `listGroupMembers` without subtracting
  that produced a confidently-reported "the founder is missing from the roster" that was not true.
- **A FIX NEEDS A TEST THAT IS RED FIRST.** Write the failing test, watch it fail for the reason you
  claim, then fix. Without that, a fix is a story about a fix — and twice this week the red test
  disagreed with the story and was right. This is DONE's missing half: *declared · implemented · tested
  · REACHED* presumes the test could ever have failed.
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
  it needs its own interaction model** (Frits, 2026-07-28): pinboard and tasks do not, so they reduce to close
  to a manifest; **folio does** — basis is a poor file manager — so it keeps a surface of its own.
- **Ship web first, then mobile** as separate steps/commits; don't bundle both platforms in one commit.
- **The verification ladder — which check runs when.** Rungs 0–2 (the one red-first test · the affected tests +
  guards · the cheapest REAL thing: a relay walk, one browser spec, a throwaway profile on the real box) before
  the PR; the CI gate (~8 min) gates the merge; the browser tail runs AFTER the merge and gates the *release*;
  `npm run release:check` says whether it passed on the bytes about to ship. A shell/transport/box change never
  skips rung 2 — [`verification-ladder.md`](verification-ladder.md).
- **Live-LLM tests run only with `LIVE_LLM=1` and never on a machine holding the production key.** A key file
  on disk is not consent to spend its quota: one eval batch once used up the month and took the live bot down.
- **Branch per feature; the trunk moves by MERGE.** `development` is the trunk (the repo default since
  2026-09-04) and `live` will be the release branch: never commit straight onto either — `git switch -c
  feat/<what>`, land it green, merge back. Enforced twice: `.githooks/pre-commit` refuses the commit (run
  `git config core.hooksPath .githooks` once per clone), and `lint-branch-hygiene` fails when a protected
  branch carries local commits that are not on its remote. Push to `live` only with guards + both suites
  green.
- **A device harness already exists — use it before hand-driving anything.** `apps/basis-mobile/e2e/` is a
  **Detox** suite (real emulator or attached phone). Hand-driving with `adb input tap` is a last resort; a
  whole afternoon went into its traps on 2026-07-30 while this suite sat unused.
  → [`e2e/README.md`](../../apps/basis-mobile/e2e/README.md).
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

- **Shared checkout, two agents (Fable + Opus work in one `canopy-mono` clone):** a tracked file is edited only in a
  `wt-*` worktree (`plans/tools/mk-worktree.sh`), never in the shared checkout; its branch is never switched. At session
  start and before stopping, `git status --short` in `canopy-mono` must be empty, or the change is named in the memory
  state file with its owner. An unowned change is reported, never stashed, never reverted blind.
- **Never `git stash` in this repo** (two slips: 2026-10-06, 2026-11-05 — a failed `stash push` left the ref empty and `stash apply $S` applied another session's WIP). A worktree makes it unnecessary: commit the WIP on the branch, or `git diff > <scratchpad>/x.patch` + `git checkout -- <paths>` and `git apply` it back. `stash apply/pop/drop` without an explicit ref is forbidden outright.

## The invariants, long form
1. **Logic lives once, in shared code.** Web/mobile shells are **thin adapters/projectors**: platform UI +
   the transport/bundle adapter, *nothing else* — concretely, a shell does **composition and paint** and
   may contain **no gate, no projection, no verb**. A shell must NOT carry dispatch / resolution / routing
   logic — that lives in shared `src/` (the basis app) or a substrate package. Writing logic in a shell that
   already exists in shared code → STOP and call the shared one. (This is exactly what the four "duplicated
   pairs" violated; see `apps/basis/docs/web-mobile-consolidation-plan.md`.)
2. **web ≡ mobile ≡ box.** No shell is the "primitive" one — the box (`apps/basis/bin/device-runner.mjs`) is a
   third shell, the same composition minus the paint. A shared string/op/behaviour must exist in ALL — ideally
   **by construction** (one shared source they merge), not copied. New shared work lands in `src/`; each shell
   injects only its adapter. An **empty grep on another shell is a FINDING, not a clearance** — wire the
   equivalent, or say in the same turn that there isn't one. (5× in July 2026: the rule never failed, *noticing*
   the violation did; 2× on the box in September 2026, days after the seam landed on web and mobile.) The
   seams every shell composes are declared once in `scripts/shell-seams.mjs`; `lint-shell-seams` (in
   `npm run guards`) is red when one shell lacks one — a new seam goes in that list in the same PR. A shared decision
   function a shell HOST must call (the screen's data, a duty after an act) is a seam too, added in the PR that adds it;
   and what a shell SAYS is compared by `lint-locale-key-parity` — a one-sided key is a gap or a declared exception.
3. **No duplication.** A string/op/function is defined ONCE. Editing the same thing in two files (e.g. a
   locale key in the web *and* mobile bundle) is the signal to consolidate — then add a guard so it can't
   recur. (`circle.*` locale is now one shared source `apps/basis/src/locales/`; do the same for the rest.)
4. **The manifest is the source of truth for surfaces.** Add an op/surface to `manifest.js`, never a
   per-shell switch statement. After any manifest change, regenerate + commit the coverage snapshot
   (`npm run coverage` in `apps/basis` → `docs/surface-coverage.md`). A GUI button, a tab and a slash command for the
   same act target the same op; a nav target is only for a view that no op backs.
5. **Three-layer dependency invariant:** `apps/` → `packages/{substrates}` → `packages/core` (the **kernel** —
   a lean set of ports + kernel logic). Concrete adapters live *outside* the kernel (`@onderling/transports`,
   `@onderling/pod-client`, `@onderling/vault`); nothing in the kernel depends *up* on an adapter. The dev-facing
   **SDK is `@onderling/sdk`** (the layered facade over the platform). Substrates compose the kernel + adapters and
   don't reinvent the kernel; apps compose substrates (kernel directly only with a justification in the app
   README). → detail: [`architectural-layering.md`](architectural-layering.md).
6. **One agent per service-context.** Transports are routes into a single `core.Agent`; multi-scope state
   lives in per-scope `ItemStore`/`MemberMap` *outside* the agent. N agents for N scopes is an anti-pattern.
   → [`single-agent.md`](single-agent.md).
7. **Functionality is placed by trust + latency — never default-to-server.** Sensitive compute (pods,
   sealing, the confidential LLM transport) stays client-side or in an **attested enclave** (Privatemode/TEE).
   "Server-side" means *extracting* code that is already server-side (pod-hosting, proxy, private LLM), not
   moving private data onto an untrusted host. → [`pod-independence.md`](pod-independence.md).
8. **Every user-facing string goes through `t()`** with a locale entry — hardcoded English is a defect.
   → [`localisation.md`](localisation.md).
9. **Names are legible without the plans — and that includes REFERENCES.** A comment saying `B8`, `C4a`,
   `L13` or `J-CS8` is unresolvable for anyone without the private plan docs, and those are gitignored, so
   for a public reader it is unresolvable by construction. Name the thing (*"the address-fallback setting"*),
   not its row in a list. Journey tags **and checklist ids are both guarded** now (`lint-codenames`,
   baselined — do not grow it). Checklist ids were long recorded as unguardable because `B1`/`C3`/`L4`
   collide with real identifiers — true of a BARE token, but the **label form** `B4 — ` is punctuation,
   not a name, and does not collide (2026-08-03). Same for identifiers, titles and UI labels: a name
   that only makes sense to someone who has read a plan doc is a defect. Spell journeys out in the plans
   too, rather than inventing opaque tags to refer back to.

## Two conventions, long form
- **Log your OWN judgement calls as you make them — dated rule, review on 2026-08-13.** Any choice made
  without Frits goes into `plans/DECISIONS-FOR-REVIEW.md` **in the same turn as the change**, colour-coded
  (🟢 · 🟡 · 🔴), stating **the risk you are taking** and **how to undo it**. Not a batch at the end — the
  file drifted three days in July 2026 and could only be partly reconstructed. → [`decision-log.md`](decision-log.md).
- **Naming is `onderling`; NO backwards compatibility needed** — no "canopy" identifiers; break persisted/wire
  formats freely, no dual-write / fallback / alias cruft (Frits, 2026-08-08 — standing rule; pre-launch, no
  external users, dev state re-derives) — [`naming-and-compatibility.md`](naming-and-compatibility.md).
