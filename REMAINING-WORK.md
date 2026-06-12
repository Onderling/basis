# Remaining work — master index (2026-06-11)

One place that points at everything still open across the tracks. Per-track detail lives in the
linked docs; this is the index. Legend: **[code-ready]** = I can build it now · **[blocked]** = needs
creds / a decision / hardware / a device · **[optional]** = breadth, not launch-gating.

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
- **Web browser-smokes** **[harness ✅; classic shell BOOTS; P1/P3 now FAIL ON ASSERTIONS — new findings]**
  — with the chain browser-safe, P1 (`feedback-mount.spec.js`) + P3 (`done-resolver.spec.js`) get PAST
  the boot guard but fail on behaviour: **(P1)** `/feedback` in the CLASSIC shell shows no guidance bubble
  — yet the SAME mount works in the v2 launcher (my Phase-5 `/feedback` is green), so the classic shell's
  inline feedback wiring (main.js `handleUserText`/`feedback()` emit) likely has its own bug; **(P3)**
  `/complete-task <label>` adds the task but the resolver returns not-found — likely a scope mismatch
  (no active circle → `getActiveCircle()` null → the live lookup isn't scoped to where the task landed).
  Both need a focused debug pass (separate from the browser-safety fix). P3 note: literal `/done` is an
  NL-gate verb, unmatched-by-design in the classic shell. The Playwright HARNESS itself now
  works (the loop fix) — `test-browser/circle-kring-bot.spec.js` is the green Phase-5 example.
- **Smoke checkpoints owed** **[blocked: device/manual]** — web smoke for the 2026-05-24 wave
  (#218/#219/#231.*), first canopy-chat-mobile Android boot, tasks/stoop-mobile screens (#226–#228).
  (Mobile circle-bot boot now DONE — device run 2026-06-10.)

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
*Mobile circle bot works e2e (add/done/claim + completion lands); web↔mobile consolidation Phases 1–4
done. Updated priorities (2026-06-11):*
1. **Consolidation Phase 5 — bot+feedback in web's kring composer** (§2) — **NEEDS A BROWSER** (the v2
   launcher is browser-check-flagged). ~150-line assembly of shared pieces into `circleApp.js onSend`;
   precise 9-step spec + 4-line smoke in `web-mobile-consolidation-plan.md`. Do it WITH a browser open.
2. **Web browser-smokes** (§2) — P1 feedback (`/feedback → /klaar → /feedback-stop`) + P3 `/done <label>`.
   Quick manual checks; needed because there's no headless web harness here. Pair with #1 (same browser).
3. **Verify the folio dissolve branch** (§7 Part G) — `824d766b` (`feat/folio-dissolve-part-g`) is
   code-complete but **unverified** (its worktree had no deps); run `vitest` + `npm run coverage` in the
   main tree, then merge if green. Also delete its stray `.git-commit-msg-folio-dissolve.txt`.
4. **P3 3.3c-b** (§4) — wire **household** membership → controlAgent grant/rotate (substrate built, clear
   boundary). 3.3c-c (circle storage) is NOT a quick wire (investigated).
5. **Category-floors e2e LLM re-run** (§1) — only remaining bit; needs an Ollama run on the scenarios.
6. **Household chat-agent prompt** (§3) — a *decision* (make v3 the freeform-V2 default?), not a write.
*Then the deferred gate/surface parts:* **F-retrieve** (= P3 sealedIndex semanticQuery), **E** (inline
menus), **A** (engine-parity → `@canopy/manifest-host`), **G** remaining apps (tasks-v0, stoop+household).
*Non-blocking polish:* `makeResolvingCallSkill` catalog-blind probe-storm + NKN noise; `getMyTasks`
task-less circle base; distinguish permanent `recipient-pubkey-unknown` from transient send failures.

## Blocked on you
- **M14 creds** (§1) — paste + run preflight.
- **M15 design call** (§1) — the one launch-gating decision.
- **2-pod verify** (§4), **TEE M7/M8** (§1) — real env / hardware.
