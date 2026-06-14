# PLAN — feedback as an extension (the canopy-chat extensibility vertical)

**Status: draft for review.** Companion to `future-thoughts.md` ("Worked example — feedback as an extension").
The goal is **not** "build feedback into canopy-chat"; it's *"make canopy-chat able to absorb a third party's
functionality with no new app installed,"* using `apps/feedback-pipeline` (an **external project**) as the worked
exemplar / acceptance test. Grounded in the 2026-06-13 code verification.

---

## The catalog model (refined — Frits, 2026-06-13)

The merged catalog is **scoped, not flat-global.** Every entry carries a **(scope, binding)**:

- **scope** ∈ { `app/global` · `circle` · `contact-thread` }
- **binding** ∈ { `local-op` · `composite-of-local-ops` · `remote-skill@contact` }

Rules that follow:
- A **`remote-skill@contact` entry is ALWAYS `contact-thread`-scoped.** Its handler is that bot, so it is only
  invokable in the conversation with that contact, and dispatch routes to `sendA2ATask(thatContact, …)`. It can
  **not** be promoted to `app/global` — that would require shipping the bot's internal functionality locally.
- A **`composite-of-local-ops` entry MAY be `app/global` or `circle`-scoped**, because it bottoms out in atoms
  already present on the device — safe to surface broadly.
- One **mechanism** (`mergeManifests` + `scopeCatalogToApps`, extended with a `contact-thread` scope); two
  **loaders** (skill-discovery for Mode 1; pod `mappings/` scan for Mode 2); entries differ only by scope+binding.

This is the through-line of the whole plan: every phase either adds a *loader*, a *binding executor*, or a
*scope* — never a per-shell switch.

---

## Phases

Mode order doesn't matter (Frits) — Phase 1 (composite runner, Mode 2) and Phase 4 (skill bridge, Mode 1) are
independent and can swap. Each phase: **web first, then mobile** as separate commits; vitest per slice;
Playwright/Detox at phase boundaries. Implementation lands on **its own branch per phase** (branch-per-logical-
unit); this plan doc stays on the exploration branch.

### Phase 0 — Graduate the privacy atoms to a substrate
Move the two genuinely-new irreducible ops out of the app (invariant: atoms live in substrates, never apps).
- Extract **`redaction-floor`** (deterministic PII; today `apps/feedback-pipeline/src/pipeline.js:redactMessage`)
  and the **`k-anon` filter** (`apps/feedback-pipeline/src/aggregation/*`) into a `privacy`/`security` substrate.
- Leave `seal`/`sign` (already core crypto) and `call-LLM` (already `llm-client`) alone; `clean`/`triage` stay
  **composites** over `call-LLM`.
- **Acceptance:** feedback imports both atoms from the substrate; no privacy logic remains in the app; existing
  feedback tests green.

### Phase 1 — Composite-op runner (Mode 2 core)
The missing primitive that makes "a slash-command that is merely a composite" real.
- Extend the manifest `Operation` schema with `steps: [{ appOrigin, opId, args | argRef }]`.
- `runCompositeOp(composite, callSkill, ctx)` — sequential dispatch, feed each result forward via `argRef`;
  define error semantics (best-effort, per-step report; no implicit rollback in v0).
- Wire into `apps/canopy-chat/src/dispatch.js` as a new dispatch kind `'composite'` (alongside
  `ready`/`needsForm`/`bulk`).
- **Verifier (fitness fn):** a composite may reference only opIds resolvable in its scope → sandbox-by-
  construction. Fails CI otherwise.
- **Acceptance:** a hand-written composite manifest runs `/demo = [opA, opB]` end-to-end with arg-passing (vitest).

### Phase 2 — Pod `mappings/` scan + scoped merge (Mode 2 delivery)
- Extend the `packages/pod-routing/src/configResource.js` pattern from single-file to a **folder scan** of pod
  `mappings/` at startup (`PodClient.list` + `read`).
- Merge each loaded mapping manifest into the catalog **at its declared scope** (`app`/`circle`).
- "Open link → consent → write a mapping ref into pod `mappings/`" flow (web first, then mobile).
- **Acceptance:** drop a mapping in the pod → reload → new slash-commands + clickable menus appear at the right
  scope; delete the ref → surfaces revert. Identical on web + mobile.

### Phase 3 — Folio `diff()` as a manifest op + curation renderer (reused-op, new "look")
- Expose `packages/sync-engine/src/diff.js` (pure) as a manifest op (`compare` / `compareVersions`) with surfaces.
- Build a **curation renderer** (before/after for *messages*) keyed to a surface — distinct look from the
  file-merge UI, **same compute**. Reuse the conflict-extraction helpers (`conflictText.js` / `conflicts.js`).
- **Acceptance:** one `diff()` drives both folio's file-merge view and a message-curation view via two renderers.

### Phase 4 — Discovered-skill → contact-scoped manifest bridge (Mode 1 core)
- On `PeerGraph` upsert (skills discovered from a bot/contact via `a2aDiscover`/`skillDiscovery`), synthesize a
  **virtual manifest** from its SkillCards.
- Inject it into the catalog at **`contact-thread` scope** (NOT global) — the scope refinement above.
- Dispatch: `{opId,args}` raised in that thread → `sendA2ATask(contact, skillId, args)`.
- Refresh the command pool on `PeerGraph` change.
- **Acceptance:** add a bot contact exposing a skill → its slash-commands appear **only** in that thread →
  invoking routes to the bot → removing the contact removes the commands.

### Phase 5 — Bot transport: finish `PeerBridge` + mobile parity
- Finish the `PeerBridge` (server-run / unsigned tier); `InternalBusBridge` is already real.
- NKN-on-RN reachability so a bot contact works on mobile (the portability caveat).
- **Acceptance:** user journey A (bot) works on **both** web and mobile.

### Phase 6 — Consent + capability grants (cross-cutting)
- The **consent card**: lists the atoms (Mode 2) or skills (Mode 1) the extension needs, **AI-explained**
  (what it can do, why, what-if-deny); default-deny; grant scoped to the circle/thread; revocable.
- **Acceptance:** both journeys pass through an AI-explained consent step; deny blocks; revoke removes surfaces.

### Acceptance test — the feedback exemplar (hybrid)
End-to-end of the **real** feedback shape: Mode-2 manifest for the local curation UI + Mode-1 bot for the
sensitive/remote pipeline. If a *third party* can integrate functionality this way with no new app, the
architecture is proven.

---

## Dependency notes
- Phase 0 should precede treating feedback's client side as a clean mapping, but doesn't block Phases 1/4.
- Phases 1 (Mode 2) and 4 (Mode 1) are **independent** — build in either order.
- Phase 3 is reused by both modes' curation step.
- Phase 5 is only needed for Mode 1 on mobile.
- Phase 6 wraps both; can ship a minimal version per mode as each lands.

## Open risks
- **Composite error/transactional semantics** — v0 is best-effort + per-step report; revisit if a partial
  sequence leaves bad state.
- **Mapping trust** — the verifier (Phase 1) is what makes loading a third-party mapping safe; it must be airtight.
- **Contact-scope legibility** — the UI must make clear a command is *bot-only* (this thread), not app-wide.
- **NKN-on-RN parity** — the most likely thing to break "identical on web and mobile" (Phase 5).
