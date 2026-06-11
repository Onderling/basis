# canopy-chat

> **Direction (decided 2026-06-11):** the separate apps (stoop, tasks-v0, feedback, …) are to
> **dissolve INTO canopy-chat** — their `manifest.js` declarations stay (the source of truth every
> projector reads), but the app names become **navigation/reference labels** for shared functionality
> inside this one chat surface, not separate apps/builds/shells. New work = add manifests + projectors
> here, not new app silos. See the root README's *Direction* note.

> **Layer: app.** Command-first unified chat shell that consumes
> other canopy apps' manifests.  Static web deployable; mesh agent
> runs browser-side.

| | |
|---|---|
| **Status** | v0.1.0-dev (in progress — see `/Project Files/canopy-chat/coding-plan.md`) |
| **Companion docs** | [`/DESIGN-canopy-chat.md`](../../DESIGN-canopy-chat.md), [`/DESIGN-canopy-chat-journeys.md`](../../DESIGN-canopy-chat-journeys.md) |
| **Tier policy** | See [`/DESIGN-tier-policy.md`](../../DESIGN-tier-policy.md). canopy-chat pages are T1 (substrate-rendered by the chat shell itself) by definition. |

---

## What this app does

A single chat UI users open in a browser. Slash commands dispatch
to whichever canopy app owns the op (household, tasks-v0, stoop,
folio's pod-doable subset). User can spawn multiple threads, each
with its own event-filter + permission config.

Today the chat shell is **command-first** — slash grammar is the
deterministic dispatcher. A future v0.8 LLM layer translates
natural language into the same dispatch primitives.

## What this app is NOT

- Not an app substrate (does not own data; composes other apps'
  manifests at runtime).
- Not a replacement for apps' own web UIs — chat sits alongside
  the side-panel surfaces per [B.1 nav protocol](../../DESIGN-canopy-chat-journeys.md).
- Not a server — ships as a static web bundle.  Mesh agent runs
  browser-side via relay + NKN + WebRTC transports (per OQ-1.A in
  the coding plan).

## Substrates this app composes

Decisions documented after the v0.3.4 substrate-reuse audit (see
`Project Files/canopy-chat/coding-plan.md` § Substrate-reuse gate).

### Composed today

| Substrate | Used for |
|---|---|
| `@canopy/app-manifest` | App-manifest schema + `renderChat`/`renderWeb` projectors + `validateManifest` + paramsToJsonSchema.  Source of truth for Q28 reply-shape lookups. |
| `@canopy/manifest-host` | Runtime composition of N app-manifests.  `src/manifestMerge.js` is now a thin canopy-chat-shaped projection over `createManifestHost` (collision detection + Q28 reply-shape lookup all come from the substrate). |
| `@canopy/core` | `Agent`, `AgentIdentity`, `InternalBus`, `InternalTransport`, `DataPart` — wires the in-process two-agent topology in `src/web/realAgent.js`.  Browser-bundled per OQ-1.A. |
| `@canopy/vault` | `VaultMemory` for the in-browser AgentIdentity seed.  `VaultLocalStorage` / `VaultIndexedDB` are candidates when pod-sync lands in v0.6. |
| `@canopy/chat-nav` | Sibling substrate (this repo).  Implements the B.1 chat ⇄ side-panel navigation protocol.  Other apps' settings pages consume it; canopy-chat ships it. |

### Intentionally kept separate (with reasons)

| Substrate | Why canopy-chat does NOT compose it (yet) |
|---|---|
| `@canopy/web-adapter` | Adopted by tasks-v0 / household / tasks-mobile for NavModel → DOM section rendering.  canopy-chat's `domAdapter.js` / `domForm.js` are chat-specific (message-stream model, list-with-inline-keyboard, A2 lifecycle, record/mini-page with `[Close]`).  The substrate's `schemaToFormFields` overlaps with our `buildFormSpec`, but the manifest shapes are misaligned (its JSON-Schema vs our `op.params[]`).  **Revisit in v0.4+** when the manifest schema is next touched. |
| `@canopy/notifier` | Outbound scheduled push delivery + retry.  Our `EventRouter` is **inbound** event routing to threads.  Different concern.  When v0.5+ ships background notifications, notifier composes on top of EventRouter. |
| `@canopy/local-store` | `CachingDataSource` is for pod-synced item caches.  Our `IndexedDBStore` persists UI state (thread workspaces) without a pod inner DataSource.  **Pod-sync compose path (v0.6.4 spec, real wiring deferred):** when canopy-chat gains OIDC sign-in (J6, v0.7+) and obtains a pod, `IndexedDBStore` swaps to `CachingDataSource({inner: podDataSource, paths: ['mem://canopy-chat/threads/*']})`.  Threads then sync per-thread to the pod alongside the local cache; offline edits queue via the substrate's write queue + flush on reconnect.  Until OIDC handoff is real, IndexedDB-only is the right shape — pure UI state with no pod dependency. |
| `@canopy/chat-agent` | LLM-mediated chat with `MessagingBridge` + per-chat session manager + tool dispatcher.  canopy-chat is a **command-first** chat shell over manifest dispatch — different product.  May **compose** chat-agent in v0.5+ as an optional LLM-conversation sink alongside the slash path. |
| `@canopy/chat-p2p` | P2P chat envelopes via `agent.transport.sendOneWay`.  **Re-audited 2026-05-23 (v0.5.3):** canopy-chat does NOT compose chat-p2p directly.  Real cross-peer embed delivery rides on each HOSTING app's chat surface (e.g. stoop's `sendChatMessage` extended with an `embed` envelope field — app-side work).  canopy-chat's role: produce the envelope (Q29 + `buildEmbed`) + render it (`embed-card` shape).  The substrate doesn't fit our role; composing it would force canopy-chat to take on itemStore + identity-resolver + members machinery that belongs to apps. |
| `@canopy/agent-ui` | Out-of-process agent ↔ UI via HTTP+SSE.  canopy-chat uses in-process `InternalBus` (simpler; matches the static-web deployment of OQ-1.A).  Revisit if relay-bound agents land. |
| `@canopy/agent-provisioning` | Production-style facade (vault + OIDC + webid + transports).  `realAgent.js`'s manual wiring is intentionally minimal for the in-browser demo; the facade may replace it once OIDC handoff (J6, v0.6) is real. |

## Direct SDK use

`src/web/realAgent.js` imports `Agent`, `AgentIdentity`,
`InternalBus`, `InternalTransport`, `DataPart` from `@canopy/core`
+ `VaultMemory` from `@canopy/vault`.

Justification per `architectural-layering.md`: there is no substrate
that brings up a two-agent InternalBus topology pre-signed-in in the
browser (which is what canopy-chat v0.1's demo needs per OQ-1.A).
`@canopy/agent-provisioning` is the closest facade but it targets
single-agent production bring-up with OIDC + pod; canopy-chat's
"two agents on the same bus" demo isn't a fit until the
provisioning facade gains multi-agent helpers.

## Phase v0.1 sub-slices

Tracking per `/Project Files/canopy-chat/coding-plan.md` § Phase v0.1:

| Sub-slice | Scope | Status |
|---|---|---|
| 1.1 | Workspace scaffold | shipped 2026-05-21 |
| 1.2 | Q28 substrate (`op.surfaces.chat.reply`) | shipped 2026-05-21 |
| 1.3 | Browser-bundled mesh agent (OQ-1.C resolved) | shipped 2026-05-21 |
| 1.4 | Slash parser | shipped 2026-05-21 |
| 1.5 | Manifest merge | shipped 2026-05-21 |
| 1.6 | Router (resolve → dispatch w/ Q27 confirm gate) | shipped 2026-05-21 |
| 1.7 | Dispatch (callSkill wrap + Reply envelope) | shipped 2026-05-21 |
| 1.8 | Renderer (text + list reply shapes) | shipped 2026-05-21 |
| 1.9 | Thread state v0 (single-thread; fuzzy resolve; A2 lifecycle) | shipped 2026-05-21 |
| 1.10 | Web entry (HTML + DOM adapter + mock agent) | shipped 2026-05-21 |
| 1.11 | Localisation scaffold (en + nl, i18next wrapper) | shipped 2026-05-21 |
| 1.12 | Build pipeline (Vite) | shipped 2026-05-21 |

## Phase v0.2 — multi-thread workspace

| Sub-slice | Scope | Status |
|---|---|---|
| 2.1 | Thread schema + ThreadStore | shipped 2026-05-21 |
| 2.2 | Filter DSL | shipped 2026-05-21 |
| 2.3 | Thread management UI (web) | shipped 2026-05-21 |
| 2.4 | Default threads (Main + Inbox) | shipped 2026-05-21 |
| 2.5 | Event router | shipped 2026-05-21 |
| 2.6 | Per-thread state isolation | shipped 2026-05-21 |
| 2.7 | Bulk-op fan-out | shipped 2026-05-21 |
| 2.8 | Thread persistence (IndexedDB + pod-sync stub) | shipped 2026-05-21 |
| 2.9 | RN scaffold (minimal) | shipped 2026-05-21 — see `apps/canopy-chat/rn/README.md` for runnable-state requirements |

## Phase v0.3 — mini-pages + forms

| Sub-slice | Scope | Status |
|---|---|---|
| 3.1 | `record` reply shape (J5 settings panel) | shipped 2026-05-21 |
| 3.2 | `mini-page` reply shape | shipped 2026-05-21 |
| 3.3 | Form generator + DOM | shipped 2026-05-21 |
| 3.4 | Date + webid param refinement | shipped 2026-05-21 |
| 3.5 | A2 record-panel "stays live" | shipped 2026-05-21 |
| 3.6 | Mini-page event-driven refresh | partial — infra via EventRouter; full panel-itemRef tracking deferred to v0.5 embeds |
| 3.7 | `@canopy/chat-nav` substrate | shipped 2026-05-22 |
| 3.8 | B.1 nav protocol | shipped 2026-05-22 (substrate ships; chat-shell adoption follows) |
| **3.x** | **Substrate-reuse audit + manifest-host adoption** | shipped 2026-05-22 (this README + the manifest-host refactor) |

## Phase v0.4 — cross-app surface

| Sub-slice | Scope | Status |
|---|---|---|
| 4.0 | Q31 (`followUps`) + Q32 (`op.runtime`) substrate adds | shipped 2026-05-22 |
| 4.1 | Cross-app surface (4 apps in catalog) + op-prefix-on-collision + Q32 runtime filter | shipped 2026-05-22 |
| 4.2 | Follow-up registry + inline-button UI | shipped 2026-05-22 |
| 4.3 | `resolveContact` skill convention + folio runtime tags | shipped 2026-05-22 |

## Phase v0.5 — embeds (J7)

| Sub-slice | Scope | Status |
|---|---|---|
| 5.0 | Q29 (`surfaces.chat.embed`) substrate + embed envelope + renderer + mock demo | shipped 2026-05-22 |
| 5.1 | Receiver-claim button + sender-claim-on-behalf (`/embed --claim`) | shipped 2026-05-22 |
| 5.2 | tasks-v0 Q29 adoption (manifest declaration + `getTaskSnapshot` skill) | shipped 2026-05-22 |
| 5.3 | Re-audit: chat-p2p NOT composed by canopy-chat; embeds delivered by apps' own chat surfaces | shipped 2026-05-22 |

## Phase v0.7 — brief aggregator + network-events log (v0.7.0+v0.7.1)

| Sub-slice | Scope | Status |
|---|---|---|
| 7.0 | Q30 `surfaces.chat.brief` substrate + `/brief` aggregator | shipped 2026-05-23 (household real; stoop/folio stubs in main.js) |
| 7.1a | `EventLog` substrate (D.1) + 14-day retention | shipped 2026-05-23 |
| 7.1b | `/logs` chat-shell builtin + filter/mute flags | shipped 2026-05-23 |
| 7.1c | Dedicated `/logs` side-panel page UI | pending — chat-inline works today |
| 7.5 | Search/browse via Q33 `searchSkill` (user-requested 2026-05-23) | pending |
| 7.8 | Folio's real `briefSummary` Q30 adoption | pending — declarative-only today |

## Reality-check on phase statuses (added 2026-05-23 after journey audit)

The phase tables above mark `✅ shipped` based on chat-shell
primitives being complete + tests green.  This is technically
correct but **misleading about end-to-end demoability** because
several phases depend on real backing apps (folio / stoop /
tasks-v0) that aren't wired into the browser-bundled real agent.

Honest re-statement:

- **Phase v0.4** primitives ✅ shipped; **real multi-app
  dispatch 🟡 partial** (only household runs as a real agent;
  folio/stoop/tasks-v0 are stubs in `main.js`'s callSkill).
- **Phase v0.5** embeds primitive ✅ shipped; **cross-peer
  delivery 🟡 deferred to apps' chat surfaces** per the v0.5.3
  audit (intentional, not a gap).
- **Phase v0.6** `_sync` rendering ✅ shipped; **real adopters
  (stoop/tasks-v0 populating `_sync` from real sync state)
  🟡 pending** per v0.6.5.
- **Phase v0.7** brief + logs ✅ shipped with mocks; real
  per-app `briefSummary` skills land per-app.

See `/Project Files/canopy-chat/journey-audit-2026-05-23.md` for
the per-journey table + prioritised gap list.

## Phase v0.6 — pod-style hints + reactive refresh

| Sub-slice | Scope | Status |
|---|---|---|
| 6.0 | `_sync` reply-envelope convention + per-style rendering (central / decentralized / pod-less) | shipped 2026-05-23 |
| 6.1 | Per-row `_lastSync` staleness badge on list items | shipped 2026-05-23 |
| 6.2 | External-flow primitive + deep-link callback (J6 framework) | pending — needs real OIDC consumer |
| 6.3 | Reactive panel-stale refresh on matching item-changed events | shipped 2026-05-23 |
| 6.4 | Pod-sync compose-path documentation (real wiring deferred to v0.7+) | shipped 2026-05-23 |
| 6.5 | Adopter — stoop / tasks-v0 populate `_sync` from real sync state | pending (app-side work) |

## Running locally

```bash
pnpm --filter @canopy-app/canopy-chat dev       # http://localhost:5173
pnpm --filter @canopy-app/canopy-chat build     # → dist/ (static-deployable)
pnpm --filter @canopy-app/canopy-chat preview   # preview the prod build
```

The dev server hot-reloads ESM. The mock household agent (v0.1.5
ships the real browser-bundled mesh agent) provides 3 chores you
can list with `/mine` and complete with `/done <name>` or via the
inline `[Mark done]` button.

## Conventions

This app follows:

- [`architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md) — substrate composition before reinvention
- [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md) (this file)
- [`single-agent.md`](../../Project%20Files/conventions/single-agent.md) — one
  `core.Agent` per service-context; per-thread state lives outside the agent
- [`localisation.md`](../../Project%20Files/conventions/localisation.md) —
  every user-facing string translatable from v0.1
- [`pod-independence.md`](../../Project%20Files/conventions/pod-independence.md) —
  v0.1 ships pod-less (local thread persistence in IndexedDB); pod sync is
  opt-in v0.6
- [`plan-tracking.md`](../../Project%20Files/conventions/plan-tracking.md) — the
  coding plan at `/Project Files/canopy-chat/coding-plan.md` includes a
  per-sub-slice **Substrate-reuse gate** (added 2026-05-22) so future phases
  audit existing substrates before writing new modules.
