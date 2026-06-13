# Remaining work — master index (2026-06-12)

One place that points at everything still open across the tracks. Per-track detail lives in the
linked docs; this is the index. Legend: **[code-ready]** = I can build it now · **[blocked]** = needs
creds / a decision / hardware / a device · **[optional]** = breadth, not launch-gating.

> **Session update 2026-06-12** — the two top "fastest moves" are now CLOSED: **Phase 5 web kring
> bot+feedback** is browser-verified AND the **web browser-smokes (P1 + P3)** are green — debugging them
> surfaced + fixed **2 real resolver bugs** (`e9e26ceb`). Bonus, beyond the list: **kring composer parity**
> shipped (slash-suggest dropdown · input history · permission gate · conversational form-elicitation), web
> + mobile, on shared modules. Whole chromium browser suite green (17 passed). Top remaining moves are now
> #3–#6 below (folio-dissolve verify · P3 3.3c-b household · category-floors e2e · household prompt decision).
> **Follow-up (a real-run review of the kring bot) fixed 5 more issues** (`fa81f7d4` web · `c3e205c9`
> mobile): missing web circle.bot.* strings (raw key shown) · infra ops like /me reaching+failing the bot
> (now `scopeCatalogToApps`) · bare `/complete-task` saying «couldn't find ''» (now lists options) ·
> feedback not echoing the user's messages (web `appendUserBubble` no-op) · add/complete replies identical
> (now verb-aware Added:/Completed:, on a shared `kringReply.js`). +9 unit + 4 browser smokes.

> **Substrate audit 2026-06-11** (parallel agents) — recurring finding: **the substrates are further
> along than the todos claimed**, so the "remaining" column shrank across the board. Corrected this pass:
> M6 (substrate built, thin wiring left) · category-floors (lexicons all built; only e2e re-run remains)
> · household prompt (already v3-polished) · P3 sealing (substrate 100% done + stoop wired; 3 small
> integration points left) · web/mobile parity (all 3 prioritized gaps CLOSED). The genuinely-unstarted
> items are: M15 design, the household memory/tool-use uplift (research), and the M14/TEE/2-pod
> blocked-on-env items.

---

## 1. Feedback pipeline (M-phases)
Detail: `feedback-pipeline-todo-en.md` · `apps/feedback-pipeline/docs/`

- **M14 — deployment creds** **[blocked: Frits supplies creds]** — scaffolding DONE (preflight +
  `.env.example` + `deploy/M14-checklist.md`). Remaining: paste Privatemode key, CSS owner
  client-credentials, restic target creds, real meldpunt URL into `deploy/.env` +
  `backup-targets/*.env`; then `node scripts/preflight.js` must print ✅.
- **M15 — crisis-response protocol** **[blocked: design decision] → then [code-ready]** — LAST phase,
  blocks launch. Detection + routing are built; the *response* is undesigned: **who** is notified, on
  **what consent**, **how fast**, duty-to-act vs anonymity. Needs a design call, then build.
- **M6 — mobile feedback-bot v2-rewire** **[✅ DONE + device-verified 2026-06-11 (`4f5114a8`)]** — wired
  into the v2 `CircleDetail` (`efbbf092`): lazy `createFeedbackMount`, `sendKringChat` gives the feedback
  mount first refusal before the circle bot. **Device verify (Fairphone) confirmed the full flow** —
  `/feedback → text → /klaar (review) → /feedback-stop` — and fixed **two bugs it surfaced:** (a) the
  feedback bot's OWN slash commands (`/klaar` review, `/help`, `/done`, `/review`) were unreachable
  because the mount only forwarded non-slash text → now forwarded via `FEEDBACK_BOT_SLASH` while active
  (genuine circle slashes still pass through); (b) `broadcastFanOut` had the dispatch arg-shift bug → kring
  messages never fanned out and were falsely marked "sent" → fixed to `rawCallSkill` (delivery status now
  honest: seed/demo members w/o NKN pubkey correctly report `recipient-pubkey-unknown`, not a bug).
  **Follow-ups (non-gating):** interactive M12 chips on mobile (currently text button-labels), the
  /contacts feedback contact item, mobile pod-auth (Phase-1 = in-memory demo), file-picker/identity.
- **M7 / M8 — TEE hardware checkpoints** **[blocked: hardware]** — attested-enclave aggregation on real
  TEE hardware (Phase 2 of the aggregation-placement design).
- **M9 — agent runtime** **[separate track]** — the project's own agent runtime; deferred, own thread.
- **Category floors** **[mostly DONE — audit 2026-06-11]** — the TODO's "open" lexicons are in fact
  **all BUILT** in `src/categories.js`: harassment/sexual-misconduct, discrimination + **pay**,
  retaliation, fraud/integrity, medical-emergency, child-safety (+ crisis in signals.js), wired into
  `triage.js`; tests + 76-test deterministic validation on the B dataset. **Code bits closed 2026-06-11**
  (`e0a07b7a`): sensitive-content quarantine extension (pay-inequality/health/financial/child-welfare) +
  the kenteken PII floor (KvK deliberately deferred — identifies an org). **Only remaining = the e2e
  re-run through the full LLM pipeline** (validated in isolation; needs an Ollama run on the scenarios).
- **Menukaart breadth** **[optional]** — `docs/MENUKAART.md`: per-scenario safety tuning + scenario
  tests · voice intake (STT) · WhatsApp/Signal/web channels · fuller feedback-to-participant loop
  (block H) · Klai integration · Lingua/LiteLLM borrows · real-data evaluation · participant-editable
  portal.

> Single-scenario launch gate = **M15** + M14 creds. Everything else is breadth or mobile/TEE
> checkpoints.

---

## 2. Canopy-chat — v2 circle bot
Detail: `apps/canopy-chat/docs/circle-bot-token-gate-TODO.md` · `[[project-circle-bot-device-run]]`

- **Token-gate wiring** **[✅ DONE + device-verified 2026-06-11]** — manifest-driven via `renderGate`.
  **Device verify was decisive:** the gate ROUTED but commands never EXECUTED on mobile — **4 dispatch
  bugs** (arity / app-qualified picker / `listMine→listOpen` / scope), all fixed + re-verified e2e
  (`22681c7e`). Plus a **per-locale trailing-verb gate** ("X done"/"afwas klaar") + an **ollama request
  timeout** (`5c0c1c84`) + M6 feedback fixes (`4f5114a8`). add/done/claim now actually work on mobile.
- **`done X` actually COMPLETES** **[✅ DONE + device-verified 2026-06-11 (`f952bc9f`)]** — the earlier
  "done X works" was DISPATCH-ONLY: completeTask returned `item-store: item not found` (caught only by
  checking the SKILL result, not just that the dispatch fired). Root cause: multi-pod (per-circle
  peer/store), but `scopeReadyDispatch` scoped only CREATE verbs — the unscoped mutation hit the wrong
  crew. Fix: scope id-targeted MUTATION verbs (complete/claim/submit/approve/reject/remove) to the
  active circle too. See `[[project-circle-bot-device-run]]`.
- **Gate + surface unification** → see **§7** (`PLAN-manifest-gate-surfaces.md`). Progress: **B (coverage
  scan) ✅ · D (catalog scoping) ✅ · C (gate verbs + the 4 dispatch fixes) ✅ device-verified · trailing
  gate ✅ · ollama timeout ✅ · F-prompt ✅**. Remaining: **web cross-app resolution + the A–D fixes ported
  to web** (mobile-only so far), F-retrieve, A (engine-parity, deferred), E (inline menus), G (mock↔real
  reconcile — folio branch `824d766b` unverified).
- **Web↔mobile divergence consolidation** **[Phases 1–4 ✅ DONE; Phase 5 spec'd]** — deep-dive audit
  2026-06-11 (3 agents) found 4 duplicated-logic pairs (where this session's bugs lived). **All 4 now
  SHARED + verified:** P1 web adopts `createFeedbackMount` (`12d27b14`); P2 shared `kringBroadcast`
  (`broadcastKringFanOut`+`kringChatMessageEvent`); P3 shared `makeCircleLookup` (mobile's live lookup
  → web); **P4 one turn engine** — `circleDispatch` is the core, `circleTurn` a thin adapter
  (`d1d35281`). Suite 2296, web build, mobile device — all green. The **dedup goal is met.** P0 SKIPPED
  (the 2 "dead" modules `circleLlmRoutes`/`groupsIndex` are tested-but-unwired — KEPT per Frits).
  **Remaining = Phase 5 only** (below) + 2 web browser-smokes. Plan + P5 assembly spec:
  `apps/canopy-chat/docs/web-mobile-consolidation-plan.md`.
- **Consolidation Phase 5 — bot + feedback in web's kring composer** **[✅ COMPLETE + browser-verified
  2026-06-11 (`fce0d68d` bot, `9b62b285` feedback)]** — `circleApp.js` (v2 launcher) assembles the shared
  engine (catalog/LLM/gate/`makeCircleLookup`/clarify/`createCircleDispatch`) + `createFeedbackMount`
  into its `onSend`, rendering bot/feedback replies into the kring stream via a per-circle `_kringRender`
  bridge. **Headless Playwright-verified by Claude** (4 green smokes, `circle-kring-bot.spec.js`):
  `@assistant add X` → `bot ✓ X` (addTask); `@assistant done X` → resolved + completed, no "item not
  found"; `/feedback` → the feedback bot's guidance bubble. Enabled by fixing a real launcher
  infinite-loop bug (`7f88714c`).
- **Feedback-pipeline browser-safety** **[✅ DONE 2026-06-11]** — the browser feedback surface statically
  pulls in a Node-oriented chain that crashed the web shell at boot. Both top-level browser-incompats
  fixed: `config.js` `process.env` (`dc36e1b5`) + `pod-client/sealing/envelope.js` top-level `Buffer.from`
  → `TextEncoder` (`73a642ed`, byte-identical, sealing 248 tests green). The feedback surface now LOADS in
  the browser → classic shell BOOTS + kring feedback works. NB the sealing FUNCTIONS stay Node-only (a
  browser-WebCrypto tier is future work) — fine for code that never seals (the feedback demo).
- **Web browser-smokes** **[✅ DONE 2026-06-12 — both green; 2 real resolver bugs fixed + harness self-contained (`e9e26ceb`)]**
  — P1 (`feedback-mount.spec.js`) + P3 (`done-resolver.spec.js`) now pass. Debug findings: **(P1)** was a
  TEST-interaction bug — the classic `#199` command-suggest dropdown swallows a lone Enter (accepts the
  highlighted suggestion instead of submitting); `/feedback` guidance was always correct (fix = press Escape
  first). **(P3)** was TWO stacked REAL bugs in web's typed-slash label resolver: (1) `circleLookup` leaked
  the THREAD id ('main') as a crewId when `getActiveCircle()` is null on a non-circle thread → the live fetch
  hit a non-existent crew → "item not found"; fix = `scopeId` authoritative when provided (null = default
  crew). (2) the parser's positional `_match` was bound to the id-param only in `resolveDispatch`, AFTER the
  resolver ran → the label never got looked up; fix = bind `_match` first (`bindMatchArg`, now exported).
  Both regression-tested. Also corrected: `/done <label>` IS a registered command (mockAgent `markComplete`)
  that resolves labels — not "unknown". Harness now self-contained — `playwright.config.js` injects a dummy
  `VITE_CIRCLE_LLM_BASEURL` so the circle-bot gate smokes run without a hand-prepped server.
- **Kring composer parity (classic shell → v2 kring composer)** **[✅ DONE 2026-06-12 — web + mobile]** —
  audited the classic composer vs the v2 kring composer and closed the gaps with SHARED logic (write-once,
  per `[[canopy-chat-unifier-principle]]`): **(1) slash-command auto-suggest dropdown** (shared
  `src/v2/commandSuggest.js` `suggestCommands`) — web dropdown w/ Tab/Enter/Esc/↑↓, mobile tappable list;
  **(2) bash-style input history** (`createInputHistory`, ↑/↓ + draft restore) — web only (keyboard
  affordance, no touch equivalent); **(3) permission gate** — composer respects `isFeatureEnabled(policy,
  'chat')`, chat-off ⇒ read-only note (the circle analog of classic `allowCommands`, existing axis, no new
  axis invented); **(4) conversational form-elicitation** — a single-field `needsForm` asks in the kring
  (`chat.followup_prompt`) and the user's NEXT message answers + dispatches, on the SHARED `src/v2/followUp.js`
  (lifted from mobile's `core/followUp.js`, which now re-exports it). Commits `dc536027`/`1c373db9`
  (suggest+history) · `66a211eb`/`76edef32` (gate+form) · `f46ce375` (3 stale smokes fixed → whole suite
  green). Tests: +11 `commandSuggest` + 6 `circleKring.dom` unit + 3 browser smokes (`circle-kring-suggest`,
  `circle-kring-followup`). DELIBERATELY NOT ported (design-divergent classic routing, documented): DM
  routing, pending-response dispatch, inline label-resolution (the circle bot does it). Detail: the
  "Composer parity audit" section in `web-mobile-consolidation-plan.md`.
- **Smoke checkpoints owed** **[blocked: device/manual]** — web smoke for the 2026-05-24 wave
  (#218/#219/#231.*), first canopy-chat-mobile Android boot, tasks/stoop-mobile screens (#226–#228).
  (Mobile circle-bot boot now DONE — device run 2026-06-10.)
- **Circle bot conversation context (memory)** **[code-ready, moderate — highest-value UX next]** — the
  circle bot's `interpretToCommand` is STATELESS: each addressed turn is interpreted on its own, so
  follow-ups that depend on the previous turn fail. Surfaced 2026-06-13 testing the new in-circle household
  shopping-lists against a Privatemode model (kimi): `@assistant kun je kaas op de lijst zetten` → addItem
  ✅, but `@assistant en schoenen ook` ("and shoes too") → no-match, because it has nothing to attach to.
  The bot ALREADY accepts `interpret(text, { …, context })` (today fed the gate's RAG retrieve); thread the
  **last few KRING TURNS** into that context so the model sees the recent exchange → "and X too" / "remove
  the milk" / "that one" start working. Connects to §3's memory uplift but is a much smaller, circle-bot-
  local change (no store / vector-DB). Verify live against an LLM. NB groundwork already landed: in-circle
  household shopping-lists work (`addItem` + typed `listOpen` + LLM-friendly descriptors, `ac539492`); the
  bot no longer goes silent on a no-tool turn (`onNoMatch` reply, `031e124b`/`ed37de4c`); the list reply
  enumerates items; and the shared `circle.*` locale block was consolidated (`8f31a447`/`0f1fa404`).

---

## 3. Household app + chat agent
Detail: `apps/household/docs/TODO.md` · `NOTES ON IMPROVING CHAT AGENT.md` · `PROMPT-EXPERIMENTATION.md`

- **Chat-agent prompt** **[mostly DONE — audit 2026-06-11]** — the shipped `SYSTEM_PROMPT_CLASSIFY`
  (`src/llm/prompts.js`, PROMPT_VERSION 3) is **already polished** (precision-over-recall, tool-selection
  + type-boundary examples, noise handling). "verwerk chat-agent prompt" is now a *decision* (make v3
  the freeform-V2 default?), not a write.
- **Memory + tool-use uplift** **[research-only — NOTHING built]** — audit confirms **no** memory layer
  exists (no Mem0/vector-store in `apps/household` or `packages/`); tool-use is the basic manifest→ChatAgent
  bridge. The whole 6-step plan in `NOTES ON IMPROVING CHAT AGENT.md` (Ollama/Qwen → bare loop → Mem0 →
  prompt → tools → session scope) is unstarted. A from-scratch research track. Default LLM stays Qwen2.5
  ([[feedback-llm-default-qwen25]]).

---

## 4. P3 — pod storage / sealing (cross-app)
Detail: `[[project-p3-pod-storage-roadmap]]` · `[[project-p3-sync-engine-absorption]]` (authoritative TODO is off-master)

- **Substrate** **[✅ DONE — audit 2026-06-11]** — all 9 sealing modules complete + tested (34 tests:
  envelope / SealedPodClient / sealedIndex / groupKeyResource / controlAgent / podKeyStore /
  memberIdentity / resolveCircleStorage). Zero stubs.
- **3.3c app-wiring** **[code-ready, 3 small integration points]** — only **stoop** membership join/leave
  is wired (✅, `controlAgent` in redeem/leave skills, 7 tests). Remaining = pure integration (substrate
  exists): (b) **household** membership → pass a controlAgent + grant/rotate on add/remove (~2–3d);
  (c) **circle storage** → **NOT a quick wire (investigated 2026-06-11)** — the circle is mesh by
  default (`pod:'none'`); its pod content is the config (`circlePolicyStore`/`circle.<id>.json`) +
  folio files (Drive `PodClient`, `main.js:961`). Blockers: sealing the **config is circular**
  (`storagePosture` lives in it); the real target is **folio content**, not config; and the **group-key
  flow isn't plumbed into circles** (only stoop has `controlAgent`/`podKeyStore`), so a p2 wrap would be
  **inert** today. Needs: a decision (seal folio content, out-of-band posture) + the circle group-key
  flow + a real-pod verify. **Do `(b)` household first** (it has a clear membership boundary). (d) below
  is the verifiable slice; (d) **chat semantic search** → wire `sealedIndex.semanticQuery` into the RAG
  retriever for p2 circles (~1d) — directly **= §7 Part F-retrieve** (one job, two todos).
- **"2-pod verify" / "Phase 4"** **[scope unclear]** — NOT found in the sealing roadmap; likely
  product-level acceptance or the Hub track (P4 = Hub-Android). Clarify scope before treating as work.

---

## 5. Web ≡ mobile parity gaps (cross-app)
Detail: `[[project-web-mobile-parity-gaps]]` (2026-05-18 audit) · `[[feedback-platform-parity]]`

- **[✅ essentially DONE — audit 2026-06-11]** — all three prioritized gaps are **CLOSED**: tasks-v0
  invites (issue+redeem on both, shared `multiCrewOnboarding` skills), folio-mobile history
  (`VersionsScreen` + tests), stoop `markReturned` (both surfaces). A broader sweep found **no remaining
  web-only/mobile-only ops** in the tasks/stoop/folio pairs (high parity). household + calendar are
  web-only **by design** (no mobile counterpart). canopy-chat parity converges via §7 (manifest-driven),
  not duplication.

---

## 6. Manifest-driven surfaces endgame
Detail: `[[project-manifest-driven-surfaces-endgame]]` · `[[project-app-manifest-convergence]]` (`VOORSTEL-uniforme-representatie.md`)

- **SP-3b / SP-6** **[code-ready, large]** — the confirmed direction that ALL surfaces (web/mobile/chat)
  become manifest-driven. The next chapter, not optional polish. App order household→tasks-v0→….
  **§7 below is the concrete, sequenced execution of this for the gate + surfaces.**

---

## 7. Manifest gate + surface unification  ← active plan
Detail: **`PLAN-manifest-gate-surfaces.md`** · `[[project-dissolve-apps-into-canopy-chat]]`

One `manifest.js` = source of truth for every surface (gate · slash · chat/LLM · web · mobile · inline
menus), with a scannable coverage view. Foundation already done: `renderGate` projector + the circle
gate is manifest-driven. Remaining parts:

- **Part B — surface coverage scan** **[✅ DONE 2026-06-11]** — `renderCoverage` + `npm run coverage`
  (canopy-chat) + snapshot `apps/canopy-chat/docs/surface-coverage.md`. Finding: across 118 ops, **gate
  = 17** (chat 118 · slash 111 · web/mobile 59 · inline 25) — deterministic verbs are the sparsest
  surface; that 17 is the Part C list. **Keep the snapshot updated after manifest changes** (`npm run coverage`).
- **Part D — per-circle catalog scoping** **[✅ DONE 2026-06-11]** — `scopeCatalogToApps` scopes the LLM
  tool list by the circle's apps; default drops canopy-chat's 37 infra ops (`/me` etc.). LLM tools
  **125 → 88** default **→ 40** for a household circle. Next (small): UI to set `policy.apps` per circle.
- **Part C — gate verbs all apps + fixes + cross-app resolution** **[✅ DONE 2026-06-11]** — 22 gate verbs
  across tasks/stoop/folio/calendar, stoop's 5 broken declarations fixed, 6 cross-app collisions resolved;
  cross-app label→id resolution wired on mobile (`circleLookup` pulls the op's list via the auto-resolving
  callSkill). **Needs device verify** + web folio/calendar resolution is a follow-up.
- **Part F — LLM-path polish** **[code-ready, small]** — feed the gate's existing `retrieve` (RAG context)
  into `interpretCommand`; tighten tool descriptors. Makes the LLM remainder reliable (pairs with D).
- **Part A — gate runtime → substrate (`createGate` in `@canopy/manifest-host`)** **[DEFERRED]** — lift
  household's routing + canopy's skip/rule/llm + RAG-retrieve into one substrate engine. **Codebase
  unification (dissolve-apps), NOT required for canopy-chat to work with an LLM** — defer until
  consolidation is the priority. Guarded by household 588 + byte-equivalence.
- **Part E — inline menus** **[later]** — project `surfaces.ui.control` / chat inline keyboards into
  per-op inline menus; the coverage scan (B) shows the gaps to fill.
- **Part G — mock↔real manifest reconcile (dissolve core)** **[STARTED 2026-06-11]** — the enabler is
  ✅ DONE: `buildToolDescriptors` now filters the LLM tool list to ops with `surfaces.chat` (no-op today —
  chat 127/127 — but lets a merged real manifest hide its internal/destructive ops). **Remainder (per-app,
  verify each):** (1) ~~param-drift reconcile~~ **NOT a task — verified the "drift" is bridged by the
  realAgent adapter** (`rejectTask reason→note` @809, `markReturned itemId→requestId` @980; stoop
  `postRequest` skill accepts both `kind`+`intent`); the real prerequisite is a **per-app adapter-layer
  decision** (who bridges chat→skill vocab after the merge); (2) merge **folio** → real manifest (cleanest);
  (3) **tasks-v0**; (4) **stoop + household** (dedupe slash + itemTypes); drop the mocks. Full strategy in
  `PLAN-manifest-gate-surfaces.md` Part G + `apps/canopy-chat/docs/part-g-reconciliation-map.md`.

**Sequencing (current goal = working + LLM-reliable): B → D → C → F**, then device re-verify. A deferred,
E later. (Unification order would be B → A → C → D → E — see the plan doc.)

---

## Fastest code-ready next moves (no creds/decisions needed)
*Phase 5 + the web browser-smokes are DONE (2026-06-12); kring composer parity shipped. The remaining
code-ready moves (was #3–#6, now the top of the list):*
1. **Verify the folio dissolve branch** (§7 Part G) — `824d766b` (`feat/folio-dissolve-part-g`) is
   code-complete but **unverified** (its worktree had no deps); run `vitest` + `npm run coverage` in the
   main tree, then merge if green. Also delete its stray `.git-commit-msg-folio-dissolve.txt`.
2. **P3 3.3c-b** (§4) — wire **household** membership → controlAgent grant/rotate (substrate built, clear
   boundary). 3.3c-c (circle storage) is NOT a quick wire (investigated).
3. **Category-floors e2e LLM re-run** (§1) — only remaining bit; needs an Ollama run on the scenarios.
4. **Household chat-agent prompt** (§3) — a *decision* (make v3 the freeform-V2 default?), not a write.
5. **Multi-field inline form in the kring** (§2) — the one composer-parity follow-up left: a 2+-missing
   `needsForm` still shows a "needs more info" bubble; lift mobile's `MultiFieldFormBubble` to render an
   inline form. Small. (Single-field elicitation already ships.)
6. **Circle bot conversation context** (§2) — **highest-value UX next.** Thread the last few kring turns
   into `interpretToCommand`'s existing `context` param so follow-ups ("en schoenen ook", "remove the
   milk", "that one") resolve. Circle-bot-local (no store); verify live against an LLM. See §2 detail.
*Then the deferred gate/surface parts:* **F-retrieve** (= P3 sealedIndex semanticQuery), **E** (inline
menus), **A** (engine-parity → `@canopy/manifest-host`), **G** remaining apps (tasks-v0, stoop+household).
*Non-blocking polish:* `makeResolvingCallSkill` catalog-blind probe-storm + NKN noise; `getMyTasks`
task-less circle base; distinguish permanent `recipient-pubkey-unknown` from transient send failures.

## Blocked on you
- **M14 creds** (§1) — paste + run preflight.
- **M15 design call** (§1) — the one launch-gating decision.
- **2-pod verify** (§4), **TEE M7/M8** (§1) — real env / hardware.
