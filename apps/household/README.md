# @onderling-app/household

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct kernel use is allowed only when justified in this README's `## Direct kernel use` section (per [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).
>
> **Manifest + tier policy.** Household was the **pattern source** for
> the NavModel substrate ([`manifest.js`](./manifest.js)); the other
> apps' manifests follow this one's shape.  Pages follow
> `DESIGN-tier-policy.md`.  Most
> household pages are T2 manifest-bound today (chat surface is the
> primary path); web pages back-fill T1/T2 as they get substrate-
> driven.

Household app — H2.  Telegram-driven, optionally LLM-mediated
household state on a Solid pod.

**Status**: scaffold + Phase 1 in progress.  Not usable yet.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/item-store` (L1b) | Open/closed shopping/errand/repair items with attribution + audit log; consumed via `src/storage/InMemoryStore.js` adapter that exposes the legacy H2 interface. | Item-store is the H2/H4/H5/H8 shared collection primitive; the adapter pattern keeps existing skill handlers stable while the substrate owns the storage shape. |
| `@onderling/chat-agent` (L1c) | `MessagingBridge` interface + `TelegramBridge` (`@onderling/chat-agent/bridges/telegram`) for the Telegram chat surface. | Chat platform abstraction is reused by H4/H5/H8; the Telegram bridge belongs at the substrate layer so other apps don't re-implement it. |
| `@onderling/llm-client` (L1j) | Tool-calling LLM dispatch — Ollama provider via `@onderling/llm-client/providers/ollama`; cloud providers behind `requiresKey` opt-in. | Provider-agnostic tool dispatch is needed by every LLM-driven app; substrate owns the privacy gating. |
| `@onderling/notifier` (L1f) | `nextDailyFireInTz` for the household's daily-digest scheduler. | TZ-aware "next fire" math is non-trivial; substrate already has it tested across DST boundaries. (The full `Notifier` class is not yet composed — H2 currently runs its own scheduler; migration deferred.) |

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/core` | `MemorySource` | DataSource concrete passed into `ItemStore` for the in-memory store adapter. | `ItemStore` is `core.DataSource`-shaped post-Phase 5.2; production deploys swap this for a `pod-client.PodClient`-wrapped adapter at the app layer. |
| `@onderling/core` | `AgentIdentity` | Bot-identity issuance under `src/identity/BotIdentity.js`. | Foundation primitive; `AgentIdentity.generate` is the single source of truth for keypair creation, no substrate wraps it. |
| `@onderling/core` | `PodCapabilityToken` | Admin-capability flow under `src/identity/AdminCapability.js` — household admin issues capability tokens to members. | Capability-token primitive is kernel-foundational; substrates compose it, they don't wrap it. |
| `@onderling/pod-client` | (Future) `PodClient` | Production pod read/write/list (V2 hybrid-pod design). | Listed as a dep in `package.json` for the V2 migration; current code is in-memory only. |

## Plan documents

- `../../Project Files/projects/07-household-app/README.md` — L2 design notes
- `../../Project Files/projects/07-household-app/implementation-plan.md` — phased rollout, parallel streams
- `../../Project Files/projects/07-household-app/programming-plan.md` — code design / module map
- `../../Project Files/coding-plans/track-H-app-household.md` — cross-track design doc with all 14 design questions locked

## Bring it up

```bash
npm install --prefix apps/household
npm test    --prefix apps/household        # 463/465 pass; 2 pre-existing unrelated failures (TelegramBridge inline-keyboard test + e2e/llm-roundtrip tool-not-found test)

# Phase 1 in progress — not runnable end-to-end yet.
# Telegram + LLM wiring lands in subsequent phases per the implementation plan.
```

## What's in here

```
apps/household/
├── README.md                 ← this file
├── package.json              ← @onderling-app/household
├── src/
│   ├── storage/
│   │   ├── InMemoryStore.js  ← adapter over @onderling/item-store + core.MemorySource
│   │   ├── HybridPodStore.js ← household-pod ↔ per-member pod orchestrator (V2)
│   │   └── Store.js          ← legacy interface preserved for existing skill handlers
│   ├── identity/
│   │   ├── BotIdentity.js    ← bot keypair (core.AgentIdentity)
│   │   ├── AdminCapability.js ← admin → member capability tokens (core.PodCapabilityToken)
│   │   └── MemberWebIdMap.js ← (TODO: migrate to L1h identity-resolver)
│   ├── scheduler/            ← daily digest + nudges (currently app-local; migration to L1f Notifier deferred)
│   ├── skills/               ← addItem / markComplete / removeItem / listOpen / nudgeCompletion / composeDigest
│   ├── chat/                 ← Telegram bridge wiring + LLM tool dispatch (chat-agent + llm-client)
│   └── agent/                ← composition root
└── test/                     ← scripts + vitest
```

## Why a separate app

H2 is a chat-driven, optionally-LLM-mediated agent — a different
shape from Folio (notes-folder ↔ pod sync) and Archive (FTS5 over
pod content).  Shares `@onderling/core` + `@onderling/pod-client` with
the others; adds `telegraf` (Q-H2.1 lock) for Telegram, and an
optional Ollama / cloud LLM provider (Q-H2.12 lock).

## Settings layout

Household will store user-tunable settings under its own pod
namespace, following the project-wide convention in
[`Project Files/conventions/cross-app-settings.md`](../../docs/conventions/cross-app-settings.md):

```
<pod>/household/settings/shared.json              user-portable
<pod>/household/settings/devices/<deviceId>.json  per-install (local-only)
```

**Likely device-scoped (per-install):** which Telegram bot token to
use (machine-specific secret), Ollama endpoint URL (per machine),
LLM provider preference when multiple are wired (CPU vs. cloud).
**Likely shared:** preferred LLM persona / system prompt, default
quiet-hours, language preference, conversation-summary frequency.

**Cross-app shared-defaults (Rule 3):** Household MAY seed defaults
from a pre-existing `<pod>/pinboard/settings/shared.json` for fields
like locale and default-share-location — the user has already made
those decisions in Pinboard and shouldn't re-make them here.

**Status (2026-05-07):** household is in design / DD-stage; no
persisted settings yet. Update this section when they land.

### Personal-pod URLs do not travel peer-to-peer

Per
`Project Files/projects/README.md`:
when household forwards a message between Telegram and the user's
agent (or to another household member's agent), no pod URL appears
in the payload. If the message contains an image, the bytes ship
inline (with resize). LLM-generated content that references "your
file at <pod-url>" must be rewritten to drop the URL before peer
transmission.
