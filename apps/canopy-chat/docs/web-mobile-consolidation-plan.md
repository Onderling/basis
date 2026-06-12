# canopy-chat — web↔mobile consolidation plan (remove the divergence)

*Created 2026-06-11, after a 3-agent deep-dive audit of web (`web/main.js` + `web/v2/circleApp.js`)
vs mobile (`apps/canopy-chat-mobile/src/screens/`) vs the shared `apps/canopy-chat/src/`.*

> **STATUS 2026-06-12 — all phases SHARED + browser-verified; P1/P3/P5 smokes green; 2 resolver bugs fixed.**
> Phase 0 SKIPPED. **P1 ✅** `createFeedbackMount` (`12d27b14`) — browser-smoke green (`feedback-mount.spec.js`).
> **P2 ✅** `kringBroadcast`. **P3 ✅** `makeCircleLookup` (mobile→web) — browser-smoke green (`done-resolver.spec.js`).
> **P4 ✅** one engine — `circleDispatch` core, `circleTurn` adapter (`d1d35281`). **P5 ✅** circle bot +
> feedback in `circleApp.js`'s kring composer, all 4 `circle-kring-bot.spec.js` smokes green.
>
> **2026-06-12 — feedback-pipeline browser-safety DONE** (`process.env` `dc36e1b5`; `Buffer`→`TextEncoder`
> in `pod-client/sealing/envelope.js` `73a642ed`) so the web shell boots. With the shell finally booting
> headlessly, the P1/P3 smokes ran their bodies for the FIRST time (they used to die at the boot guard)
> and surfaced **two stacked real bugs** in web's typed-slash label resolver, both now fixed + regression-
> tested:
> 1. **circleLookup scope leak** — on a non-circle thread `getActiveCircle()` is null, and the
>    `?? scope?.id` fallback leaked the THREAD id ('main') as a crewId → live fetch hit a non-existent
>    crew → `/complete-task <label>` returned "item not found". Fix: `scopeId` is authoritative when
>    provided (null = default crew). (`circleLookup.js` + unit test.)
> 2. **`_match` bound too late** — the parser leaves the positional body under `_match`; the router bound
>    it to the id-param only in `resolveDispatch`, AFTER `resolveTextArgsInPlace` ran, so the resolver saw
>    no id-param value and never looked the label up. Fix: bind `_match` first in `resolveTextArgsInPlace`
>    (canonical `bindMatchArg`, now exported).
>
> Harness: `playwright.config.js` now injects a dummy `VITE_CIRCLE_LLM_BASEURL` so the circle-bot gate
> smokes are self-contained (the bot only "engages" when a provider exists; the gate never calls it). Two
> test-only gaps also fixed: the smokes' `send()` now presses `Escape` before `Enter` (the command-suggest
> dropdown was swallowing the submit), and the `/done` "documentation" test's premise was corrected (`/done`
> IS a registered command — mockAgent `markComplete` — that also resolves labels, not an "unknown" slash).

## The principle (the test of "done")
The intended model: **logic is written once in `src/` and both shells inject only platform adapters.**
A mobile screen should contain **RN UI + the transport/bundle adapter and nothing else** — every
dispatch/resolution/feedback/messaging decision should live in a shared `src/` module that web and
mobile both call. The bugs fixed this session (dispatch arity, `listOpen`→stoop, `/klaar` unreachable,
fan-out arg-shift) all lived in places where **mobile reimplemented** web's logic instead of sharing it.

## State (what the audit found)
- **Most substrates ARE shared** — ~78 modules re-exported via the `@canopy-app/canopy-chat` barrel and
  imported by both shells (router/dispatch/parser/renderer/thread, manifest projectors, gate, interpret,
  clarifyingDispatch/clarifyTargets, catch-up, kring receivers, deliveryState, feedbackSurface, the
  circle* model/content/stream/preview helpers, …). The divergence is **narrower than it looks**.
- **4 genuine duplicated-logic pairs** (one platform reimplements the other) — the targets below.
- **1 feature gap** — web's kring (GESPREK) composer has no bot/feedback (only plain fan-out); mobile's
  is unified. Mobile is *ahead* here.
- **2 dead modules** — `src/v2/circleLlmRoutes.js`, `src/v2/groupsIndex.js` (zero importers).
- Web has **no bug D** (`getActiveCircle()` → string) and caches `listOpen` (so `done X` resolves if
  the user listed tasks this session — cache, vs mobile's live fetch).

## The 4 divergences (verified, file:line)
| # | Web | Mobile | Why it diverged / risk |
|---|-----|--------|------------------------|
| 1 | `circleTurn.js` (bool return, "else"→defer-to-shell) | `circleDispatch.js` (`{via,cmd}`, "else"→postToKring) | Same gate→interpret→dispatch loop written twice; both headers admit it. Logic drift = the bug surface. |
| 2 | `resolveTextArgsInPlace` (`main.js:2063`, **cache** `lastListingFor`, no clarify) | `circleLookup` (`CircleLauncherScreen.js:1533`, **live** fetch, app-qualified, clarify+buttons) | Two inline resolvers; `clarifyTargets.js` is the intended shared form. Web slash silently no-ops on ambiguity; web can't resolve un-listed labels. |
| 3 | inline feedback glue in `handleUserText` (`main.js:~2216-2252`) + `createFeedbackSurface` direct | `createFeedbackMount` (wraps the surface) | Web's `/klaar` reaches the bot only *by accident* (unknown-slash bucket); `/help` (a real web cmd) would NOT reach the bot. Mount is robust. |
| 4 | `broadcastFanOut` (`circleApp.js:896`) | `broadcastFanOut` (`CircleLauncherScreen.js:1458`) | Near-identical bodies (only rerender vs `setDeliveryTick` differ). |

---

## Plan — sequenced (small/independent wins first, the big unify last)

Guardrails for EVERY phase: full canopy-chat vitest green (currently 2282); web build (`vite build`)
clean; mobile bundle loads (device or metro); no behaviour change unless explicitly the goal; commit
per phase on a dedicated branch.

### Phase 0 — dead-module cleanup *(trivial, do first)*
Delete `src/v2/circleLlmRoutes.js` + `src/v2/groupsIndex.js` (zero importers, verified across `apps/`
incl. tests). Confirm grep finds no references, run the suite.

### Phase 1 — web adopts `createFeedbackMount` *(small, self-contained, fixes a real bug)*
Replace web's inline `handleUserText` feedback block with `createFeedbackMount` (the shared wrapper
mobile already proves). Inject web's `appendUserBubble`/`appendBotBubble` (shell-message renderers) and
keep web's **real-pod activation** (`buildFeedbackPod` on `/feedback <code>`) as a pre-`start` hook the
mount calls. Fixes web's fragile `/klaar`//`/help` routing (the mount's `FEEDBACK_BOT_SLASH` is
explicit). Verify: web `/feedback → text → /klaar → /feedback-stop`; feedback suite green.

### Phase 2 — extract a shared `broadcastFanOut` + optimistic-append *(mechanical)*
Lift the fan-out body (optimistic→pending→sent/failed, retry-same-`msgId`,
`rawCallSkill('stoop','broadcastKringMessage',…)`) into a shared helper beside `deliveryState.js`,
injecting only the rerender/notify callback (web `rerender` / RN `setDeliveryTick`). Same for the
optimistic `chat-message` event builder. Delete both inline copies. Verify both shells still deliver +
mark status; the `recipient-pubkey-unknown` reporting stays intact.

### Phase 3 — unify label resolution on `clarifyTargets` *(medium; web gains a feature)*
Make `clarifyCommandTargets` (+ `createClarifyingDispatch`) the **single** arg-resolution path for both
the typed-slash AND the LLM path, on both platforms. Inject the **lookup source** per platform (web =
`lastListingFor` cache; mobile = `circleLookup` live fetch) — that's the legitimate adapter seam. Retire
web's `resolveTextArgsInPlace`. Web's typed slash then gains the clarification turn (candidate buttons)
it currently lacks, and the `appOrigin` app-qualification applies uniformly. Verify: web `/done <label>`
ambiguity → asks; unique → dispatches; mobile unchanged.

### Phase 4 — unify the orchestrator: one turn engine *(biggest; do after 1–3 prove the seam)*
Collapse `circleTurn.js` + `circleDispatch.js` into ONE platform-neutral `createCircleDispatch` whose
"everything else" is an injected `onUnhandled(text, ctx)` and whose result is a normalized
`{via, cmd}`. Web injects `onUnhandled = () => 'defer'` (and maps the result back to its boolean
"did the shell handle it?"); mobile injects `onUnhandled = postToKring`. The shared core already owns
gate/interpret/scope/addressesBot — only the shell glue differs. Back-compat: keep `circleTurn` as a
thin wrapper re-exporting the unified engine until web's call-site is migrated, then delete it. Verify:
web DM-shell circle bot + mobile kring bot identical behaviour; suite green.

### Phase 5 — close the web kring-composer feature gap *(NET-NEW web feature; do WITH a browser)*
Web's GESPREK composer (`circleApp.js onSend`, ~line 961) only fans out plain messages. Give that page
its own bot + feedback, mirroring mobile `CircleLauncherScreen` but assembling the now-SHARED pieces.
**Scoped (2026-06-11):** `circleApp.js` today has only the agent (`createRealHouseholdAgent` →
`rawCallSkill`/`resolveCallSkill`), `eventLog`, `deliveryStateMap`, `policy`, and the kring stream. It
has NO catalog/LLM/gate/feedback. Build, in `circleApp.js` (the v2 launcher is browser-check-flagged —
verify in a browser as you go):
1. **Catalog** — replicate `main.js`: `mergeManifests([...the same manifest set...])` → `filterCatalog(rawCatalog, appRegistry)`.
2. **LLM providers** — `buildCircleLlmProviders({ localBaseUrl: import.meta.env.VITE_CIRCLE_LLM_BASEURL, model })`.
3. **Gate** — `createTokenGate({ rules: circleGateRules(currentLang()) })`.
4. **Feedback** — `createFeedbackSurface(...)` + `createFeedbackMount({ surface, appendUserBubble, appendBotBubble })` where the bubbles `eventLog.append(kringChatMessageEvent({...actor:'bot'...}))` into the kring stream.
5. **Lookup** — `makeCircleLookup({ getBase: () => <loaded kring items>, appCallSkill: rawCallSkill, scopeId: () => id })`.
6. **Clarify** — `createClarifyingDispatch({ catalog: () => catalog, lookup, dispatchReady: <runDispatch + render a 'bot' kring bubble>, ask/askMissing: <kring bubble + candidate buttons> })`.
7. **Bot** — `createCircleDispatch({ catalog: () => catalog, policy: { llmTool }, userDefault, llmProviders, interpret: interpretToCommand, dispatch: <parseInput→clarify.run | clarify.run>, gate, botName, postToKring: <the EXISTING optimistic-append + broadcastFanOut> })`.
8. **onSend rewire** — `async (text) => { if (await feedbackMount.tryHandle(text, id)) return; await bot.handle(text, { id }); }`. The bot's `postToKring` sink = the current append+fan-out, so a plain message still fans out exactly as today.
9. **Dispatch rendering** — id-mutations now need the circle scope (router.js MUTATE_VERBS, already shared) — pass `scopeReadyDispatch(route, id)` in the clarify `dispatchReady`, like mobile.
**Verify (browser, v2 launcher / index.html):** `@assistant add X`→addTask · `done X`→completeTask (no "item not found") · `/feedback → text → /klaar → /feedback-stop` · a plain message still fans out.
**Risk:** net-new on a browser-check-flagged page; ~150 lines of assembly. Low *logic* risk (every piece is shared + tested) but real *integration* risk → must be browser-verified, not shipped blind.

---

## Composer parity audit (2026-06-12) — classic shell → v2 kring composer

A full audit of the CLASSIC shell composer (`web/main.js` input region) vs the v2 kring composer
(`circleKring.js` / `circleApp.js` / mobile `CircleLauncherScreen.js`) found the kring composer was
missing the classic shell's composer-UX affordances. Triaged into **ported** vs **deliberately-not**:

**✅ PORTED (web + mobile, shared `src/v2/commandSuggest.js` — write-once):**
- **Slash-command auto-suggest dropdown** — type `/pre…` → ranked command list w/ hints; Tab/Enter
  accept, ↑/↓ navigate, Esc dismiss (web); tap-to-fill (mobile). `suggestCommands(catalog, input)`.
- **Bash-style input history** — ↑/↓ recall prior sends + draft restore, de-dup, cap.
  `createInputHistory()`. **Web only by nature** — arrow-key recall has no touch-gesture equivalent;
  mobile gets the suggest list (the tappable parity surface) but not key-history.
- Tests: `commandSuggest.test.js` (11 unit) + `circle-kring-suggest.spec.js` (4 browser). Mobile UI is
  a Detox/manual checkpoint (no RN component-render tooling in-repo; shared logic is unit-covered).

**⛔ DELIBERATELY NOT PORTED (design-divergent — classic shell routing semantics, not circle UX):**
| Classic feature | Why it doesn't belong in the kring composer |
|---|---|
| **DM routing** (`filter.dm===true` → `sendDmMessage`) | A circle is a broadcast surface, not a 1:1 DM channel. No DM mode by design. |
| **Pending-response dispatch** (`pendingResponse` → first reply = response body) | A "Help with"-spawned-DM mechanic tied to the classic thread model; circles don't spawn DM threads. |
| **Label resolution inline** (`resolveTextArgsInPlace`) | The kring composer resolves labels via the **circle bot + `clarifyCommandTargets`** instead (and now its typed-slash bugs are fixed — see the 2026-06-12 status block). |
| **Permission gate** (`allowCommands===false`) | Worth revisiting IF read-only circles land; today every circle is writable. **Open question, not a regression.** |
| **Form-elicitation** (`needsForm` → `renderFormElicitation`) | The bot currently answers `needsForm` with a "needs more info" bubble rather than an inline form. A richer in-kring form is a **possible follow-up**, not a parity gap. |

The two "open question" rows (permission gate, form-elicitation) are the only candidates for future
work; the rest are correct divergences from the circle redesign.

## After this
The mobile screens shrink to RN UI + the `bundle.callSkill` transport adapter; the web shells shrink to
DOM rendering + their dispatcher. Every circle-bot/feedback/kring decision lives in shared `src/`
modules, so the next change can't drift between platforms. This is the canopy-chat instance of the
broader **manifest-driven, write-once** direction (see `PLAN-manifest-gate-surfaces.md`,
`[[project-manifest-driven-surfaces-endgame]]`); a later pass can repeat the audit per app
(household/tasks/stoop/folio/calendar).
