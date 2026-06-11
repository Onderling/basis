# PLAN — lift the chat gate into a substrate (one gating mechanism)

*Small plan to keep us on track. Created 2026-06-11.*

## Goal
**One** deterministic-gate runtime, in a substrate, fed by `renderGate(manifest)`, used by BOTH
household's TG-bot and canopy-chat's circle bot. Lift **household's proven routing** as the basis
(multi-item dispatch + LLM fallback, guarded by 588 tests); fold in canopy-chat's `createTokenGate`
extras (the `skip`/`rule`/`llm` outcomes + the optional RAG `retrieve` hook). Retire the duplicated
copies. This is a concrete step toward [apps dissolving into canopy-chat](./README.md#direction--apps-dissolve-into-canopy-chat-decided-2026-06-11):
an app is its manifest; routing is a shared projection.

## What we're consolidating (current state)
- **Matcher — already shared ✓:** `@canopy/app-manifest` `renderSlash` / `renderGate`
  (manifest `surfaces.slash.match` → commands).
- **household runtime (the mature one):** `HouseholdAgent#routeMessage` — `slash.parse(text)` →
  `null` (→ LLM / help hint) | `[{skillId,args}]` (→ dispatch each, merge) | `{skillId,args}`
  (→ dispatch). Proven; handles multi-item.
- **canopy-chat runtime (newer, more hardcoded):** `createTokenGate` (`apps/canopy-chat/src/v2/tokenGate.js`)
  — rules → `{via:'skip'|'rule'|'llm', command, context}`. Single-command. Has the RAG `retrieve` hook.

## Target API (substrate `createGate`)
```
createGate({ rules, retrieve?, maxContext? })
  .evaluate(text, ctx) -> {
     via: 'skip' | 'rule' | 'llm',
     commands?: [{ opId, args }],   // MULTI-command (lifted from household splitItems)
     context?,                      // RAG context when via:'llm' (from canopy)
     reason?
  }
```
Rule-first (deterministic), then `llm` with optional retrieved context. `skip` = "not for the bot".

## Steps (each verified before the next; back-compat re-export so nothing breaks mid-flight)
1. **Create the substrate engine.** Generalize `createTokenGate` → `createGate` with **multi-command**
   support. Home: **`@canopy/manifest-host`** (runtime manifest consumer) — alt `@canopy/chat-agent`;
   decide here. Unit tests: rule (single + multi), skip, llm, retrieve.
2. **`renderGate` returns multi-command.** Pass the `renderSlash` array through instead of first-of-array.
   Update `renderGate` tests.
3. **canopy-chat consumes the substrate gate.** `circleDispatch` + `circleTurn` dispatch ALL commands;
   `src/v2/tokenGate.js` becomes a thin re-export (back-compat). Verify: circle gate tests + full
   canopy-chat suite + web build. Bonus: circles gain multi-item ("add milk and eggs" → two tasks).
4. **household consumes the substrate gate.** `HouseholdAgent#routeMessage` → `createGate(renderGate(
   householdManifest))`; map `opId`→`skillId`; preserve `null`→help/LLM + multi-item. Delete the manual
   array handling. Verify: household **588** (esp. `manifest-equivalence` + `regexCommands` byte-equality).
5. **Remove the duplication.** `createTokenGate` now lives in the substrate; both apps import it there.

## Guardrails
- household byte-equivalence (`regexParse` === `slash.parse`) + 588 tests MUST stay green.
- canopy-chat circle gate behaviour identical (`add`/`done`/`claim` → `via:'rule'`).
- A back-compat re-export at `apps/canopy-chat/src/v2/tokenGate.js` so mid-migration nothing breaks.

## Non-goals (separate, already-noted follow-ups)
- Fixing stoop's dormant/incorrect `surfaces.slash.match` declarations + cross-app target resolution.
- Per-circle catalog scoping.
