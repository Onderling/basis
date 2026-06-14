# DESIGN — feedback extension (functional + implementation)

**Status: draft for review.** Turns `PLAN-feedback-extension.md` (phasing) into a buildable spec. *Why* lives in
`future-thoughts.md`; *spine + repos* in `REMAINING-WORK.md`. Nothing is built yet. Grounded in the 2026-06-13
code verification (file:symbol citations throughout).

---

## 1. Functional design

### 1.1 What the model delivers
Canopy-chat becomes able to **absorb a third party's functionality with no new app installed**, in two modes that
converge on **one scoped catalog**:

- **Mode 1 — bot-exposed skills.** A project bot is a contact; the slash-commands it exposes *are skills*. Adding
  the contact surfaces those commands **only in the conversation with that bot**; sensitive/project compute runs
  behind the bot.
- **Mode 2 — composite + manifest.** A project ships a **mapping** (pure data): a manifest declaring commands as
  composites of existing ops + a renderer. Loaded from the pod, applied to web + mobile identically.

Feedback is the **exemplar / acceptance test** (real shape = hybrid: Mode-2 manifest for the local curation UI,
Mode-1 bot for the sensitive pipeline). User journeys A (bot) and B (composite) are in `future-thoughts.md`.

### 1.2 The scoped catalog (the core data model)
Every catalog entry carries **(scope, binding)**:

```
CatalogEntry = {
  opId:     string,
  scope:    'app' | 'circle' | 'contact-thread',
  binding:  'local-op' | 'composite' | 'remote-skill@contact',
  bindRef?: { contactId?, skillId? } | { steps? },   // per binding
  surfaces: { slash?, chat?, gate?, web?, mobile? },
}
```
**Invariants:** `remote-skill@contact` ⇒ `scope === 'contact-thread'` (handler is the bot; can't go app-wide).
`composite`/`local-op` ⇒ may be `app`/`circle` (bottoms out in already-present atoms). One merge mechanism, two
loaders, entries differ only by scope+binding.

### 1.3 Data contracts (schemas)

**Mapping manifest (Mode 2 — the downloadable unit, pure data):**
```
Mapping = {
  id, version, title, locale: { en, nl, … },
  needs: string[],                       // atom/op ids the mapping requires (for consent + the verifier)
  scope: 'app' | 'circle',
  ops: Operation[],                      // see composite Operation below
  menus?: MenuDecl[],                    // clickable keyboards
}
```

**Composite Operation (Phase 1 — the missing primitive):**
```
Operation = {
  id, verb, surfaces,
  steps: Array<{ appOrigin, opId, args?: object, argRef?: { from: stepIdx, path } }>,
  onError?: 'stop' | 'continue',         // v0 default 'stop', best-effort, no implicit rollback
}
```

**`redact(text, config)` atom config (Phase 0 — generic engine, project data):**
```
RedactConfig = {
  rules: Array<{ type, pattern: string /*regex*/, replacement, validate?: ValidatorName }>,
  gazetteer?: { names: string[], placeholder, honorifics?, particles? },
  options?: { localeAgnostic?: boolean },
}
ValidatorName = 'bsn-11proef' | 'nl-phone' | 'iban' | 'luhn'   // the NAMED-VALIDATOR REGISTRY
```
Feedback ships its NL `RedactConfig` (today hard-coded in `redact.js`/`names.js`) as **data** in its mapping.

**Virtual manifest from SkillCards (Mode 1):** `SkillCard{ id, description, tags }` →
`Operation{ opId: skillId, binding: 'remote-skill@contact', bindRef:{contactId, skillId}, surfaces:{slash:'/'+skillId} }`
injected at `contact-thread` scope.

**Consent record (Phase 6):** `{ extensionId, scope, grantedAtoms: string[], grantedAt, revocable: true }`.

### 1.4 Non-goals (v0)
Transactional/rollback composites (best-effort only); arbitrary downloaded *code* (tier-3 WASM stays parked);
custom redaction validators beyond the named registry (→ LLM backstop or remote handler); paid bundles / billing.

---

## 2. Implementation design

### 2.1 Component map + **repo boundary** (answers "where does the feedback repo go")

| Component | Repo | Package / path |
|---|---|---|
| `redact(text, config)` atom + validator registry | **platform** | new `@canopy/redaction` substrate |
| Composite-op runner + `Operation.steps` schema | **platform** | `apps/canopy-chat/src/` (→ `manifest-host` at split) |
| Composite **verifier** (fitness fn) | **platform** | `apps/canopy-chat/src/` + CI |
| Pod `mappings/` folder scan | **platform** | extend `packages/pod-routing/src/configResource.js` |
| Manifest merge at scope | **platform** | `packages/manifest-host`, `apps/canopy-chat/src/manifestMerge.js` |
| Folio `diff()` op + **generic** curation renderer | **platform** | `packages/sync-engine` (op) + a shared projector |
| Discovered-skill → manifest bridge | **platform** | `apps/canopy-chat/src/` (PeerGraph listener) |
| Consent/grant UI (AI-explained) | **platform** | `apps/canopy-chat/src/` |
| k-anon · curator · central-pod · aggregation | **feedback repo** | (server-side, behind the bot) |
| project-config · the bot handler · `PeerBridge` | **feedback repo** | |
| the pipeline state-machine **composites** | **feedback repo** | (as a Mapping, data) |
| feedback's NL `RedactConfig` + name gazetteer | **feedback repo** | (data, shipped in the mapping) |
| the feedback **mapping manifest** (slash-commands, menus, curation surface) | **feedback repo** | data |

**The rule:** *generic machinery → platform; feedback's project-specific logic + all its config/data → the
feedback repo.* The feedback repo builds **only** against platform's published SDK + substrate API + pod **ACPs**
— never platform internals. That is exactly the **`external third-party apps`** cut-line in `REMAINING-WORK.md`
("same bundle shape, built against the Solid pod + agent SDK … never touch the main repo"), and it makes feedback
the **dogfood proof** that the extensibility API is real (no privileged backdoor).

### 2.2 Phase-by-phase (file-level)

- **P0 — `@canopy/redaction` substrate.** New package exporting `redact(text, config) → {text, hits}` (port the
  engine from `apps/feedback-pipeline/src/redact.js` + `names.js`, dropping the hard-coded NL content) + a
  `validators` registry (`bsn-11proef` = the 11-proef in `redact.js:isValidBsn`; `nl-phone` = `isDutchPhone`;
  `iban`, `luhn`). Feedback imports the engine, supplies its NL config as data. *Acceptance:* feedback's existing
  redaction tests pass against `@canopy/redaction` + the NL config; no PII logic left in the app.
- **P1 — composite-op runner.** Extend the manifest `Operation` schema with `steps`/`onError`; implement
  `runCompositeOp(op, callSkill, ctx)` (sequential, `argRef` threads step output → next step input); wire into
  `apps/canopy-chat/src/dispatch.js` as a new kind `'composite'` (beside `ready`/`needsForm`/`bulk`). *Acceptance:*
  `/demo = [opA, opB]` runs end-to-end with arg-passing (vitest).
- **P2 — mappings loader + scoped merge.** Extend `packages/pod-routing/src/configResource.js` from single-file to
  a folder scan of pod `mappings/`; feed loaded `Mapping`s into `mergeManifests` at their declared scope; build the
  *open-link → consent → write ref to pod `mappings/`* flow (web first, then mobile). *Acceptance:* drop a mapping →
  reload → commands+menus appear at the right scope → delete → revert; identical web/mobile.
- **P3 — folio diff op + curation renderer.** Expose `packages/sync-engine/src/diff.js` as a manifest op
  (`compare`) with surfaces; build a **generic** before/after curation renderer (a shared projector, not
  feedback-specific) that consumes the diff output; reuse `conflictText.js`/`conflicts.js` extractors. *Acceptance:*
  one `diff()` drives folio file-merge AND a message-curation view via two renderers.
- **P4 — skill→manifest bridge.** Listen on `PeerGraph` upsert (skills from `a2aDiscover`/`skillDiscovery`),
  synthesize a virtual manifest at **`contact-thread` scope**, route `{opId,args}` in that thread →
  `sendA2ATask(contact, skillId, args)`; refresh the command pool on change. *Acceptance:* a bot contact's
  commands appear only in that thread; invoking routes to the bot; removing the contact removes them.
- **P5 — `PeerBridge` + mobile parity.** Finish `PeerBridge` (server/unsigned tier; `InternalBusBridge` is real);
  NKN-on-RN reachability. *Acceptance:* journey A works on web AND mobile.
- **P6 — consent + grants (AI-explained).** Consent card lists `Mapping.needs` (Mode 2) / SkillCards (Mode 1),
  AI-explained; default-deny, scoped, revocable. *Acceptance:* both journeys pass an AI-explained consent step;
  deny blocks; revoke removes surfaces.
- **P7 — extract the feedback repo.** Move `apps/feedback-pipeline` (+ its mapping/config) into its own repo
  consuming only the published `@canopy/*` API + pod ACPs. *Acceptance:* feedback builds + its tests pass with **no
  import from platform internals**; the extensibility API needed nothing privileged. **This is the acceptance test
  for the whole vertical.**

### 2.3 The verifier (fitness function — Phase 1, then CI)
A `Mapping`/composite is rejected unless **every referenced `opId` resolves to a declared op/atom in scope**
(sandbox-by-construction). This is what makes loading a *third-party* mapping safe, and it's a concrete instance of
`REMAINING-WORK.md` step-0 fitness functions (a new one: "loaded mapping → only declared atoms"). Runs at load time
(reject the mapping) and in CI (reject first-party drift).

### 2.4 Test plan
Vitest per slice (runner, verifier, redact engine + each validator, loader, bridge, the diff↔curation reuse);
Playwright (web) / Detox (mobile) at phase boundaries for the two journeys. Web-first then mobile, separate commits.

---

## 3. Relationship to the spine + the two answers

### 3.1 Where the feedback repo goes (your question)
The new repo = the **`external third-party apps`** cut-line in `REMAINING-WORK.md` (own repo, built against the
published SDK + pod ACPs, never touches main) — *more* separate than an in-repo app-bundle, which fits feedback's
role as the external exemplar. In **this plan it is the last step (P7)**, because:
1. **You can't cleanly cut a repo until the seam is enforced** (REMAINING-WORK's own rule: *"you can't cleanly cut
   what isn't cleanly enforced"*). The seam feedback builds against = the extensibility API from P0–P4 + the
   published substrate API. Extract earlier and you churn the boundary as the API moves.
2. **Feedback-as-external-repo IS the acceptance test** — proving a third party builds against the published API
   with no privileged access.

Until P7, develop feedback **in-repo but strictly against the published API** (no platform-internal imports), so
the extraction is mechanical. (This is the same "first-party plugs in exactly like third-party → can become
genuinely third-party" trajectory the cut-lines already describe.)

### 3.2 Is REMAINING-WORK step 0 still relevant? **Yes — more so; it's a precondition.**
Step 0 = the fitness functions (no-dup-key · shell-has-no-dispatch-logic · coverage-fails-on-drift ·
web≡mobile-by-construction). This plan *depends* on them:
- The **P1 verifier** is a new fitness function of exactly that family — it's what makes safe third-party loading
  possible.
- **shell-has-no-dispatch-logic** (0b) is what lets the composite runner + skill bridge live in shared `src/`, not
  the shell.
- **web≡mobile-by-construction** (0d) is what makes a mapping load identically on both platforms (the portability
  claim in journey B).
- **The P7 repo extraction can't be clean without 0 enforced** (REMAINING-WORK's cut rule). So step 0 is a
  precondition for this plan's last phase, not superseded by it.

So: step 0 stands; this plan *realises part of it* (the verifier) and *consumes the rest* (the seams) to reach the
feedback-repo cut. No change to step 0 — it remains the first move.

---

## 4. Open decisions
- **Composite runner's home now** — shared `apps/canopy-chat/src/` (pragmatic) vs straight into a `manifest-host`
  substrate (cleaner, but pre-split). Proposed: shared `src/` now, migrate at the repo split.
- **Curation renderer ownership** — a *generic* projector in platform (preferred; reusable look) vs feedback ships
  a bespoke look. Proposed: generic in platform, feedback selects/configures it.
- **`onError` semantics** beyond best-effort (revisit if partial composites leave bad state).
- **Substrate name** — `@canopy/redaction` vs folding into a broader `@canopy/privacy`.
