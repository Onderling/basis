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

## Part B — Surface coverage scan (`renderCoverage`) — *do this early, it's cheap + drives C/E*
**Why:** you want to scan, per op, which surfaces it has a counterpart on — to find gaps and to plan
the inline menus. A map turns "is this wired?" from spelunking into a glance.

**What:** a pure analysis in `@canopy/app-manifest`:
`renderCoverage(manifest | mergedManifest) -> rows[{ op, app, chat, slash, gate, web, mobile, inlineMenu }]`
(each cell present/absent + a short detail, e.g. the gate verbs). A small script (`scripts/surface-coverage.js`,
`npm run coverage`) prints the matrix as markdown so it's eyeball-scannable and CI-diffable.

**Detection per surface:** chat = `surfaces.chat`; slash = `surfaces.slash.command`; gate =
`surfaces.slash.match` (list the verbs); web/mobile = `renderWeb`/`renderMobile` emit a node for it;
inlineMenu = `surfaces.ui.control === 'button'` / a chat inline-keyboard affordance.

**Output drives Parts C + E** — empty cells are the work list. Tests + the script.

---

## Part C — Per-app `match` declarations + cross-app target resolution (stoop first, then folio/calendar)
**Why:** only `tasks` has correct gate (`match`) declarations. `stoop`'s are **dormant + incorrect**
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

## Part D — Per-circle catalog scoping
**Why:** the circle bot sees all ~125 ops; a household circle shouldn't be choosing among every app's ops
(mis-picks, noise). **Because every surface is a manifest projection, scoping the manifest scopes the gate,
the slash menu, AND the LLM tool list at once.**

**What:** a circle→apps mapping; filter the merged manifest per circle *before* projecting (catalog +
`renderGate` rules + `renderChat` tools). Additive: default = all apps; per-circle override narrows.
**Guard:** unscoped behaviour unchanged when no override is set.

---

## Part E — Inline menus (later — after A–C)
**Why:** you want the small inline menus (buttons) for ops in chat, once chat is solid.
**What:** project `surfaces.ui.control` / the chat inline-keyboard affordance into per-op inline menus
(`renderChat` already exposes `inlineKeyboardFor(item)`). **Part B's coverage scan shows which ops have /
lack an inline-menu counterpart**, so this is a fill-the-gaps pass, not a guess.

---

## Sequencing
**B (coverage scan)** first — cheap, makes the rest legible. Then **A (gate substrate)** → **C (per-app
fixes, scan-driven)** → **D (scoping)** → **E (inline menus, later)**. A and B are independent and can
overlap. Global guardrails: household 588 + byte-equivalence green; circle gate behaviour identical;
back-compat re-exports; each step verified before the next.
