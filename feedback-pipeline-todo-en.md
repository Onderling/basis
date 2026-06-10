# Feedback pipeline — TODO / what's left to test the whole thing

*Status + roadmap. Companion to the architecture / build-proposal / user-stories /
ethics docs. Updated 2026-06-10.*

## Feedback app — what's left (2026-06-10 review)

Core is BUILT + tested (Tier 1–3 `[x]`; 246 tests + M10 mockup smoke green). The remaining feedback-app
work is now **folded into the M-phase sequence** (2026-06-10, by request) — the canopy-bot plan extends
from M10 to **M15**, with **crisis-response last** (everything else ships without it):

- [x] **M11 — Surface `/feedback` in the command menu / manifest** — DONE 2026-06-10
      (`feat/feedback-in-menu`). Added `/feedback [code]` + `/feedback-stop` ops to canopy-chat's
      `manifest.js`, so they surface in `/help` (`catalog.commandMenu`) + slash autosuggest
      (`catalog.opsById`) on web AND mobile (shared manifest). Execution stays intercepted in
      `main.js handleUserText` (never dispatched via the catalog). 3 tests; full canopy-chat suite 2231
      green; web build ✓.
- [x] **M12 — Review buttons as click-to-inject chips** — DONE (web) 2026-06-10 (`feat/feedback-chips`).
      The bot already emits buttons (`{id, label}`); `main.js`'s feedback emit now renders them as
      INTERACTIVE chips (a one-row list payload via `feedbackButtonItems`) instead of text bullets — tap
      → `onButtonTap('fpTap')` → `feedbackSurface.tapButton(controlId)`. The `fp:*` control ids contain
      colons (would break the shell's `opId:itemId` split) so they're URI-encoded in callbackData +
      decoded on tap. 4 tests; feedback suite 20 green; web build ✓. Mobile M12 rides on **M6** (the
      mobile feedback bot is still in the orphaned ChatScreen).
- [~] **M13 — Curator UI surface + publish/persist + route signals** — backend + view DONE 2026-06-10
      (`feat/curator-release`). `release()` now (1) **persists** the report artifact to an injected
      `reportStore` (surfaced — a publish failure throws), and (2) **routes** the aggregate's confirmed
      signals to the config's `signal.destinations` via `routeSignals` (best-effort + recorded;
      severity/`*` fallback). `renderCuratorView` (curator/render.js) is the localised REVIEW surface
      (theme include/exclude status · quarantine held/released · each signal → its destination · release
      hint), en+nl. 8 tests; feedback suite 254 green. Remaining: the **live interactive portal page** —
      a curator route that renders `renderCuratorView` + POST handlers calling
      `includeTheme`/`releaseQuarantine`/`release` (portal/server.js), and the real `reportStore`/
      `sendSignal` adapters (pod write + meldpunt transport). Crisis TIMING is M15.
- [ ] **M14 — Deployment readiness** (config, not code): Edgeless/Privatemode **account + key**; set
      `FP_LLM_BASEURL`/`FP_LLM_APIKEY`, `FEEDBACK_ACTIVATION_URL`; **pin images by `@sha256`**; fill real
      **restic target creds**.
- [ ] **M15 — Crisis-response protocol (LAST phase, blocks launch).** Detection is built; the *response*
      (who's notified, on what consent, how fast, duty-to-act vs anonymity) is **undesigned** → a design
      call first (see Open Questions below), then build. Deliberately the final phase.

**Owed earlier M phases — see "Checkpoints owed" section:** M6 (mobile feedback-bot v2-rewire + retarget
Detox helper), M7/M8 (TEE hardware). M9 (agent runtime) is a separate track.

- [x] **PRE-EXISTING web build break (since `53f051fc`)** — FIXED 2026-06-10. `vite build` failed:
      `project-seal.js` imports Node crypto (`createPublicKey`/`createPrivateKey`/`diffieHellman`/
      `hkdfSync`) reached eagerly via `feedbackSurface` → `central-pod` (`isSealed`). The web crypto
      shim (`src/web/shims/node/crypto.js`) is a deliberate throwing-stub layer; it just lacked those 4
      exports. Added them as stubs (the eager path only calls the pure `isSealed`, never crypto; real
      seal/open run server-side). `✓ built in 23.55s`. NOTE: real **in-browser** sealing is still
      unimplemented (a stub throws if invoked) — if a browser path ever needs to seal, build a
      WebCrypto/`subtle`-backed seal impl. C's live run is now unblocked.

**Menukaart breadth (⬜ in `docs/MENUKAART.md` — per-client / scenario-readiness, optional):**
per-scenario safety tuning + scenario tests · voice intake (STT) · other channels (WhatsApp/Signal/
web) · fuller feedback-to-participant loop (block H) · Klai integration (2b/2a/1) · Lingua/LiteLLM
borrows · real-data evaluation · participant editable portal.

> For a SINGLE production scenario the gating items are: crisis-response + curator-UI/report/signals
> + the deployment secrets. Everything else is breadth or the mobile/TEE checkpoints.

## Done 2026-06-07 — privacy & security layers (PR-1 → PR-4 + Phase 1)

Test suite **137 → 216**, nothing skipped; the pre-existing `pseudo-pod-integration` test
fixed by wiring the pnpm workspace (`@canopy/*` resolves). New runnable demos (no external
deps): `npm run secure-smoke`, `byo-tee-smoke`, `phase1-smoke`. Full design write-up in
`apps/feedback-pipeline/docs/SECURITY-MODEL.md`.

- **PR-1 — at-rest sealing** (`pod/project-seal.js`): hybrid sealed-box (AES-256-GCM +
  ephemeral X25519 → HKDF) to the project public key. Host-blind writer (public key only);
  only a private-key holder opens. Wired into `CssCentralPod`/`InMemoryCentralPod` via
  `crypto-config.js`.
- **PR-2 — portal + GUI** (`portal/`, `scripts/portal.js`): the menukaart project store +
  cohort codes + invite links; `npm run portal`.
- **PR-3 — authenticity + handshake + notify + signing**: Ed25519 contributions
  (`pod/signing.js`, wire-compatible with `@canopy/core` `AgentIdentity` — proven by test);
  the **HI handshake** folds a signed identity registration into activation (one code → one
  verified identity, anti-sybil); per-project `IdentityRoster`; **two-way notify**
  (`channel/notify.js`) sealed to the participant; **dispatcher signs** on consent
  (canopy-chat on-device) with a graceful `verification-required` / rollback for the TG
  delegate.
- **PR-4 — pluggable backends + TEE boundary**: the `CentralPod` contract
  (`pod/central-pod-interface.js`); **`ByoCentralPod`** (bring-your-own-pod aggregation,
  verifies across sources); the **TEE aggregation boundary** (`tee/aggregate.js`) — open +
  verify + aggregate inside one function, only the aggregate + attestation leaves.
- **Phase 1 — aggregation placement** (`aggregation/placement.js`): the team's ENFORCED
  trust choice `aggregation.location` = `host` / `controller` / `enclave`; a process declares
  its role via `FP_RUNNER_ROLE` and cannot build an opener it isn't entitled to. Controller-
  side entry `runProjectAggregation` + the Privatemode route bridge (`applyLlmRoute`).
  Phase 2 (decryption inside an attested TEE) is documented as the next step.

## Done & proven (individually)

- **Pipeline brain** — floors (`floorMessage`), Task 1 (`runTask1`, dispatcher), Task 2
  (`aggregate` + k-anon + signal routing + below-threshold), config-driven (`run.js`),
  the `ProjectConfig` "form". Unit + integration tests (mock LLM). (216 tests total now — see "Done 2026-06-07".)
- **LLM route** — OpenAI-compatible config block (local Ollama default; any
  `{baseURL, apiKey}`). Proven against Ollama + a mock server.
- **Central pod** — same interface on three backings: in-memory, real `@canopy/pseudo-pod`,
  and a **live Community Solid Server** (`CssCentralPod`, real DPoP auth).
- **ACP** — per-participant container with **consent-as-write enforced** on live CSS
  (participant write/delete, owner+aggregation read, aggregation read-only, others 403).
- **Activation** — cohort-code lifecycle (single-use, expiry, ceiling, amnesic) + the
  cohort CLI + activation orchestration (`activate.js`, injected provisionPod).
- **Channel** — the `ChannelAdapter` interface + channel-agnostic dispatcher.

## Tier 1 — glue I can build & test in-repo now (no new externals)  ← DONE 2026-06-04

- [x] **`provisionPod`** — `src/activation/provision-css-pod.js`: the activation service
      creates the participant's ACP-locked container in the project pod (via
      `provisionParticipantContainer`) and returns the podRef. Plugs into `activate.js`'s
      injected seam (takes the owner's authed fetch; no auth dependency).
- [x] **End-to-end backbone smoke** — `scripts/e2e-smoke.js` (`npm run e2e-smoke`):
      `cohort → activate (provision ACP container) → dispatcher (floor→clean→points→
      consent) → write to the ACP container with the participant's OWN fetch → aggregation
      reads the central pod (owner fetch) → Task 2 (k-anon themes)`, against the **live CSS**
      + the **mock LLM**. Proven green: 2 participants onboarded, each consent-wrote to their
      own container, **bob→alice's container = 403**, aggregation surfaced "waiting times"
      at k=2. Gated (skips without CSS / `@inrupt/solid-client-authn-core`).
      `CssCentralPod` was refactored to per-participant sub-containers + recursive listing
      so the layout matches the ACP model (each participant owns `central/<them>/`).

## Tier 2 — real surfaces (bigger builds; need substrate/external)

- [x] **Real channel adapter (Telegram)** — `src/channel/telegram-adapter.js`
      (`TelegramChannelAdapter`, `floorsTrust: 'post-receipt'`, pure `renderMessage`) +
      `src/channel/telegram-bot.js` (`TelegramFeedbackBot` multiplexer: one dispatcher per
      chat, routes free text + button callbacks). Decoupled from the substrate via a minimal
      `onMessage`/`sendReply` bridge interface, so the app stays dependency-free. Unit-tested
      against a fake bridge + mock LLM (`test/telegram-channel.test.js`, 5 tests: render
      shapes, post-receipt floor, full round trip message→review→consent→pod→withdraw,
      crisis escalation offer, two-chat isolation). Live smoke `scripts/tg-bot-smoke.js`
      (`npm run tg-bot-smoke`) drives the **real** `@canopy/chat-agent` `TelegramBridge`
      (gated on `FP_TG_BOT_TOKEN`; substrate import + telegraf confirmed to load).
      Dispatcher hardened to `await` async pod ops (correct against `CssCentralPod`).
      All participant-facing prose lives in a single string table per language
      (`src/strings/{index,nl,en}.js`) — the derived-app i18n convention; the channel layer
      calls keys, hardcodes nothing. Locale follows `config.language.preferred`; proven by a
      locale-switch test (nl/en) + an English-project bot test.
- [x] **canopy-chat adapter (pre-send, natural language)** — `src/channel/canopy-chat-adapter.js`
      (`CanopyChatChannelAdapter`, `floorsTrust: 'pre-send'`, floor runs on-device) +
      `src/channel/canopy-chat-bot.js` (`CanopyChatBot` multiplexer) +
      `src/channel/intent.js` (NL intent classifier: deterministic anchored fast-path +
      the app's own LLM route for the ambiguous rest, default = feedback message). Free text
      drives the SAME dispatcher journey as Telegram; button callbacks still work too.
      Shared with Telegram via `src/channel/actions.js` (parseControl + runAction) and
      `src/channel/render.js` (one renderer, both surfaces). Unit-tested
      (`test/canopy-chat.test.js`, 5 tests) + live smoke `scripts/canopy-chat-smoke.js`
      (`npm run canopy-chat-smoke`) proven against the **real** `@canopy/chat-agent`
      `InMemoryBridge`: free-text feedback → "klaar" (review) → "verstuur alles" (consent)
      → 2 contributions in the pod, the intent routing going through the LLM path.
- [x] **canopy-chat app HOSTS the bot** — integrated into `apps/canopy-chat`. canopy-chat's
      free-text path was a dead end ("didn't understand"); now a thread enters feedback mode
      via `/feedback`, and free text is routed to the bot. Pieces:
      `apps/canopy-chat/src/feedback/feedbackSurface.js` (DOM-free surface that hosts the
      `CanopyChatBot`; host injects an `emit` render sink; LLM route injected via `llmRoute`
      since the browser has no env) + thin glue in `web/main.js` (`/feedback` + `/feedback-stop`
      commands, and one line in the `unknown` branch to route free text to the bot before the
      fallback). Made `src/ollama.js` browser-safe + injectable (`setLlmRoute`, env guarded).
      PROVEN: vitest `apps/canopy-chat/test/feedback/feedbackSurface.test.js` (3 tests:
      gated-until-/feedback, full journey message→klaar→verstuur alles→pod, thread isolation)
      AND a full `vite build` succeeds — the browser-safe bot chain (zod/eld/floors/dispatcher)
      bundles with no Node-only leaks. canopy-chat's 2153-test suite still green.
      Follow-ups (noted, not blocking): render the bot's review buttons as click-to-inject
      chips (today canopy-chat uses the natural-language path); wire a real participant pod
      (CssCentralPod + browser DPoP) in place of the in-memory default; surface `/feedback`
      in the command menu/manifest.
- [x] **Curator workspace + transparency counters** — `src/curator/workspace.js`
      (`createCuratorWorkspace({aggregate, pod, reportId})`: review draft → include/drop
      themes, release/hold quarantined items → `release({now})`), `src/curator/transparency.js`
      (counters accounting for ALL input: participants, contributions, themes found/included/
      dropped-by-curator/below-threshold, quarantined, signals, rejected), `src/curator/render.js`
      (localised report). Release is the MECHANISM behind two guarantees: it marks the included
      contributions in the pod (`markIncluded` → withdrawal blocked) and records them in a
      verifiable `manifest` (`withdrawalViolations` stays empty — a contribution withdrawn
      before release can never appear). Threaded contribution `id` through `forAggregation`
      (all 3 pods) + `aggregate` so themes carry `contributionIds`. Curator strings added to
      the `src/strings` table (nl/en). Tests `test/curator.test.js` (5: default-include +
      counters, release→mark+manifest, drop-theme, withdraw-before-release verifiable,
      localised render) + demo `scripts/curator-smoke.js` (`npm run curator-smoke`, self-
      contained). 154 tests pass.
      Follow-up (not blocking): a curator UI surface (host this in an app like the channel
      bots) + wiring `release` to publish/persist the report artifact + route the signals.

## Tier 3 — deployment / ops

- [x] **3a — Activation service** — `src/activation/server.js` (`handleActivate` pure handler
      + `createActivationServer` over `node:http`; `POST /activate {projectId, code,
      recoveryHash, webId}` → ACP-locked container + podRef; outcome mapping 200/400/409/502,
      provision-failure leaves the code unspent/retryable) + runnable
      `scripts/activation-service.js` (file-backed registry + the real `provisionCssPod` with
      the owner's DPoP fetch; gated on CSS/auth/env). Tests `test/activation-server.test.js`
      (5). The provisionCssPod+ACP layer it wraps is already proven live (Tier-1 e2e).
- [x] **3b — Compose stack (infra-as-code)** — `deploy/docker-compose.yml` (css + privatemode-
      proxy + activation + caddy), `deploy/Dockerfile.activation`, `deploy/Caddyfile`,
      `deploy/.env.example`, and `feedback-pipeline-runbook-en.md` (operator sequence).
      `docker compose config` **validates**. (Not a live cloud deploy — no VPS in sandbox.)
- [x] **3c — Real participant-pod wiring (code)** — `src/pod/css-auth.js`
      (`clientCredentialsFetch` server-side DPoP fetch + `makeCssCentralPod` from a browser
      fetch OR credentials) + ACP **writers** role (`containerAcp`/`provisionCssPod` —
      the TG bot service writes on a participant's behalf, post-receipt; canopy-chat
      participants write themselves with browser keys). The surfaces already accept `pod`;
      `scripts/tg-bot-smoke.js` now auto-builds a `CssCentralPod` when pod creds are present;
      activation-service refactored onto the shared helper + `FP_WRITER_WEBIDS`. Tests
      `test/css-wiring.test.js` (3: ACP writers Turtle, makeCssCentralPod writes the
      per-participant container via an injected fetch, TG bot drives a real CssCentralPod
      offline end-to-end). The live path is the Tier-1 e2e/ACP smokes.
      canopy-chat browser-auth wiring is **done**: `apps/canopy-chat/src/feedback/feedbackPod.js`
      (`activateParticipant` → the activation service, `buildFeedbackPod` → a flat
      `CssCentralPod` over the browser session's authenticated fetch, `getOrCreateRecoveryHash`)
      + `main.js` `/feedback <code>` activates with the logged-in pod session (`podAuth`) and
      binds the surface to the real pod (falls back to in-memory when no code/URL). Needed a
      `flat` mode on `CssCentralPod` (participant writes their OWN container directly) +
      `makeCssCentralPod({flat})`. Tests `apps/canopy-chat/test/feedback/feedbackPod.test.js`
      (3) + the surface's pod made lazy/async; full `vite build` bundles it (the Node auth lib
      stays opaque to the browser bundler). Remaining (polish): set `FEEDBACK_ACTIVATION_URL`
      to the deployed service.
- [x] **3d — Privatemode + backups (code)** — Privatemode is config-complete (compose proxy +
      the OpenAI config block); added `scripts/llm-health.js` (`npm run llm-health`) to verify
      the route on bring-up. **Backups: multi-target restic, verified.** `deploy/backup.sh`
      (init → backup → prune → **check**; subcommands `check`/`snapshots`/`restore`; iterates
      every `backup-targets/*.env`, so 2+ providers = redundancy) + `deploy/run-scheduled.sh`
      + a `backup` **compose sidecar** + `backup-targets/{primary,secondary}.env.example`
      (S3 + B2) with a `.gitignore` for real creds. Exercised end-to-end against two local
      restic repos: backup + prune + check (no errors) + **restore from both** targets, data
      identical. Runbook §8 + go-live §8 updated.
      Remaining (polish): an Edgeless account/key, pin the proxy + restic images by `@sha256`,
      set `FP_LLM_BASEURL`/`FP_LLM_APIKEY`, and fill in the real restic target creds.

## Open questions (decide before the relevant launch)

- [ ] **Crisis response protocol — what to DO when a crisis is detected.** Detection is being
      built now (crisis = deterministic lexicon AND LLM agree; high precision). The *response*
      is undesigned: who is notified, on what consent, with what message, how fast, by whom,
      and the duty-to-act vs consent/anonymity tension. Until decided, a detected crisis is
      flagged for human review + the passive 113 resource is shown; no automated outreach.
      See `feedback-pipeline-ethics-deferred-en.md` §1.

## To revisit — docs written 2026-06-07 (security evening)

- [ ] **Re-read `apps/feedback-pipeline/docs/SECURITY-MODEL.md`** — the trust model: the two
      keys (participant identity vs project key), the plaintext-in-RAM map, the enforced
      aggregation **placement** choice (`host` / `controller` / `enclave`), **Phase 1**
      (controller-side decryption + Privatemode — shipped) and **why Phase 2** (the TEE
      endgame) is needed. Sanity-check it against the implemented code before any launch.
- [ ] **Re-read `apps/feedback-pipeline/docs/AGENT-RUNTIME.md`** — the PARKED "runtime browser"
      idea (key-custody wallet + egress firewall + embedded renderer; Tauri desktop, Expo
      mobile). Decide if/when it becomes its own project; see its §7 open decisions.

_(2026-06-09: starting the canopy-bot build plan — `apps/feedback-pipeline/docs/CODING-PLAN-canopy-bot.md`; M0 done, M1 next.)_

## Checkpoints owed (can't be verified headlessly) — canopy-bot build

- [ ] **M6 — REWIRE the mobile feedback bot into the v2 circle surface** (device run 2026-06-09
      found the gap). The wiring is in `ChatScreen.js`, which v2/SP-13.1 made an invisible
      background peer-router — the live UX is the circle launcher + `CircleStreamScreen`/
      `CircleScreenView`, which post to the kring and DON'T run slash dispatch, so the bot is
      unreachable as wired (`/contacts` posts as text on the phone). Needs: (a) a UX call — how
      feedback fits the kring (a `/feedback` in the kring input? a dedicated entry? agent contact in
      a v2 contacts view?), (b) that screen's input handling. Logic + Metro bundling are done;
      integration point is orphaned. The Detox `gotoChat` helper is also stale (targets the removed
      chat shell) — fix or retarget it. Then verify on device. Set `EXPO_PUBLIC_FEEDBACK_LLM_BASEURL`
      to a reachable route for the full clean/review round-trip.
- [ ] **M7/M8 — TEE hardware bring-up.** The attestation-VERIFICATION seam is built + tested
      (`src/tee/attestation.js`: `verifyAttestation` / `assertEnclaveAttested` /
      `verifyGatewayAttestation`); what remains needs confidential-computing hardware: a real CVM
      (AMD SEV-SNP / NVIDIA H100), the SEV-SNP/Contrast quote producer + key-release, and (M7) the
      gateway enclave image + the client RA-TLS quote-fetch handshake. Swap `localAttestation()` +
      the quote fetch for the real ones; the gates stay. See `docs/CONFIDENTIAL-LLM-TRANSPORT.md`.

## Household circle + storage/encryption substrate (2026-06-10 design → build)

Design docs: `docs/STORAGE-SECURITY-MENUKAART.md` (posture decision layer) ·
`docs/POD-ENCRYPTION-MODEL.md` (mechanics) · `docs/HOUSEHOLD-LLM-CIRCLE-JOURNEYS.md` (the circle) ·
`docs/V2-LLM-IN-CIRCLE.md` (the shared NL→slash capability + the feedback v2 rewire).

### Sealing substrate — `@canopy/pod-client/sealing` (OPT-IN primitive, NOT a forced default)
- [x] **Lift + generalize `src/pod/project-seal.js` → `packages/pod-client/src/sealing/`** — DONE
      2026-06-10 (`feat/household-sealing`). `sealing/envelope.js`: verbatim recipient-mode crypto
      (per-resource CEK + X25519→HKDF, same `fp1:` format) + NEW group-key mode
      (`sealWithGroupKey`/`openWithGroupKey`; modes reject each other). feedback's `project-seal` is now
      a thin re-export (no behaviour change; feedback 246/246 + web build green). 11 tests.
- [x] **`SealedPodClient` wrapper** — DONE. `sealing/SealedPodClient.js`: seal-on-write / open-on-read
      over any PodClient; bodies sealed, structure cleartext; pluggable `recipientStrategy` /
      `groupKeyStrategy`; legacy plaintext passes through; append seals per line. 7 tests. (Key custody
      is injected as the strategy; wiring `@canopy/vault` as the custody source is app-side.)
- [x] **Versioned key resources** — DONE. `sealing/groupKeyResource.js`: a version's group key sealed to
      all members in one envelope (`/.keys/group-vN.json`); `grantMember` (O(1) re-seal, same version) +
      `rotateGroupKeyResource` (new key+version, forward secrecy on leave). Offline-safe (read pod →
      unwrap). 4 tests. Pure — the control-agent drives the pod I/O + roster.
- [x] **Coordinate with `pod-client/sharing` + control-agent** — DONE 2026-06-10.
      `sealing/controlAgent.js` (`createControlAgent`): `addMember` grants ACL (`sharing.grant`) + O(1)
      key re-wrap (or bootstraps the first key); `removeMember` revokes ACL + rotates the key (forward
      secrecy). Enforces ≥1-admin (force = pod-owner break-glass). Pure orchestration — pod I/O injected
      (`sharing` + a `keyStore` {read,write}). 8 tests; pod-client suite 233 green. Remaining wiring:
      point `keyStore` at a real pod resource (SealedPodClient) + drive it from the circle's join/leave
      (the household-circle "Membership → pod access" item below).
- [x] **Sealed index** — DONE 2026-06-10. `sealing/sealedIndex.js` (PORTABLE — runs client-side for P2):
      `queryIndex` (type/tag/text, newest-first) + `decodePseudonym` (id→meaning) + `semanticQuery`
      (cosine over caller-supplied embeddings = RAG) + `shardKeyFor` (FNV-1a). Stored sealed (serialize
      → seal → one blob); round-trips through `sealWithGroupKey`. 9 tests. Remaining for RAG: the
      embedding MODEL (caller supplies vectors today) — slots into the token-gate/RAG circle item.
- [ ] **In-enclave hooks** (P1) + **encrypted-backup** (whole-blob overlay) — later tiers.

### Storage-security postures (menukaart) — per-circle policy
- [x] Documented — `docs/STORAGE-SECURITY-MENUKAART.md` (P0/P1/P2/P3 + backups; posture + granularity
      axes; decision heuristic; search-per-posture).
- [x] **Wire posture as a per-circle config** — DONE 2026-06-10 (`feat/circle-storage-posture`). New
      `circlePolicy.storagePosture` axis `[p0,p1,p2,p3]`, default `p0` (sealing OFF unless chosen);
      settable in circle settings (`ENUM_AXES` + en/nl labels) + carried by kring templates (so a
      household template sets `p2`). Resolver `@canopy/pod-client` `resolveCircleStorage({posture,
      groupKey,recipients,privateKey})` → SealedPodClient strategy (p2 group / p3 recipient) or null
      (p0/p1 plaintext) + `circleStorageClient(podClient, …)` (seal-or-plain). Fail-safe (null when keys
      missing). 7 tests; v2 1211 + pod-client 248 green; web build ✓. Remaining: the household app sets
      `p2` on its circles + the content path calls `circleStorageClient` (the real-pod content item).

### Household circle build (the journey)
- [ ] **Pod ↔ circle binding** — a circle whose shared store is a household pod (members write via
      the circle). Reuse `HouseholdPod` + `pod-routing` `'centralised'`.
- [~] **Membership → pod access** — the SUBSTRATE is DONE: `createControlAgent` (ACL grant/revoke +
      group-key rotation on join/leave, ≥1-admin + break-glass) + `createPodKeyStore` (key resource on
      the pod) + `readGroupKey`, proven by `podBinding.integration.test.js` (full loop: join → key on
      pod → unwrap → sealed content → leave rotates). Roster pubkey source also built:
      `createMemberSealingIdentity` (vault-held X25519 keypair → `rosterEntry({webId, publicKey, role})`).
      App wiring DONE 2026-06-10 (`feat/household-membership-wiring`): decision = **membership-redemption
      item** carries `source.sealingPublicKey`; stoop's `redeemMembershipCode` / `verifyMembershipCodeForPeer`
      → `controlAgent.addMember`, `leaveGroup` → `removeMember` (optional `controlAgent` forwarded through
      `createNeighborhoodAgent`; gated + best-effort, non-breaking). 7 tests; stoop suite 688 green.
      **Remaining (deployment/composition):** (1) the joiner's client passes `sealingPublicKey` when
      redeeming (from `createMemberSealingIdentity`); (2) compose a REAL control-agent (pod `keyStore` via
      SealedPodClient + `sharing` + the admin's controller key) and pass it to `createNeighborhoodAgent` on
      the admin instance; (3) the circle's content reads/writes via a `SealedPodClient` under the group key.
- [ ] **Sender-writes to the REAL shared pod** (today stoop writes pseudo-pod) + **offline catch-up by
      polling the pod** (swap `getMessagesSince` local read → a pod read).
- [ ] **Text dual-write** (peer + pod; folio's file→pod→link is the file-side template).
- [ ] **Bot as an agent MEMBER** of the circle (mDNS/loopback, relay/NKN, or Telegram bridge).
- [~] **NL→slash interpreter + `@tag` router** (the shared core with the feedback v2 rewire) — the
      circle's slash catalog is the tool list; `selectLlmClient(policy, providers)` picks the route.
      **Core built** (2026-06-10): `canopy-chat/src/v2/circleDispatch.js` (slash / llm / kring router +
      `addressesBot`) + `interpretCommand.js` (`buildToolDescriptors` + `interpretToCommand` → `{opId,args}`).
      **C (web) DONE + LIVE-PROVEN** (2026-06-10): `circleTurn.js` wired at `main.js`'s unknown-seam +
      `circleLlmProviders.js` (host seam, `VITE_CIRCLE_LLM_BASEURL`). `scripts/circle-bot-smoke.mjs`
      against real `qwen2.5:7b-instruct` dispatched addTask/markComplete/listOpen from EN **and Dutch**
      free text; bystander/un-addressed turns correctly fell through. 33 unit tests.
      **B (mobile) CODE-COMPLETE** (2026-06-10): `createCircleDispatch` wired into `CircleDetail`'s kring
      composer in `CircleLauncherScreen.js` (slash → dispatch via `bundle.catalog`+`runDispatch`,
      scoped to the circle; addressed free text → interpret → dispatch; else → normal kring post). Bot
      replies render as kring bubbles (`circle.bot.*` locales en+nl). LLM via `@canopy/llm-client`
      (metro `extraNodeModules` + subpath alias added; `EXPO_PUBLIC_CIRCLE_LLM_BASEURL`). Verified:
      esbuild parse + the shared modules' 1189 v2 tests. **NOT yet bundle/device-verified** — the
      `expo` package is missing from mobile `node_modules` so metro/expo can't run **in this checkout**.
      Root cause is NOT a single dep spec: there is **no `pnpm-workspace.yaml`** anywhere, so `pnpm
      install` can't resolve the apps' `workspace:*` deps at all (and `.pnpm` store is empty → the 698
      modules are an npm-style/partial install). The user's own environment builds + runs the app, so
      this is a checkout-provisioning gap, not a code defect. (A stray `@canopy/llm-client: workspace:*`
      I had added to mobile package.json — which WOULD break a healthy install — was removed; the bundler
      resolves llm-client via the metro `extraNodeModules` alias instead.)
      **Mobile clarification turn DONE (code)** 2026-06-10: reuses the kring bubble's existing action-chip
      UI (whose onPress was a `console.info` stub) — candidate buttons now render from `payload.buttons`
      and tap → `clarifyingDispatch.pick` → re-run. Candidate source = the circle's own `items` (scoped).
      `circle.clarify.*` locales en+nl. Parse-verified + the shared clarifyingDispatch/clarifyTargets 30
      tests. Web clarification buttons confirmed functional (domAdapter list-item buttons → onButtonTap →
      circlePick). Remaining: device run (metro bundle once the checkout install is sorted); per-circle
      policy-store hookup; richer command-reply rendering in the kring (lists/cards, not just one-line text).
- [x] **Circle-scoped dispatch + clarification** (NEW, 2026-06-10 → DONE web + live-proven) —
      `clarifyTargets.js` (ready / clarify / unresolved for id-like `pickerSource` params; exact-id +
      circle-scoped label lookup) + `clarifyingDispatch.js` (per-scope pending question; pick re-runs).
      Wired in `main.js`: ambiguous → list of candidate buttons (`circlePick:<id>` → onButtonTap re-runs
      bound to that id), not-found → `circle.clarify.notFound`. Locales en+nl. 13 tests; smoke proved
      "mark the dishes" → ASK[wash|dry] → pick → dispatch on real qwen2.5. Mobile (B) inherits the same
      core. Original note retained below:
      The interpreted command must be
      **confined to the active circle's task/list space**: the same label (`/done afval wegbrengen`) can
      exist in multiple circles, so resolution happens **within the circle's store, not globally**. On web
      this falls out of thread-scoped dispatch (`dispatchAndRender(route, thread)` resolves against the
      circle-thread's cached listing); the mobile rewire must pass the same circle scope. **Screens are
      filtered selections of a circle**, so ambiguity can survive even inside one circle (which screen's
      item?) → when the target is **ambiguous or missing**, the local bot must **ask for clarification**
      rather than guess (the existing `needsForm` form-gate is the first rung; a bot-asks-back turn is the
      richer form). Design + implement after C/B land.
- [x] **Per-circle LLM route config** (starter sets local / proxy / cloud + endpoint) — DONE 2026-06-10
      (`feat/circle-bot-polish`). `circleLlmRoutes.js`: `CIRCLE_LLM_ROUTE_PRESETS` (off / local-ollama /
      confidential-proxy / openai-compatible) + `resolveRoutePreset(name, {baseUrl, model})` +
      `buildProvidersFromRoutes` → the `{local, cloud}` map; `buildCircleLlmProviders` extended with a
      cloud route (same OpenAI-compatible client). 9 tests.
- [x] **Polish (2026-06-10, `feat/circle-bot-polish`):** (a) the token gate's RAG `g.context` is now woven
      into the interpret system prompt (`interpretToCommand` `context` param — strings/entries/{entry,score};
      circleTurn + circleDispatch pass it). (b) **user-LLM-default settings UI** — `web/v2/userLlmSettings.js`
      (`renderUserLlmSettings` + `mountUserLlmSettings` over the store; mode radios off/local/cloud, en+nl).
      v2 suite 1235 green; web build ✓.
- [~] **Token gate** (rules → local embedding → LLM) + **RAG** — core DONE 2026-06-10
      (`feat/circle-token-gate`). `canopy-chat/src/v2/tokenGate.js` (`createTokenGate`): ordered rules
      run LOCALLY before the (possibly remote) LLM — a rule ROUTES a command directly (no LLM) or SKIPS
      the LLM; else `via:'llm'` with RAG context from an injected `retrieve` (e.g. `sealedIndex.semanticQuery`,
      capped at `maxContext`). Wired as an OPTIONAL `gate` into `circleTurn` + `circleDispatch` (absent →
      identical behaviour; present → saves the interpret call on rule/skip). 8 + integration tests; v2
      suite 1223 green; web build ✓. Remaining: the host supplies the rule set + the embedding-backed
      `retrieve` (the embedding MODEL — the sealed index takes caller vectors today); feed `g.context`
      into the interpret prompt; in-enclave RAG for the hosted tier.
- [ ] **Interfaces (web-first):** ship ONE end-to-end (Telegram or mobile) on the local route, then add
      the proxy route, then the others.
