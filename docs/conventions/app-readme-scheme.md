# App README scheme — required structure

> Every app under `apps/` must follow this scheme so a reader can
> immediately see what the app is built on and where it deviates.
> This is a project-wide convention, not a per-app preference.

---

| | |
|---|---|
| **Status** | locked 2026-05-04 |
| **Companion** | [`./architectural-layering.md`](./architectural-layering.md) |
| **Applies to** | every directory under `apps/`, including those that ship as standalone repos later |

---

## Why this exists

The architectural layering rule (apps depend on substrates, substrates
depend on core) is invisible to a reader if it's only enforced in code.
A consistent README structure makes the layering legible in two reads:

1. "What does this app do?"
2. "What is it built on?"

A new contributor (human or AI) should be able to answer #2 without
opening `package.json` — and should be able to spot a layering
violation immediately if direct kernel use isn't justified.

---

## Required sections (in order)

Every `apps/<name>/README.md` MUST contain these sections, in this
order, with these headings:

```markdown
# <app-name>

<one-paragraph what-and-why>

## Substrates

<the layering map — see template below>

## Direct kernel use

<justifications — see template below; "None" is a valid value>

## Shared UI helpers

<for products with both a desktop + mobile shell, the helpers in
`src/ui/` that the sibling shell consumes; "N/A — single-shell app"
is a valid value. See template below.>

## Bring it up

<setup, dependencies, scripts to run>

## What's in here

<file-tree summary; can be brief>
```

Apps may add additional sections (testing, troubleshooting, CHANGELOG
links, related apps, design pointers) — those are unconstrained. The
five sections above are the **required spine**.

---

## Template — the `## Substrates` section

List every `@onderling/<substrate>` package the app imports, what the
app uses each for, and a single sentence per substrate explaining why
that substrate (rather than direct kernel use) is the right home for that
concern.

```markdown
## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/item-store` (L1b) | Open/closed task ledger with attribution + audit. | The pod write paths + per-field merge contracts are non-trivial; substrate amortises across H4/H5/H8. |
| `@onderling/offering-match` (L1e) | Pubsub-of-offerings broadcast + claim. | The local-profile filter + posture flag is shared with H4 (tasks) and H8 (presence). |
| `@onderling/agent-ui` (L1d) | REST + SSE skill exposure. | Same pattern as H4's web UI — the substrate owns the auth + dispatch. |
| `@onderling/identity-resolver` (L1h) | Member webid map + display-name resolution. | Cross-source identity is reused by H4/H5/H7. |
```

Concrete examples below. Apps with zero substrate dependencies (rare
— typically only `apps/sdk-smoke` and `apps/mesh-demo` since they
deliberately exercise the kernel directly) write `*None.* See "Direct
kernel use" below for why.`

---

## Template — the `## Direct kernel use` section

For each direct import from `@onderling/core`, `@onderling/relay`,
`@onderling/pod-client`, or `@onderling/react-native`, list the specific
primitive used and the one-line justification. **The default reader
expectation is that this section is short or empty;** every entry is
treated as a deliberate choice and reviewed during the app↔kernel bypass
audit (see `Project Files/TODO-GENERAL.md`).

```markdown
## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/core` | `Agent`, `defineSkill` | App constructs the agent itself + registers app-specific skills. | No substrate wraps "construct an agent"; that's foundational. Substrate-of-substrates would be over-abstraction. |
| `@onderling/react-native` | `MobilePushBridge`, `ExpoNotificationsAdapter` | RN-side push receiver. | Platform layer — by design, RN-specific bring-up lives in `@onderling/react-native`. No substrate wraps it. |
| `@onderling/pod-client` | `PodClient` | Direct Solid pod read/write. | This app pre-dates L1a `sync-engine`; sync-engine V2 will replace this. Tracked in [`<link>`](...). |
```

If an entry can't be justified beyond "we needed it", that's the
signal that either (a) a substrate is missing and rule-of-two is
already satisfied, or (b) the app is reaching past a substrate that
should have served it. Either way, it's a TODO — not a clean
justification.

If the section is empty, write:

```markdown
## Direct kernel use

None. All kernel access goes through substrates.
```

---

## Template — the `## Shared UI helpers` section

For products that ship both a desktop shell (`apps/<product>`) and
a mobile shell (`apps/<product>-mobile`), every pure-fn UI helper
shared between them lives once in the desktop shell under
`apps/<product>/src/ui/` (per
[`./architectural-layering.md`](./architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10)).

The desktop shell's README lists the surface; the mobile shell's
README points back to it.

```markdown
## Shared UI helpers

This app exposes the following pure-fn helpers under `src/ui/` for
its sibling platform shell to consume (per
[`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10)):

| Helper | Purpose | Consumed by |
|---|---|---|
| `taskStatus` | display-status mapping + V2.7 deps gates | `web/app.js`, `apps/<product>-mobile/src/screens/*.jsx` |
| `composeArgs` | addTask form-payload builder | both shells |
| `inboxClassify` | inbox event-kind taxonomy | both shells |
| `effectiveActor` | pubKey ↔ webid alias resolver | both shells |

Tests live in `test/ui-*.test.js` and run on the desktop's vitest
config (Node only). The mobile shell does not duplicate them.
```

The mobile shell's README simply notes:

```markdown
## Shared UI helpers

UI-glue helpers come from `@onderling-app/<product>/ui/*` (the
desktop shell). See its README for the surface.
```

Single-shell apps may write `## Shared UI helpers` followed by
`N/A — single-shell app.`

---

## Template — the `## Bring it up` section

Setup commands, environment variables, hardware requirements,
sideloading instructions. App-specific. Examples to mirror:

- `apps/folio-mobile/README.md` — multi-platform RN setup with the
  bring-up traps cross-linked to
  `packages/react-native/docs/BRING-UP-NOTES.md`.
- `apps/sdk-smoke/README.md` — Expo dev-client + emulator/device matrix.

This section should be **runnable as a checklist**: if a reader
follows it top to bottom, they end with a working app.

If the app has a user-facing surface, the **Bring it up** section
must also include a short **Localisation** subsection per the
project localisation convention ([`./localisation.md`](./localisation.md)) — listing
supported locales and how to add a new one. Apps without a
user-facing surface (pure libraries, headless smoke harnesses) may
omit this.

---

## Template — the `## What's in here` section

Brief file-tree summary. The point is orientation, not exhaustive
documentation. Folio mobile's README shows the right level of detail.

---

## Worked example — `apps/neighbourhood-v0`

A complete README following this scheme:

````markdown
# H5 — neighbourhood-v0

Non-anonymous closed-group skill matchmaking. V0 of the substrate-first
plan.

## Substrates

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/item-store` (L1b) | Records every request as a structured item; audit log. | Pod write paths + per-field merge are shared with H4/H8. |
| `@onderling/offering-match` (L1e) | Broadcast requests + collect claims. | Pubsub-of-offerings + posture flag is the H5/H4/H8 shared primitive. |
| `@onderling/identity-resolver` (L1h) | Member webid map for `resolveMember` skill. | Cross-app identity reconciliation. |
| `@onderling/agent-ui` (L1d) | REST + SSE skill exposure (when wired). | UI host pattern shared with H4's web UI. |
| `@onderling/notifier` (L1f) | Push wake when humans need to decide (apps wire). | Scheduling + push channel shared with H4/H8. |

## Direct kernel use

None. All kernel access goes through substrates.
[Once the V2 multi-process smoke lands the app will additionally
construct a `core.Agent` directly — see H5-V2-resume.md step 1; this
section will document the justification at that time.]


## Bring it up

```bash
cd apps/neighbourhood-v0
npm install
npm test          # 9 integration tests
```

V2 multi-process bring-up: see
`Project Files/coding-plans/H5-V2-resume.md`.

## What's in here

```
apps/neighbourhood-v0/
├── README.md                 ← this file
├── package.json
├── src/
│   ├── Agent.js              ← createNeighbourhoodAgent factory
│   ├── index.js
│   └── skills/index.js       ← postRequest / acceptResponder / cancelRequest / list…
└── test/
    └── integration.test.js   ← 9 tests
```
````

---

## Migration policy for existing apps

Every existing app under `apps/` must be migrated to this scheme. The
work is tracked in
`Project Files/Substrates/refactor/01-Execution-Checklist.md`
under the "App-README rollout" phase. Until the rollout completes, the
following apps are non-conforming:

- `apps/folio-mobile` — has a README but no Substrates / Direct kernel use sections.
- `apps/folio` — same.
- `apps/sdk-smoke` — same; deliberately uses the kernel directly (the smoke harness exists to test it), so the Direct kernel section will be substantial.
- `apps/mesh-demo` — same; pending migration to substrates per checklist.
- `apps/household` — same.
- `apps/tasks-v0` — same.
- `apps/neighbourhood-v0` — same; migration is straightforward (worked example above).
- `apps/import-bridge-v0` — same; will be touched during L1g/L1a refactors anyway.
- `apps/archive` — same.
- `apps/presence-v0` — same.

The rollout should align with the substrate refactor phases — each app's
README gets updated when its substrate dependencies do. New apps must
ship with this scheme from the first commit.

---

## When the scheme doesn't fit

If you hit an app where this scheme doesn't make sense (e.g. a one-off
script, a temporary playground), **add a section explicitly noting that
this is the case** rather than silently dropping the required sections:

```markdown
> **Scheme exemption:** this app is a temporary scratch space and is
> not expected to ship. The README scheme defined in
> `Project Files/conventions/app-readme-scheme.md` is intentionally
> not applied here.
```

Exemptions need a justification. Default is to follow the scheme.
