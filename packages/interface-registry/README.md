# @onderling/interface-registry

Per-type renderer registry. Bundles register **compact + full**
renderers for the item-types they handle; apps look up renderers
by type when projecting an item to UI.

> Standardisation Phase **52.12** — direction-only. Hub V2 territory.
> The Agent slot for this substrate exists in core (Phase 50.13).

---

## Quick start

```js
import { createInterfaceRegistry } from '@onderling/interface-registry';

const reg = createInterfaceRegistry();

// Tasks bundle registers its `task` renderer at boot.
reg.register({
  type:     'task',
  bundleId: 'tasks-bundle',
  renderer: {
    compact: (task) => <TaskChip task={task} />,
    full:    (task) => <TaskDetailView task={task} />,
  },
  actions: [{ id: 'mark-done', label: 'Mark done' }],
});

// Pinboard renders an embedded task ref:
const chip = reg.renderCompact(embeddedTask);
//   → <TaskChip task={…} />   when 'task' is registered
//   → { kind: 'permission-denied', ... } when nothing is registered
```

---

## Two-mode rendering contract

Every bundle registering a type **must** supply both:

- `compact(item, ctx?)` — chip / row / card for embedded refs;
  fits a single line of UI space.
- `full(item, ctx?)` — detail view for tap-through.

Both are **renderer-agnostic** — the substrate doesn't impose React
vs DOM vs CLI. They return whatever shape the consuming platform
expects.

---

## Conflict resolution

Multiple installed bundles can register a renderer for the same
type. The substrate records all registrations; the default-picker
decides which one fires.

- **First-write wins** as the initial default — single-bundle
  installs need no setup.
- `setDefault(type, bundleId)` lets the user (or app) re-point.
- `lookup(type)` returns `{ entry, conflicts: [...] }` so the UI
  can surface a "pick default" prompt when more than one is
  installed.
- Unregistering the default promotes a sibling.

OS-level conflict UX (Android's "default app for type" picker)
sits **on top** of this — the substrate just records state; the OS
shell drives the prompt.

---

## Permission-denied fallback

When an embedded ref points at a resource the receiver can't fetch
(ACP-blocked, network-flake, gone), `renderCompact / renderFull`
return a descriptor instead of throwing:

```js
{
  kind:   'permission-denied',
  type:   'task',
  ref:    'pseudo-pod://other/x',
  reason: 'NOT_FOUND' | 'FORBIDDEN' | 'NETWORK_ERROR' | 'NO_RENDERER' | …,
  label:  '🔒 task',
}
```

The UI layer (RN, web, CLI) interprets the descriptor into a native
fallback chip — same shape across every type so users get a
consistent "this cross-pod ref is unreachable" pattern.

---

## API

```text
createInterfaceRegistry({ allowType? })

reg.register({ type, bundleId, renderer, actions? })
reg.unregister({ type, bundleId })
reg.lookup(type)                          → { entry, conflicts: [...] }
reg.renderCompact(item, ctx?)
reg.renderFull(item, ctx?)
reg.subscribe(cb)                         → unsubscribe

reg.setDefault(type, bundleId)
reg.clearDefault(type)
reg.getDefault(type)
reg.getDefaults()                         → { type: bundleId, … }

reg.listTypes()
reg.listBundles(type)
```

---

## What V0 deliberately does not do

- **Bundle install / discovery.** A real Hub installs bundles
  (APKs / web manifests / CLI plugins); the substrate just records
  what gets registered at runtime. Discovery is the Hub's job.
- **Sandboxing / security.** Renderer functions run in the same
  process as the registry; the Hub trust model handles isolation.
- **Action invocation.** `actions[]` is captured but not invoked —
  the consuming shell maps action IDs to user-visible buttons + the
  business logic.
- **Async renderers.** `compact` / `full` are sync. If a renderer
  needs to fetch additional data, it should accept a pre-loaded
  `ctx.deps` from the consumer rather than returning a Promise.

---

## Files

```
packages/interface-registry/
├── index.js
├── src/
│   ├── InterfaceRegistry.js  — createInterfaceRegistry()
│   ├── renderModes.js        — RendererPair validator
│   ├── defaultPicker.js      — default-bundle state holder
│   └── permissionDenied.js   — fallback chip descriptor
└── test/                      — 25 tests
```
