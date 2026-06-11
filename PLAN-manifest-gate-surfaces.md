# PLAN — manifest gate + surface unification

*Created 2026-06-11. Multi-part roadmap.*

**One sentence:** make the per-app `manifest.js` the single source of truth for **every** surface
(deterministic gate · slash · chat/LLM · web · mobile · inline menus), with a **scannable coverage
view** so we can see at a glance which ops are wired where — the concrete path to
[apps dissolving into canopy-chat](./README.md#direction--apps-dissolve-into-canopy-chat-decided-2026-06-11)
(an app *is* its manifest; "stoop"/"tasks" become navigation labels over shared, projected ops).

Surfaces a manifest op can have a counterpart on, and their projector:

| surface | projector | declared by |
|---|---|---|
| chat / LLM | `renderChat` | `surfaces.chat` |
| slash `/cmd` | `renderSlash` | `surfaces.slash.command` |
| **gate (NL verbs)** | **`renderGate`** | `surfaces.slash.match` |
| web page | `renderWeb` | `surfaces.web` / `ui` |
| mobile screen | `renderMobile` | `surfaces.web` / `ui` |
| **inline menu (buttons)** | (Part E) | `surfaces.ui.control` / chat inline kbd |

---

## Part A — Gate runtime in a substrate (`createGate` in `@canopy/manifest-host`)
**Why:** today the deterministic matcher (`renderSlash`/`renderGate`) is shared, but the *runtime*
that drives it is duplicated — household's `HouseholdAgent#routeMessage` (the mature one: multi-item +
LLM fallback) and canopy-chat's `createTokenGate` (newer; has the `skip`/`rule`/`llm` outcomes + RAG
`retrieve`). Lift **household's routing** into a substrate engine, fold in canopy's two extras.

**Target API** (`@canopy/manifest-host`):
```
createGate({ rules /* from renderGate */, retrieve?, maxContext? })
  .evaluate(text, ctx) -> { via:'skip'|'rule'|'llm', commands?:[{opId,args}], context?, reason? }
```
Rule-first (deterministic, MULTI-command); else `llm` with optional retrieved context.

**Steps** (each verified; back-compat re-export so nothing breaks mid-flight):
1. `createGate` in `@canopy/manifest-host`, generalizing `createTokenGate` with **multi-command**. Tests.
2. `renderGate` returns the full command **array** (not first-of-array). Update its tests.
3. canopy-chat consumes it: `circleDispatch` + `circleTurn` dispatch ALL commands; `src/v2/tokenGate.js`
   → thin re-export. Verify canopy-chat suite + circle gate + web build. (Bonus: circles gain multi-item.)
4. household consumes it: `#routeMessage` → `createGate(renderGate(householdManifest))`; map `opId`→`skillId`;
   preserve `null`→help/LLM + multi-item. Verify household **588** (+ `manifest-equivalence` byte-equality).
5. Remove the duplication; both apps import the engine from the substrate.

**Guardrails:** household byte-equivalence + 588 green · circle `add`/`done`/`claim` identical · back-compat re-export.

---

## Part B — Surface coverage scan (`renderCoverage`) — ✅ DONE 2026-06-11
**Why:** you want to scan, per op, which surfaces it has a counterpart on — to find gaps and to plan
the inline menus. A map turns "is this wired?" from spelunking into a glance.

**Built:** `renderCoverage` + `coverageGaps` + `formatCoverageMarkdown` in `@canopy/app-manifest`
(7 tests); `npm run coverage` (canopy-chat) prints the matrix + a committed snapshot at
`apps/canopy-chat/docs/surface-coverage.md`. **Finding (118 ops):** chat 118/118 · slash 111 ·
web/mobile 59 · inline 25 · **gate only 17** — deterministic verbs are by far the sparsest surface.
That 17 is the Part C work-list; household (8 correct verbs) is the model, stoop's 5 are the
dormant/incorrect ones.

**What:** a pure analysis in `@canopy/app-manifest`:
`renderCoverage(manifest | mergedManifest) -> rows[{ op, app, chat, slash, gate, web, mobile, inlineMenu }]`
(each cell present/absent + a short detail, e.g. the gate verbs). A small script (`scripts/surface-coverage.js`,
`npm run coverage`) prints the matrix as markdown so it's eyeball-scannable and CI-diffable.

**Detection per surface:** chat = `surfaces.chat`; slash = `surfaces.slash.command`; gate =
`surfaces.slash.match` (list the verbs); web/mobile = `renderWeb`/`renderMobile` emit a node for it;
inlineMenu = `surfaces.ui.control === 'button'` / a chat inline-keyboard affordance.

**Output drives Parts C + E** — empty cells are the work list. Tests + the script.

---

## Part C — Per-app `match` declarations + cross-app target resolution
**Status (2026-06-11):** manifest declarations + gate wiring ✅ DONE (workflow-audited); **cross-app
resolution = the remaining slice** (next). Added 22 gate verbs across tasks/stoop/folio/calendar
(`mockManifests.js` + `apps/calendar/manifest.js`), fixed stoop's 5 broken blocks, resolved 6 cross-app
collisions (share→folio, accept→calendar, reject→tasks, cancel→calendar) + extras found in verify
(tasks shadows household add/done → household-mock EXCLUDED from the circle gate; dropped ambiguous
`ik kom`). `circleGate.js` now `renderGate([tasks, stoop, folio, calendar])`. Coverage gate 17→25.
Suite 2277. **Remaining = cross-app label→id resolution (narrower than first thought):**
- `loadCircleItems` (DEFAULT_SOURCES) already pulls **stoop posts + tasks** into the circle's `items`,
  and `circleLookup` returns them → **tasks + stoop labels likely already resolve**. Only **folio files**
  + **calendar events** aren't loaded.
- `makeResolvingCallSkill` already **auto-resolves the app from the opId** (probes origins, skips via
  catalog) — so NO `appOrigin` plumbing in `clarifyTargets.js` is needed (lower blast radius than the
  agent's first plan).
- **Minimal fix:** add `getFiles → folio.listFiles` + `getEvents → calendar.listEvents` to
  `DEFAULT_SOURCES` (matching the existing pattern), OR make `circleLookup`/web-lookup `callSkill(listOp,
  {crewId/circleId/groupId})` with result-shape normalization + an `items` fallback.
- **Implemented (mobile) 2026-06-11:** `circleLookup` (CircleLauncherScreen) is now async + additive —
  base = the circle's loaded items (tasks + stoop posts), PLUS the op's own list via the auto-resolving
  `callSkill(listOp, {crewId/circleId/groupId})`, deduped, best-effort. Covers folio files + calendar
  events without an `appOrigin` change. **Needs a live DEVICE run to confirm** the per-app id/label
  shapes + scoping — do NOT claim it works without that. tasks/stoop stay correct via the base path.
- **Web follow-up:** the web lookup still uses `thread.lastListingFor` (covers tasks/stoop cached); web
  folio/calendar resolution is deferred because web's dispatch is non-uniform (calendar via the
  `household`→`calendar_*` prefix), so a resolving callSkill there needs more care.

**Why:** only `tasks` had correct gate (`match`) declarations. `stoop`'s are **dormant + incorrect**
(2026-06-11 audit): `markReturned`/`getItemTree`/`reportPost` use `body:'match'`→`args.match` but the
param is `itemId` (wrong arg, no `pickerSource`); `signOutOfPod` has `body:'reject'` (**not a valid body
kind — would throw**); `listOpen` is `type-only` but has no `type` param. So we can't just switch them on.

**What:**
1. Fix each app's `surfaces.slash.match`: correct `arg`, add `pickerSource` (`listOp`) for label→id
   resolution, replace invalid body kinds (add a real body for the no-arg/`reject` case).
2. **Cross-app resolution:** the circle clarify lookup is scoped to the circle's loaded items (tasks).
   Generalize so a `stoop` verb resolves against `stoop`'s items (per-op `listOp` → per-app lookup),
   confined to the active circle.
3. Add the fixed manifests to the circle gate: `renderGate([tasks, stoop, folio, …])`.

**Driven by Part B** — the coverage scan's empty "gate" cells are exactly this list. Each app's verbs tested.

---

## Part D — Per-circle catalog scoping — ✅ DONE 2026-06-11
**Why:** the circle bot sees all ~125 ops; a household circle shouldn't be choosing among every app's ops
(mis-picks, noise). **Because every surface is a manifest projection, scoping the manifest scopes the gate,
the slash menu, AND the LLM tool list at once.**

**Built:** `scopeCatalogToApps(catalog, apps)` in `src/v2/circleCatalogScope.js` (named to avoid the
existing `circleScope.js` = item circle-scoping) filters `opsById`/`commandMenu` by `appOrigin`;
`circleTurn` (web) + `circleDispatch` (mobile) scope the catalog the LLM interpret sees by
`circlePolicy.apps`. **Default = `DEFAULT_CIRCLE_ORIGINS`** (the 5 circle apps — drops canopy-chat's 37
infra ops, where the device-run `/me` lived); per-circle `policy.apps` narrows further. **Effect:** LLM
tools **125 → 88** (default) **→ 40** for a household circle. Gate/dispatch unaffected. 6 tests; suite 2277.
**Next (small):** a way to *set* `policy.apps` per circle (the override; default already wins today).

---

## Part F — LLM-path polish (small)
**Why:** the gate handles declared verbs; everything else hits the LLM (`interpretCommand`). Today that
call carries no context and faces the full op set, so it mis-picks (the device-run `/me`).
**What:** (1) feed the gate's existing `retrieve` (RAG context) into `interpretCommand` — the hook
exists, the circle bot passes nothing; (2) tighten the tool descriptors / system prompt. Pairs with
**Part D** (scoping) — together they make the LLM half reliable.

---

## Part G — Reconcile mock ↔ real manifest drift (the dissolve core)
**Why:** canopy-chat's `mock*Manifest` files are the chat shell's slash/gate surface for the REAL apps
(handlers real via `realAgent.js`); intended complementary to `apps/<app>/manifest.js` (which omits
slash) but **DRIFTED** (2026-06-11 audit): tasks-v0 real 25 ops vs mock 32 (only 14 shared); stoop real
14 vs mock 30 with the shared ops declaring `slash` in **both** (duplicated, free to diverge). calendar
already uses its real manifest (the target model). See `[[reference-mock-vs-real-manifests]]`.
**What:** converge to ONE manifest per app that both the app and the chat shell read (calendar-style);
dedupe stoop's slash; rename `mock*Manifest → *SlashManifest`. The concrete core of dissolve-into-canopy-chat.

### Findings (investigated 2026-06-11)
- **The catalog includes EVERY op, surface-unfiltered.** `manifestMerge.js:182` `opsById.set(...)` adds
  all ops (only a *runtime* filter at :143); `commandMenu` is the only surface-filtered projection (ops
  with `slash.command`). So `buildToolDescriptors` (the LLM tool list) surfaced ALL ops — meaning a naive
  "import the real manifest" would expose its **internal/destructive ops** (folio `deleteFromPod`,
  `forceRepush`, …; tasks `removeTask`, `revokeTask`) to the model. THIS is why the curated mocks exist.
- **The "param drift" is NOT bugs — it's bridged adapter vocabulary** (verified 2026-06-11, supersedes the
  reconciliation-map's drift table). The runtime path is mock → **realAgent adapter** → real skill, and the
  adapter bridges the chat-friendly param names: `realAgent.js` line **809** `rejectTask reason→note`, line
  **980** `markReturned itemId→requestId`, line **817** `submitTask` note-default; and some real skills
  accept the chat vocab directly (stoop `postRequest` real skill takes **both** `kind` and `intent` →
  `intentToCanonicalDraft(intent, kind)`, `apps/stoop/src/skills/index.js:420`). So the mock params are
  CORRECT for the runtime path; aligning them to the real app manifest would **break/duplicate the bridges**.
  ⇒ the dissolve cannot be a manifest-only merge — it must account for the **realAgent adapter layer**
  (keep the chat vocab + adapter, OR eliminate the adapter and align mock+real+skills — a bigger change).
- All four real manifests are **pure-data → bundle clean** (audit) → using them directly is feasible.

### Enabler ✅ DONE 2026-06-11 (`buildToolDescriptors` chat-surface filter)
The LLM tool list now only includes ops with a `surfaces.chat` declaration (`interpretCommand.js`).
**No-op today** (the coverage scan shows chat 127/127 — every current op has chat), so it's safe; it's
ALSO correct semantics (the model should only propose chat ops). This is the structural unlock: a merged
real manifest can carry internal/destructive ops (no `surfaces.chat`) and the model will never see them.

### Remainder — the per-app dissolve (sequenced)
1. ~~Reconcile param drift~~ **— NOT a task (verified 2026-06-11): the drift is bridged by the realAgent
   adapter / accepted by the real skills; aligning would break the bridges.** The real prerequisite is a
   **decision on the adapter layer**: when a mock dissolves into its real manifest, who bridges the
   chat→skill vocab? Either (a) the real manifest declares the chat-vocab params + the skills/adapter
   accept them (keep bridging), or (b) drop the chat vocab and the adapter (touches the real skills).
   Decide this per app BEFORE merging — it's the actual hard part, not the param names.
2. **folio** (cleanest: real omits slash + minimal adapter): move the chat ops + surfaces (chat/slash/gate) INTO
   `apps/folio/manifest.js`; its destructive ops stay (no `surfaces.chat` → not surfaced, per the
   enabler); `composeManifests`/`circleGate` import the real folio; drop `mockFolioManifest`.
3. **tasks-v0** (real omits slash): same pattern, after the param reconcile.
4. **stoop + household** (slash duplicated + heavy drift): dedupe slash, reconcile itemTypes, then merge.
5. Each step: regenerate the surface-coverage snapshot; `validateManifest` strict; full suite + web build.
**[code-ready, larger — do per-app, verify each]**

---

## Sequencing — two goals, two orders
The parts are the same; the order depends on the goal.

- **Goal = canopy-chat working + LLM-reliable (current focus, 2026-06-11):** **B → D → C → F**, then device
  re-verify. **Part A is DEFERRED** — it's codebase unification (household engine-parity), not a
  functional requirement for the LLM to work. **Part E** (inline menus) also later.
  - B (coverage scan) = the map · D (catalog scoping) = the #1 LLM-reliability lever (LLM picks among
    ~10 relevant ops, not 125) · C (gate verbs for stoop/household/folio) = common actions stay
    deterministic · F (RAG context into the interpret call) = the LLM remainder is informed.
- **Goal = unification toward dissolve-apps:** **B → A → C → D → E**. Bring in Part A (lift household's
  gate routing into `@canopy/manifest-host`) when consolidating the engine is the priority.

Global guardrails (both): household 588 + byte-equivalence green; circle gate behaviour identical;
back-compat re-exports; each step verified before the next.
