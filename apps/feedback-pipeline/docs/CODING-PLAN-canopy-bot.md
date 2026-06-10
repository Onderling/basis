# Coding plan — feedback bot as a canopy contact

The file-level build, grounded in a reuse inventory (core / secure-agent / household / canopy-chat /
feedback-pipeline, swept 2026-06-09). Companion to the strategy doc
`PLAN-canopy-bot-and-confidential-transport.md` — that one is *why/phases*; this is *what code, reuse
vs build, in what order*. **Web first, then mobile** (`[[feedback-web-first-then-mobile]]`).

## Headline: the channel layer is already built

feedback-pipeline's entire participant journey exists and is tested. **Do not rebuild:**

| Already DONE | File |
|---|---|
| Adapter contract + both adapters (pre-send / post-receipt) | `src/channel/adapter.js`, `canopy-chat-adapter.js`, `telegram-adapter.js` |
| Bot multiplexers (`CanopyChatBot`, `TelegramFeedbackBot`) | `src/channel/canopy-chat-bot.js`, `telegram-bot.js` |
| Control grammar + NL intent | `src/channel/actions.js` (`parseControl`/`runAction`), `intent.js` (`classifyIntent`) |
| Reply render (incl. **buttons/quick-replies**) + sealed notify + locales | `src/channel/render.js`, `notify.js`, `src/strings/{en,nl}.js` |
| Journey: floor → review (Task-1) → **signed** consent write → withdraw | `src/channel/dispatcher.js` |
| Pod backends + signing + ACP provisioning + activation | `src/pod/{central-pod,css-central-pod,pseudo-central-pod,byo-central-pod,signing,acp}.js`, `src/activation/` |
| Tests + smokes | `test/{canopy-chat,dispatcher-signing,channel,telegram-channel}.test.js`, `scripts/{canopy-chat-smoke,tg-bot-smoke}.js` |

`CanopyChatBot` is production-ready **given a real bridge** and an `identityFor`. `scripts/canopy-chat-smoke.js`
already drives the full journey (message → review → consent → **signed** pod write) over `@canopy/chat-agent`'s
`InMemoryBridge`. **The one missing seam is a real bridge.** Everything below builds out from that.

## Hard invariant — participant-pod-first (BYO)

**No contribution reaches the central/aggregation side without first being parked on a pod the participant
controls** — either their **common private pod** (reused across projects, true BYO) or a **project-related
private pod** (provisioned per participant at activation). The bot writes raw+cleaned to that pod; the
aggregation side only ever **reads** the sealed+signed cleaned record from it (`ByoCentralPod`, already built —
"the central side never holds a copy"). So the central never holds raw, and never holds anything the participant
didn't park first.

This is **structural, not policy**: the dispatcher's write target becomes a *participant-pod-backed writer*, and
`ByoCentralPod` reads those participant pods as sources. It applies to **both** tiers — local/signed → the
participant's common pod; external/unsigned → a project-related pod. (BYO read = `src/pod/byo-central-pod.js`,
done; the write side is the new piece, in M1.)

## Layering / rule of two (constraints on this plan)

- The two new bridges **implement `@canopy/chat-agent`'s `MessagingBridge` contract** (`onMessage`/`sendReply`/
  `start`/`stop`) — reuse it, do not redefine (`architectural-layering.md:95`).
- They **live in `apps/feedback-pipeline/src/channel/`**, not a substrate. One consumer = no extraction; lift to
  `@canopy/*` only when a second app needs an InternalBus/peer chat bridge (`policies.md:8`).
- **No InMemory-only fakes as product** — the new bridges are the production partners; `InMemoryBridge` stays the
  test double.
- Keep `@canopy/*` imports **confined to the bridge + bot-entry modules** so the core pipeline stays portable/
  standalone (`[[node-portability-convention]]`); these are feedback-pipeline's first runtime `@canopy/*` deps
  (`@canopy/chat-agent`, `@canopy/core`, `@canopy/secure-agent`) — list them in the README with a one-line reason.

## Reuse vs build (the inventory, condensed)

| Need | Reuse (file:line) | Build |
|---|---|---|
| Bridge contract + types | `@canopy/chat-agent` `MessagingBridge`/`types.js` (IncomingMessage, SendReplyArgs) | — |
| InternalBus + co-host topology | `@canopy/core` `InternalBus`/`Agent`/`InternalTransport`; pattern in `apps/canopy-chat/src/core/agent/realAgent.js:74–153` (shared `bus`, `invoke`, `hello`) | `InternalBusBridge` (agent↔bridge adapter — none exists) |
| Peer transport | `secure-agent` `sa.peer.sendTo`/`connect({onPeerMessage})` (`createSecureAgent.js:1009–1037`); inbound router `apps/canopy-chat/src/core/handlers/peerRouter.js:42` | `PeerBridge` (sa.peer↔bridge adapter) |
| Bot entry skeleton | household `apps/household/scripts/tg-freetext.js` (bridge→bot→start, SIGINT drain `:260–277`) | `scripts/canopy-bot.js` (local + external modes) |
| Bot identity / vault namespacing | household `apps/household/src/identity/BotIdentity.js:34–161`; `@canopy/core` `AgentIdentity`; feedback `src/pod/signing.js:26` `generateParticipantIdentity` | thin wiring |
| Bot audit pod (optional) | household `apps/household/src/pods/BotPod.js:76–321`, `FsMockPod` (`tg-pod-smoke.js:89–183`) | — |
| Participant signing identity | `AgentIdentity.restore(vault)` + canopy-chat vault (`realAgent.js:53`) | `identityFor` that reads the participant's vault key (app-side) |
| DM/contact UX (web) | `ensureDmThread` (`web/main.js:1149`), `chatMessage` handler (`handlers/chatMessage.js:39`), `startDm` button (`mockManifests.js:663`), QR (`domAdapter.js:464`), button render (`domAdapter.js:204,295`) | synthetic bot contact entry; project-invite URI/QR auto-activation; pass `buttons` through feedback emit |
| Feedback surface (web) | `apps/canopy-chat/src/feedback/feedbackSurface.js`, `feedbackPod.js`; `/feedback <code>` (`web/main.js:2117`) | remove its `setLlmRoute` (route ownership → bot); supply bus+identity |
| LLM route | feedback `src/ollama.js` (`applyLlmRoute`/`chat`) | Phase-0 guardrail + bot owns route |
| Mobile shell | `apps/canopy-chat-mobile/src/core/agentBundle.js:90` (same InternalBus), `@canopy/react-native` `VaultAsyncStorage`/`KeychainVault`, `@canopy/oidc-session-rn` | mobile feedback screen; NKN-RN only for the *external* bot (#223) |

## Milestones (web first)

### M0 — route ownership + guardrail *(small; Phase 0 of the strategy plan)*
- `src/ollama.js` `applyLlmRoute`: refuse a non-loopback `privatemode` URL without attestation config; annotate
  the two call sites (clean vs aggregation).
- The bot resolves its own route from project config at startup; **remove** `feedbackSurface.js`→`setLlmRoute`.
- **Verify:** vitest on `applyLlmRoute` (throws on remote privatemode w/o attestation; passes loopback).

### M1 — `InternalBusBridge` + local signed bot (web) *(the core unlock)*
1. `src/channel/internal-bus-bridge.js` — implements `MessagingBridge`. Co-host the bot as an `Agent` on the
   participant's shared `InternalBus`: `onMessage(h)` ← the bot agent's registered handler (the participant's
   chat agent `invoke`s it); `sendReply({chatId,text,buttons})` → reply on the bus. **No network.** Model the
   shape on `InMemoryBridge`; wire via the `realAgent.js` co-host pattern.
2. `scripts/canopy-bot.js` (local mode) — reuse household's entry skeleton + SIGINT drain. `new CanopyChatBot({
   bridge: internalBusBridge, pod, config, identityFor })`.
3. `identityFor` from the vault — fetch the participant's signing keypair (`AgentIdentity` over canopy-chat's
   vault); pass to `CanopyChatBot` so consent is **signed**.
4. canopy-chat web mount — in `realAgent.js`, co-host the bot agent on the existing `bus`; `feedbackSurface.js`
   supplies bus + identity (not the route).
5. **Participant-pod-first write (BYO invariant).** Inject a participant-pod-backed writer as the dispatcher's
   `pod`: park `{raw, cleaned, meta}` on the participant's own pod (reuse `@canopy/pod-client` + the
   `PLAN-tomorrow-tg-pod.md` `/messages/{raw,cleaned,meta}` layout + household `BotPod`/`FsMockPod` pattern;
   `feedbackPod.js` already builds the CSS-backed participant pod). Aggregation runs via the existing
   `ByoCentralPod` reading that pod as a source — the central never receives raw. Pod flavor (common vs
   project-provisioned) is a config choice.
6. **Verify:** vitest — `InternalBusBridge` over a *real* shared `InternalBus` (two co-hosted agents) runs the
   `canopy-chat-smoke` journey and asserts the contribution is **signed**, **parked on the participant pod**
   (raw stays there; central reads via `ByoCentralPod`), and never hits a transport. Then a user-run web smoke
   (add bot → message → review → consent).

### M2 — participant-side contact UX (web)
- Reuse `ensureDmThread` so the bot is a DM like any peer; add a synthetic **bot contact** entry (so it shows in
  `/contacts`) and a **project-invite URI/QR** that auto-runs `/feedback <code>` on load (model on the OIDC
  callback at `web/main.js:897`).
- Pass `buttons` through `feedbackSurface` emit and wire `onButtonTap` (the DOM side already renders buttons —
  `domAdapter.js:204,295`).
- **Autonomous; visual eyeball deferred.** The logic (synthetic contact, invite-URI parse + auto-activation,
  button pass-through) is headless `vitest`-testable — the DOM render/QR layer already exists and is wired. The
  only visual confirmation (contact appears, QR scans, buttons look right) **batches into one manual web
  checkpoint after M5**.
- ✅ **Done.** The bot contact is a **distinct `agent` item type** (`feedbackContactItem`, `kind:'agent'` + icon),
  NOT a fake stoop peer — prepended to `/contacts` in the chat shell, rendered visually distinct (generic
  `icon`/`kind` support added to `renderer.js`/`domAdapter.js`), and its `openFeedback` action enters feedback
  mode rather than a peer DM. Invite/QR auto-activation + button pass-through already shipped in the bundle.
  Visual eyeball still pending the post-M5 manual checkpoint.

### M3 — complete the participant journey *(folds item 1)*
Make the journey end-to-end so a mockup scenario is whole, not stubbed.
- **Menu actions** `download` / `claim` / `pause` / `delete` — `dispatcher.command()` returns `status:'todo'`
  today (`dispatcher.js:123`). Wire them to the participant's own-pod ops (export own contributions; claim a
  project-provisioned pod to the participant's identity; pause/delete own data). Reuse the pod `withdraw`/`list`
  + own-pod layout from M1.5.
- **Feedback-to-participant loop** (menukaart block H) — wire the curator **release → `createPodNotifier`
  (`notify.js`) → participant inbox**. Ship the in-scope spectrum: receipt (done) + "what was done" + optional
  share-the-aggregate-picture — **aggregate-only, opt-in, threshold intact** (5.4 §2b). The notify substrate
  exists; this is wiring it to the release path.
- **Verify:** vitest — each menu action operates on the participant pod; a release fires a **sealed** notify the
  participant can open.

### M4 — safety floors + crisis protocol *(folds item 2)*
Make a scenario production-*safe*, not just functional.
- **Per-category deterministic floors** in `src/categories.js` (harassment, discrimination, abuse, retaliation,
  integrity, medical-emergency, child-safety), wired into the triage label override with the **crisis-reservation
  rule**; + sensitive-content extension + scenario PII floors (case/dossier/student numbers) in `redact.js`.
  Order + rationale: `CATEGORIES-AND-LAYERS.md` §D, `pipeline-order.md`.
- **Crisis response protocol** — close the open question (`parameters.md`): on a confirmed crisis, show passive
  support (113) + route the signal track to the project's configured destination (`signal.destinations`); **no
  automated outreach** in the mockup.
- **Verify:** the per-scenario automated tests (`fixtures/scenario-tests.js` + `run-dataset.js` + auditor agent)
  pass **G1–G8** on the mockup scenario; `test/crisis-gate.test.js` stays green.

### M5 — `PeerBridge` + external unsigned bot (web/server)
- `src/channel/peer-bridge.js` over `sa.peer` (`onPeerMessage`→handler, `sendTo`←`sendReply`); transport via
  `transportMode`, not named in the bridge.
- `scripts/canopy-bot.js` (external mode) — standalone `createSecureAgent` for the bot's WebID (household
  `BotIdentity` vault pattern), `identityFor` omitted ⇒ unsigned, project-provisioned pod.
- **Verify:** vitest over a `FakePeerTransport`; assert unsigned + graceful `verification-required` under
  `privacy.verify`.

### M6 — mobile *(after web ships)*
- **Local InternalBus bot first — needs NO network transport, so it does NOT wait on NKN-RN (#223).** Reuse
  `agentBundle.js`'s shared `InternalBus`; build a mobile feedback screen around `ChannelDispatcher`/`CanopyChatBot`;
  vault = `VaultAsyncStorage`/`KeychainVault`; pod auth = `OidcSessionRN`.
- **External peer bot is TRANSPORT-AGNOSTIC** (✅ done, M5). `PeerBridge`/`startExternalCanopyBot` take any
  injected secure-agent `peer`, so the bot runs over **NKN, relay, WebRTC, or `transportMode:'both'`
  interchangeably** — the bridge never names a transport (`peer-bridge.test.js` proves the journey over an
  injected peer). No NKN-RN dependency; nothing transport-specific to build.
- 🟡 **Local bot + `/contacts` row wired (needs device verification).** Mount logic is a shared, headless-tested
  helper `src/feedback/feedbackMount.js` (`feedbackMount.test.js`, 7/7) used by web + mobile (rule of two);
  `ChatScreen.js` wires it into `submitInput` (RN bubble sinks; `EXPO_PUBLIC_FEEDBACK_LLM_BASEURL` for the
  device's LLM route) **and** the mobile `/contacts` now prepends the distinct **`agent` contact** (inject in
  `dispatchAndAppend`) whose `openFeedback` tap enters feedback mode (button-tap handler). Mobile vitest 264/264
  + `node --check` pass. **Device checkpoint owed (Detox/manual):** the RN screen behaviour (enter `/feedback`,
  free-text round-trip, the agent contact row appearing + opening) — can't be verified headlessly.
  **Build finding (only the device build catches it):** the mobile bot wasn't RN-bundleable —
  `metro.config.js` needed `apps/feedback-pipeline` in `watchFolders` + an `eld/<size>` subpath
  resolver (`lang.js` imports `eld/medium`; Metro disables package-exports). Fixed; bundle = 6330
  modules. Also fixed a real cross-platform bug: `renderListItems` dropped an item's own `buttons`
  (the agent contact's `openFeedback`), so the fp-bot row would have shown stoop's `[DM]` — now an
  item's own buttons take precedence (web M2 + mobile M6).
  **⚠️ REACHABILITY GAP (device run, 2026-06-09):** the wiring went into `ChatScreen.js`, which the
  v2 redesign (SP-13.1) made an **invisible background peer-router** (`App.js:82`; CircleLauncher has
  "no '← chat' button — no chat shell to navigate to"). The live UX is the circle launcher + circle
  conversation screens (`CircleStreamScreen`/`CircleScreenView`), which post to the kring and **don't
  run slash dispatch** — so the bot is NOT reachable on mobile as wired (`/contacts` posts as text).
  The logic + bundling are fine; the integration point is orphaned. **Real follow-up:** wire feedback
  into the v2 circle conversation surface — needs a UX call (how feedback fits the kring) + that
  screen's input handling. The Detox `gotoChat` helper is also stale (targets the removed chat shell).

### M7 — confidential transport, Option B (enclave gateway) *(item 4)*
Unlocks a **heavy remote** model for the per-participant clean with the host blind. **Not a blocker** — M0 forces
the clean step onto a safe route, so the bot ships leak-free; this is the maximal-privacy upgrade. Build = the
gateway enclave image (Privatemode proxy in a CVM) + client-side attestation/key-pinning + route the clean step
at it. `CONFIDENTIAL-LLM-TRANSPORT.md` + strategy plan Phase 2.
- **Web + mobile (split).** The gateway is **one platform-neutral server build**. The **client side ships twice**:
  a browser impl (web) and an **RN impl** (mobile) — RN **quote-verification** is the harder, uncertain piece
  (library vs. native module). Mobile also has a **local on-device model** fallback the browser lacks, so M7 is
  *more load-bearing for web*; do the web client first, RN client as a follow-on.

### M8 — enclave aggregation (Phase 2 placement) *(item 4)*
`aggregation.location:'enclave'` — key custody moves into an attested CVM; `tee/aggregate.js#runSealedAggregation`
is already shaped for it. **Shares attestation plumbing with M7 — sequence together.** Strategy plan Phase 3.
- 🟡 **Verification seam built (hardware-gated remainder).** `src/tee/attestation.js` adds the caller-side gate
  the boundary always called for — `verifyAttestation` (verify + pin measurement), `assertEnclaveAttested`
  (gate `location:'enclave'` on a verified quote, closing placement.js's self-declared-role gap), and
  `verifyGatewayAttestation` (M7). Config: `aggregation.attestation` / `llm.attestation` (`{expectedMeasurement}`).
  `test/attestation.test.js` 4/4 (incl. end-to-end through `runSealedAggregation`); suite 246/246. **Hardware
  checkpoint:** swap `localAttestation()` + the quote fetch for a real SEV-SNP/Contrast CVM (the gates stay).

### M9 — client-side agent runtime *(item 4; heavyweight, separable, own track)*
The *other half* of on-device trust: key custody + egress firewall so a malicious app can't exfiltrate the
plaintext the dispatcher holds (`AGENT-RUNTIME.md`). **Large, separable effort (~months)** — runs on its **own
track** and does **not** gate the others. Listed so it isn't lost.
- **Web/desktop vs mobile differ in mechanism (`AGENT-RUNTIME.md` §2).** Web path = a **desktop shell** (Tauri)
  wrapping the browser pod-app. **Mobile** doesn't run a runtime-browser: the native Expo app is already the
  controlled surface (`KeychainVault` + app sandbox + store review give the equivalent, imperfectly); a
  Tauri-mobile build is only a later secondary. Same *goal*, different *mechanism* per platform.

### M10 — full mockup project + end-to-end test  ← **the testable deliverable, done LAST**
The single capstone, assembled and run **at the end** — one runnable project that exercises the whole system, not
a mid-sequence checkpoint.
- **Assemble a mockup `ProjectConfig`** (reuse `exampleProjectConfig` gemeente-X): `privacy.seal:true`,
  `privacy.verify:true`, **BYO participant pod**, `k:4`; route local/loopback (or the M7 enclave gateway if CC
  hardware is available).
- **Wire + run end-to-end** for **N simulated participants**: activation (code → pseudonym → provisioned pod) →
  **canopy bot as a contact** (local signed; + external/mobile variants if exercising those) → contribute →
  review → consent (**parked on participant pod**, signed) → `ByoCentralPod` aggregation (k-anon) → curator
  release → notify back.
- **`scripts/mockup-project-smoke.js`** asserts: contributions signed + parked (central holds no raw), k-threshold
  enforced, a theme surfaces, below-threshold quarantined, release notifies.
- **Manual checkpoint:** a person runs the full journey on the mockup project (web; mobile if M6 done).
- ✅ **Done.** `test/mockup-project.test.js` (in the suite, 242/242) + `scripts/mockup-project-smoke.js`
  (`npm run mockup-smoke`, narrated). 5 participants drive the co-hosted bot → consent parks signed+sealed on
  each own pod (BYO, no raw central) → `ByoCentralPod` k-anon: "waiting times (4 users)" surfaces, "food (1)"
  quarantined → curator release → 4 participants notified. `ByoCentralPod` gained a release registry
  (`markIncluded`/`getStatus`) so curator release+notify works on BYO without holding raw.

### M11 — surface `/feedback` in the command menu / manifest *(discoverability; small)*
Today a participant must know to type `/feedback <code>`. Add it to the merged command menu / manifest so it
shows in `/help` + autosuggest. Web first, then mobile. Small.

### M12 — review buttons as click-to-inject chips
The review step currently rides the NL path. Render the review actions as interactive chips that inject the
slash on tap. The circle bot's kring candidate-chip pattern (`payload.buttons` → tap handler → re-dispatch) is
the reusable template (web `domAdapter` list-item buttons → `onButtonTap`; mobile kring bubble chips).

### M13 — curator UI surface + report publish + signal routing
A curator-facing surface to review the aggregated themes and trigger `release`; wire `release` to **publish /
persist the report artifact** (to the central/curator pod) and **route the signals** (crisis / threshold / theme)
to their configured destinations. `ByoCentralPod`'s release registry (`markIncluded`/`getStatus`) already
backs the no-raw release; this is the UI + the publish/routing wiring.

### M14 — deployment readiness *(config, not code)*
Edgeless/Privatemode **account + key**; set `FP_LLM_BASEURL`/`FP_LLM_APIKEY`, `FEEDBACK_ACTIVATION_URL`; **pin
images by `@sha256`**; fill real **restic target creds**. Gating for a real single-scenario launch.

### M15 — crisis-response protocol *(LAST phase; blocks launch)*
M4 built the **detection** floors; the **response** is undesigned — who is notified, on what consent, how fast,
duty-to-act vs. anonymity. A **design call first** (see `SECURITY-MODEL.md` open questions), then build the
routing + escalation. Deliberately the final phase: every other phase ships without it.

## Sequencing
Build the milestones **M0 → M1 → M2 → M3 → M4 → M5 (external) → M6 (mobile) → M7 + M8 (TEE, together)**, with
**M9 (agent runtime) on its own non-gating track**. Then **M10 — the full testable mockup — is assembled and run
at the END**, exercising the whole system in one runnable project. **M11–M15 (2026-06-10) extend the plan with the
feedback-app completion work** — M11 (`/feedback` menu) → M12 (review chips) → M13 (curator UI + publish/signals) →
M14 (deployment config) → **M15 (crisis-response, LAST, design-gated)**. Each build milestone has its own vitest
`Verify`; **M10 is the single end-to-end integration deliverable, not a mid-sequence checkpoint.** Web first
throughout; mobile at M6. M0 is a day; M1 is load-bearing but small (the channel layer already exists).

> **Audit pod (deferred, opt-in).** Household's `BotPod` LLM-audit trail is intentionally *out* of the milestones:
> the journey doesn't need it, and for feedback an LLM-call log over raw pre-consent text is a privacy hazard. If
> ever added, it must be **metadata-only** (ts/model/token counts, never content) and on-device.

## Deferred ledger — what the milestones do NOT include

M0–M9 = the build; **M10 = the full testable mockup, run at the end.** Everything below is still **out of scope**,
kept here so nothing hides — per-client breadth and downstream/governance, not needed for a testable scenario.

**Still parked / deferred (bot & infra):**
- **Confidential transport Option A** (on-phone proxy, 🅿️) — research after M7.
- **`ollama.js` → `@canopy/llm-client` graduation** (🅿️).
- **Group-chat bot participation** (⬜) — board 4B undesigned; revisit on demand.
- `InMemoryBridge` is not a public `@canopy/chat-agent` export (test wiring imports it directly — fold into M1).

**Breadth of the menukaart (item 3 — per-client, all ⬜ in `MENUKAART.md`):** voice intake (STT), other channels
(WhatsApp/Signal/phone/web-chat), bot-posture/tone/memory presets, cooling-off period, retroactive withdraw,
aggregation cuts, targeted client→participant, participant editable portal.

**Downstream & governance (item 5):** Klai cooperation models (2b/2a/1), Lingua/LiteLLM borrows, real-data
evaluation phase, anonymity-preserving access verification (open question).
