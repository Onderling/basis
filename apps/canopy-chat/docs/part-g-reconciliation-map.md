# Part G — mock ↔ real manifest reconciliation map (2026-06-11)

Agent-investigated (read-only). See `[[reference-mock-vs-real-manifests]]`. The "mock" manifests are
canopy-chat's chat-shell surface for the REAL apps; they've **drifted** from `apps/<app>/manifest.js`.
calendar (used directly, no mock) is the target model.

## Bundle blocker assessment — NONE
All four real manifests (`apps/{tasks-v0,stoop,folio,household}/manifest.js`) are **pure data**
(household imports one sibling string file). **All bundle cleanly in canopy-chat's web build** → using
the real manifests directly (calendar-style) is feasible. This is the green light for the dissolve.

## Op-set drift (real vs mock)
| app | real ops | mock ops | shared | mock-only | real-only |
|---|---|---|---|---|---|
| tasks-v0 | 24 | 33 | 15 | ~14 | ~8 |
| stoop | 17 | 36 | 14 | ~19 | ~4 |
| folio | 7 | 9 | 2 | ~5 | ~5 |
| household | 10 | 8 | 2 | ~3 | ~5 |

## ⚠️ DANGEROUS param drift on SHARED ops (chat shell ≠ real skill)
These mean the chat surface and the real handler disagree — a dispatch can fail or mis-bind:
- **tasks `addTask`**: mock params `assignee,requiredSkill` vs real `notes,dueAt,definitionOfDone` — *entirely different*.
- **tasks `rejectTask`**: mock `reason` (optional) vs real `note` (**required**) — chat can dispatch without it → real skill fails.
- **tasks `approveTask`**: real has optional `note`, mock omits it.
- **stoop `postRequest`**: mock `kind` enum (ask/borrow/share/report/event) vs real `intent` enum (ask/offer/lend) — *different values*.
- **stoop `markReturned`**: mock `itemId` vs real `requestId` (param rename).
- **stoop `leaveGroup`**: mock optional `confirm` vs real required `groupId`.
- **household `markComplete`**: mock `choreId`(pickerSource) vs real `match`(string).
- **itemTypes** diverge in every app (e.g. stoop mock `[post,contact,…]` vs real `[ask,offer,lend,…]`).

## Duplicated slash (declared in BOTH real + mock — free to diverge)
- **stoop**: `/post`, `/lend-return`, `/report` in both.
- **household**: `/mine`, `/done` in both.
- (tasks-v0 + folio real manifests omit slash — the intended split; calendar declares its own.)

## Reconciliation strategy (calendar-style: one manifest per app)
1. **folio + tasks-v0 first** (real omits slash, low-risk): move the chat-shell ops + their slash/gate
   into the real manifest, fix the addTask/reject/approve param drift, import the real manifest in
   `circleGate.js`/`composeManifests`, delete the mock.
2. **stoop + household next** (slash duplicated + param drift): reconcile `postRequest` kind↔intent,
   `markReturned` itemId↔requestId, `markComplete` choreId↔match, dedupe the slash, align itemTypes.
3. Keep `mockHouseholdManifest` as a test fixture only.
4. Verify: `validateManifest` strict on the merged manifests; renderChat/renderSlash/renderGate +
   surface-coverage snapshot; slash-routing smoke (no double handlers).

**Risk note:** the param drift means a naive "just import the real manifest" would change the chat
surface's args for `addTask`/`rejectTask`/`postRequest`/`markComplete` — each needs a deliberate
reconciliation (which param set wins), not a blind swap.
