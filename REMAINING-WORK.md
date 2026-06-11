# Remaining work — master index (2026-06-10)

One place that points at everything still open across the tracks. Per-track detail lives in the
linked docs; this is the index. Legend: **[code-ready]** = I can build it now · **[blocked]** = needs
creds / a decision / hardware / a device · **[optional]** = breadth, not launch-gating.

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
- **M6 — mobile feedback-bot v2-rewire** **[code-ready]** — the mobile feedback bot is still in the
  orphaned `ChatScreen`; rewire onto the v2 circle surface (rides on the same shared `circleDispatch`),
  retarget the Detox helper.
- **M7 / M8 — TEE hardware checkpoints** **[blocked: hardware]** — attested-enclave aggregation on real
  TEE hardware (Phase 2 of the aggregation-placement design).
- **M9 — agent runtime** **[separate track]** — the project's own agent runtime; deferred, own thread.
- **Category floors — remaining lexicons** **[code-ready]** — `docs/TODO-category-floors.md`: core built
  + deterministically validated, but the per-category lexicons (harassment/sexual-misconduct,
  discrimination/pay, …) are partly open and it hasn't been re-run through the full LLM pipeline e2e.
- **Menukaart breadth** **[optional]** — `docs/MENUKAART.md`: per-scenario safety tuning + scenario
  tests · voice intake (STT) · WhatsApp/Signal/web channels · fuller feedback-to-participant loop
  (block H) · Klai integration · Lingua/LiteLLM borrows · real-data evaluation · participant-editable
  portal.

> Single-scenario launch gate = **M15** + M14 creds. Everything else is breadth or mobile/TEE
> checkpoints.

---

## 2. Canopy-chat — v2 circle bot
Detail: `apps/canopy-chat/docs/circle-bot-token-gate-TODO.md` · `[[project-circle-bot-device-run]]`

- **Token-gate wiring** **[✅ DONE 2026-06-11]** — built, then made **manifest-driven**: the hand-written
  rules were retired for `renderGate(manifest)` (the same projector household uses). add/done/claim route
  deterministically on web + mobile. Device re-verify still pending. See `[[project-circle-bot-device-run]]`.
- **Gate + surface unification** **[code-ready, multi-part]** → see **§7** (`PLAN-manifest-gate-surfaces.md`).
  Per-circle **catalog scoping** now lives there as **Part D**.
- **Smoke checkpoints owed** **[blocked: device/manual]** — web smoke for the 2026-05-24 wave
  (#218/#219/#231.*), first canopy-chat-mobile Android boot, tasks/stoop-mobile screens (#226–#228).
  (Mobile circle-bot boot now DONE — device run 2026-06-10.)

---

## 3. Household app + chat agent
Detail: `apps/household/docs/TODO.md` · `NOTES ON IMPROVING CHAT AGENT.md` · `PROMPT-EXPERIMENTATION.md`

- **Chat-agent prompt** **[code-ready]** — `TODO.md`: "verwerk chat-agent prompt" — fold the
  prompt-experimentation findings into the shipped system prompt.
- **Memory + tool-use uplift** **[code-ready, larger]** — the plan in `NOTES ON IMPROVING CHAT AGENT.md`:
  persistent memory (Mem0 → local vector store), clarify-when-ambiguous, optional tool calling. A
  research-shaped track; size before committing. Default LLM stays Qwen2.5 ([[feedback-llm-default-qwen25]]).

---

## 4. P3 — pod storage / sealing (cross-app)
Detail: `[[project-p3-pod-storage-roadmap]]` · `[[project-p3-sync-engine-absorption]]` (authoritative TODO is off-master)

- **3.3c — app-wiring (web + mobile)** **[code-ready]** — wire the sealed pod-storage substrate into the
  apps' web + mobile surfaces (the sealing substrate itself is DONE: envelope / SealedPodClient /
  sealedIndex / controlAgent, ~54 tests; membership→pod wiring in stoop).
- **2-pod verify** **[blocked: real pods/env]** — end-to-end verification across two real pods.
- **Phase 4** **[code-ready after 3.3c]** — the remaining roadmap phase past app-wiring.

---

## 5. Web ≡ mobile parity gaps (cross-app)
Detail: `[[project-web-mobile-parity-gaps]]` (2026-05-18 audit) · `[[feedback-platform-parity]]`

- **[code-ready]** prioritized gap list: tasks-v0 web invites · folio-mobile history · stoop web
  `markReturned` · … (every app: web ≡ mobile, neither is the primitive one; wire via shared
  device-independent paths).

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

- **Part B — surface coverage scan** **[code-ready, do FIRST]** — `renderCoverage(manifest)` + a
  `npm run coverage` matrix (op × chat/slash/gate/web/mobile/inline-menu) so we can scan what's wired
  where. Cheap; drives Parts C + E.
- **Part D — per-circle catalog scoping** **[code-ready, LLM-critical]** — scope the merged manifest per
  circle; gate + slash + LLM all narrow together. **The #1 LLM-reliability lever** (LLM picks among ~10
  relevant ops, not 125).
- **Part C — per-app `match` fixes + cross-app resolution** **[code-ready, per-app]** — stoop's gate
  declarations are dormant/incorrect (audited 2026-06-11); fix `arg`/`pickerSource`/the invalid `reject`
  body, generalize the circle's clarify lookup per-app, then add each manifest to `renderGate([…])`.
- **Part F — LLM-path polish** **[code-ready, small]** — feed the gate's existing `retrieve` (RAG context)
  into `interpretCommand`; tighten tool descriptors. Makes the LLM remainder reliable (pairs with D).
- **Part A — gate runtime → substrate (`createGate` in `@canopy/manifest-host`)** **[DEFERRED]** — lift
  household's routing + canopy's skip/rule/llm + RAG-retrieve into one substrate engine. **Codebase
  unification (dissolve-apps), NOT required for canopy-chat to work with an LLM** — defer until
  consolidation is the priority. Guarded by household 588 + byte-equivalence.
- **Part E — inline menus** **[later]** — project `surfaces.ui.control` / chat inline keyboards into
  per-op inline menus; the coverage scan (B) shows the gaps to fill.

**Sequencing (current goal = working + LLM-reliable): B → D → C → F**, then device re-verify. A deferred,
E later. (Unification order would be B → A → C → D → E — see the plan doc.)

---

## Fastest code-ready next moves (no creds/decisions needed)
1. **Gate + surfaces §7 (active thread — goal: canopy-chat working + LLM-reliable)** — **Part B** (coverage
   scan) → **Part D** (catalog scoping, the LLM lever) → **Part C** (gate verbs for more apps) → **Part F**
   (RAG context into the interpret call) → device re-verify. **Part A (engine-parity) deferred** — it's
   unification, not needed for the LLM to work.
2. **M6 mobile feedback rewire** (§1) — reuses the shared circle dispatch.
3. **P3 3.3c app-wiring** (§4) — substrate is built, this is the wiring.
4. **Household chat-agent prompt** (§3) — small, self-contained.
5. **Category floors lexicons** (§1) — deterministic, well-scoped.

## Blocked on you
- **M14 creds** (§1) — paste + run preflight.
- **M15 design call** (§1) — the one launch-gating decision.
- **2-pod verify** (§4), **TEE M7/M8** (§1) — real env / hardware.
