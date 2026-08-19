# @onderling/manifest-host

> **Layer: substrate.** Runtime composition of N app-manifests in one
> process. Each `mount(appId, manifest, opts)` caches the projector
> output; `compose()` merges across all mounted apps with **namespaced**
> `appId.opId` ids. SP-4 V0 — see `CODING-uniforme-representatie.md`
> § SP-4 + `PLAN-uniforme-representatie.md` in the repo root.

---

## What this is

A host owns the *runtime* side of the manifest model:

- It accepts manifests via `mount(appId, manifest, opts)`.
- It composes their projector outputs into a single `compose()` view
  with `appId.opId` namespacing — so a chat / bot / UI consumer sees
  one merged `toolCatalogue` without app-id collisions.
- It **detects but does not resolve** slash-command collisions across
  apps; resolution is a consumer concern.

```text
createManifestHost() → Host

host.mount(appId, manifest, { skillRegistry, toSkillCtx, onStateUpdates? })
host.unmount(appId)
host.list()    → string[]
host.compose() → { toolCatalogue, toolHandlers, commandMenu, collisions,
                   inlineKeyboardFor, perAppSystemPrompts }
```

Tool ids are prefixed `appId.opId`; `toolHandlers` keyed the same;
`inlineKeyboardFor` re-prefixes `callbackData` to `appId.opId:itemId` so
dispatch routes naturally back to the right app.

`appId` may not contain `.` or `:`.

---

## Quick start

```js
import { createManifestHost } from '@onderling/manifest-host';
import { householdManifest }  from '@onderling-app/household/manifest';
import { tasksManifest }      from '@onderling-app/tasks/manifest';

const host = createManifestHost();

host.mount('household', householdManifest, {
  skillRegistry: householdSkills,
  toSkillCtx:    (c) => ({ ...c, store: householdStore }),
});

host.mount('tasks', tasksManifest, {
  skillRegistry: tasksSkills,
  toSkillCtx:    (c) => ({ ...c, store: tasksStore }),
});

const composed = host.compose();
//   composed.toolCatalogue: [
//     {id:"household.addItem",  description:"...", schema:{...}},
//     {id:"household.listOpen", ...},
//     {id:"tasks.addTask",      ...},
//     {id:"tasks.claim",        ...},
//     ...
//   ]
//   composed.collisions: [{command:"/add", appIds:["household","tasks"]}]

await composed.toolHandlers['tasks.addTask']({ text: 'paint hallway' }, ctx);
```

---

## Potential conflicts the host leaves to the consumer

V0 intentionally surfaces three cross-app conflict shapes as **data**
rather than baking in a policy.  Decide once per host (chat agent / UI
shell / per-circle config); the host itself is policy-free.

1. **Slash-command collisions.**  When ≥2 mounted apps register the
   same `surfaces.slash.command`, `compose().collisions[]` lists each
   command + the apps that registered it.  V0 does **not** pick a
   winner.  Reasonable policies:
   - **first-mount-wins** (silent + simple — but mount order then
     becomes meaningful);
   - **prefix-all-on-collision** (`/tasks/add` vs `/household/add` only
     when collisions exist; otherwise bare `/add`);
   - **LLM-disambiguate** (push collisions into the free-text channel
     instead of the slash channel);
   - **per-host config** (declare the winner explicitly).

   Pick deliberately; mixing policies across hosts confuses users.

   **Canonical default (SP-12 audit 2026-05-24, #246):** hosts SHOULD
   adopt **first-mount-wins** unless they have a specific reason to
   pick another policy.  Rationale: today household/stoop/calendar
   have ZERO command-name overlap (audit confirmed across all 31
   slash commands), so collisions are rare; first-mount-wins handles
   the rare case predictably with no per-command config burden.  Add
   `prefix-all-on-collision` as a per-host override when a specific
   collision warrants it; reserve `LLM-disambiguate` for cases where
   user testing shows confusion.  See `Project Files/basis/
   slash-coverage-audit-2026-05-24.md` for the underlying data.

2. **`perAppSystemPrompts` composition.**  `compose()` returns the
   per-app system prompts in a keyed object, **not** concatenated.
   Reasonable policies:
   - concat (`prompt1 + "\n\n" + prompt2`) — fine for ≤2 small apps;
     scales badly;
   - pick-primary (one app is the "lead" for this circle; the others'
     tools available but no prose);
   - generic preamble (a short host-owned prompt that says "you have
     N apps available, use them"; per-app tool descriptions carry the
     guidance) — usually the best default for ≥3 apps.

   See `chat-agent`'s system-prompt slot for the consumer side.

3. **Inline-keyboard ordering on shared items.**  When ≥2 mounted apps
   both surface a per-item button on the same item (e.g. both `tasks`
   and `household` show a Done button on a `task`), V0 emits buttons
   in **mount-insertion order**.  Reasonable refinements (deferred):
   - explicit per-button `priority` on the manifest side;
   - host-side `compose({ buttonOrder: ['household','tasks'] })`;
   - dedup by `op.verb` when two apps name the same action.

   V0 ships the deterministic-but-naive default; revisit when a real
   ≥2-app scenario actually produces visible conflicts.

> These three are **expected, not bugs** — they are the cost of
> letting apps stay distinct units.  If/when SP-11 (the recombination
> demo) or a real two-app host surfaces a clear-best policy, harden
> the default then — not before.

---

## What V0 does NOT do (SP-4b scope)

- **No tasks-v0 multi-circle generalisation.** tasks-v0's V2.8 topology
  (`bundleResolver` / `wireSkills` / `CircleState`) is real production
  code with 542 passing tests; generalising it through the host is
  SP-4b, with its own regression gate.
- **No collision resolution.** The host detects collisions; picking a
  winner (prefix-all / first-mount-wins / LLM-disambiguate / per-host
  config) is a consumer decision.
- **No `perAppSystemPrompts` composition.** Returned separately so the
  consumer picks "concat / primary / generic preamble" deliberately.
- **No persisted per-scope enabled-set state.** Mount happens at
  runtime via API; "which apps are on for this circle" is a consumer
  concern (SP-5 wires audiences; the launcher state may move here
  later).

---

## API

```ts
createManifestHost() → Host

interface Host {
  mount(
    appId: string,
    manifest: Manifest,
    opts: {
      skillRegistry: Record<string, Skill>,
      toSkillCtx:   (toolCtx: object) => object,
      onStateUpdates?: (updates: Array<object>) => void,
    },
  ): MountedApp

  unmount(appId: string): void
  list(): string[]
  compose(): ComposedView
}

interface ComposedView {
  toolCatalogue:         Array<{ id: string; description: string; schema: object }>
  toolHandlers:        Record<string, (args: object, toolCtx: object) => Promise<object>>
  commandMenu:         Array<{ command: string; description: string; appId: string }>
  collisions:          Array<{ command: string; appIds: string[] }>
  inlineKeyboardFor:   (item: object) => Array<{ label: string; callbackData: string }>
  perAppSystemPrompts: Record<string, string>
}
```

---

## Status

- **SP-4 V0** (this package) — host substrate; tested standalone
  against synthetic manifests; **zero changes to existing apps**.
- **SP-4b** — tasks-v0 multi-circle generalisation through the host.
  See `CODING-uniforme-representatie.md` § SP-4b.
