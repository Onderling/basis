# Circle bot — token-gate wiring (TODO for a fresh session)

**Status:** designed, NOT started. Branch `feat/circle-bot-token-gate` was created then
abandoned empty; start fresh off `feat/circle-bot-polish` (or wherever current).

## Why
Device run (2026-06-10, Fairphone) **verified the mobile circle-bot wiring end-to-end**:
free-text → `@assistant` detect → per-circle policy gate → local LLM (ollama via
`adb reverse 11434`) → interpret → dispatch all fire. Trace:

```
[circlebot] send: "@assistant add milk to the list" | policy: local
[circleDispatch] policy={"llmTool":"local"} providerKeys=["local"] llm=true addressed=true
[circlebot] result: {"via":"llm","cmd":{"opId":"me","args":{"item":"milk"}}}
```

**But the action was wrong.** The small local model (Qwen2.5) picked `opId:"me"` (= `/me`,
show agent identity) instead of `addTask`, and used arg `item` instead of `text`. So nothing
was added to any list — the bot just echoed a generic "done". Root cause: **a small model
choosing from a 125-op flat aggregate catalog is unreliable.** Not a wiring bug.

## Decision (user, 2026-06-10)
**Gate rules first.** Wire the already-built `createTokenGate` so common verbs route
deterministically (no LLM). **Catalog scoping** (narrow the 125 ops per-circle) is a SEPARATE
follow-up branch — the structural fix for the general case.

## Findings from this session (don't re-derive)

- **`createTokenGate`** (`src/v2/tokenGate.js`) is built + tested. API: `evaluate(text,ctx)`
  → `{via:'skip'|'rule'|'llm', command?, context?}`. Ordered `rules` (first match wins): a
  rule with `command(text,ctx)→{opId,args}` ROUTES; without `command` it SKIPS (→ kring);
  else falls to `llm` with optional `retrieve` RAG context.
- **`createCircleDispatch` already accepts a `gate` param** and runs it before the LLM
  (`src/v2/circleDispatch.js` ~L52-60). It's just **never passed** on web or mobile. Wiring =
  build a rule set + pass `gate`.
- **Real op targets (aggregate catalog, app-native opIds):**
  - `add`: tasks-v0 **`addTask`**, param **`text`** (plain required string, NO pickerSource).
    → CLEAN: `"add X [to the list]"` → `{opId:'addTask', args:{text:X}}`. **This is the exact
    failure; ship this rule.**
  - `done`/`complete`: tasks-v0 **`completeTask`**, param **`id`** (required, NO pickerSource).
  - `claim`: tasks-v0 **`claimTask`**, param **`id`** (required, NO pickerSource).
- **done/claim need one small enabler to resolve text→id:** `clarifyCommandTargets`
  (`src/v2/clarifyTargets.js`) only resolves params that declare `pickerSource.listOp`.
  completeTask/claimTask `id` has none → raw label would be passed as a literal id (wrong).
  **BUT** the mobile bot's `lookup` (`circleLookup`, CircleLauncherScreen ~L1510) resolves by
  **label over the circle's loaded `items`** and **ignores the listOp value** — so simply
  annotating those params with any `pickerSource:{listOp:'listOpen'}` makes the EXISTING
  clarify path resolve "done the dishes" → real id (circle-scoped, asks if ambiguous/missing
  via candidate buttons). Web's lookup path: check `circleTurn.js`.

## Plan
1. New module `src/v2/circleGateRules.js`: a default rule set.
   - `add`: `/^add\s+(.+?)(?:\s+to\b.*)?$/i` → `{opId:'addTask', args:{text:'$1'}}`
   - `done`/`complete`: `/^(?:done|complete|mark\s+.*\bdone)\b/i` → `{opId:'completeTask', args:{id:label}}`
   - `claim`: `/^(?:claim|i'?ll (?:do|take))\b/i` → `{opId:'claimTask', args:{id:label}}`
   - (English-first; add Dutch variants in the nl path. All strings via `t()` where surfaced.)
2. For done/claim resolution: add `pickerSource:{listOp:'listOpen'}` to completeTask.id +
   claimTask.id — either in the catalog the bot consumes, or scope the gate to add-only for v1
   and do done/claim in a second slice. (add-only is a fully correct minimal v1.)
3. Pass `gate: createTokenGate({rules})` into `createCircleDispatch` on **web** (`circleTurn.js`)
   and **mobile** (CircleLauncherScreen circleBot useMemo ~L1565).
4. Tests: unit-test the rule set (each verb → expected {opId,args}; non-matches → llm); extend
   circleDispatch tests to assert gate ROUTE/SKIP precedence over the LLM.
5. Re-verify on device: enable the circle's assistant (Settings → `llmTool` → `local`),
   re-open the circle, send "add milk to the list", confirm `via:'rule'` + milk actually in
   the tasks list (not just a "done" echo).

## Re-verify reminders (device)
- A new circle is **assistant-off by design**; turn it on per-circle: circle **Settings** →
  `llmTool` axis → `local`, then **re-open the circle** (policy reads on open).
- ollama route: `adb reverse tcp:11434 tcp:11434`, `EXPO_PUBLIC_CIRCLE_LLM_BASEURL=http://127.0.0.1:11434`.
- A true full reload (dev menu **Reload**, not Fast Refresh) is needed to clear the
  `circleBot` useMemo cache after edits.

## Follow-up branch (separate)
**Per-circle catalog scoping** — narrow the 125-op aggregate to the apps a circle actually
uses, so the LLM (and the gate) only see relevant ops and mis-picks like `/me` aren't even
candidates. Needs a circle→apps notion.
