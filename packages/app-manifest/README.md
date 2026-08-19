# @onderling/app-manifest

> **Layer: substrate.** Per-app declarative manifest + pure projectors.
> The bundle-declaration format that feeds the project's §0 destination
> substrates (`@onderling/interface-registry`, `@onderling/protocol`) and ships
> the chat/slash surface those substrates don't cover. Phase: **SP-0**
> (see `PLAN-uniforme-representatie.md` in the repo root).

---

```
npm install @onderling/app-manifest
```

## What this is

An app declares its surface once, as data, in a `Manifest`:

- `itemTypes` — strings from `@onderling/item-types` canonical registry,
  or app-local (the validator permits both).
- `operations` — `{id, verb, appliesTo?, params?, role?, surfaces?}`;
  `verb` must be one of the item-store verbs (frozen allow-list,
  exported as `VERBS`).
- `views` — `{id, title, type, filter?, defaultAudience?}` — menu /
  inbox section structure.
- `surfaces` per operation — `chat` (hint/examples), `slash` (command,
  optional `match` grammar spec), `ui` (placement/control/label for
  buttons + inline-keyboard generation).
- `slashGrammar` (manifest-level, optional) — addressed-prefix strip,
  special forms, type aliases, default type — drives `renderSlash`.

Four pure functions project the manifest onto surfaces:

```text
validateManifest(manifest)               → { ok, errors }
paramsToJsonSchema(params, { manifest? })
                                         → JSON Schema object
renderChat(manifest,
           { skillRegistry, toSkillCtx, onStateUpdates? }, opts?)
                                         → { toolCatalogue, toolHandlers,
                                             systemPrompt, commandMenu,
                                             inlineKeyboardFor }
renderSlash(manifest)                    → { parse(text) → null | Call | Call[] }
```

All four are **deterministic** — same input ⇒ byte-identical output;
declaration order preserved throughout.

`renderChat`'s output plugs straight into `@onderling/chat-agent`'s
`ChatAgent` constructor (`toolCatalogue` + `toolHandlers` + `systemPrompt`).
`renderSlash().parse` has the same return shape as household's
`regexParse` (drop-in for SP-1's byte-equivalence gate).

---

## Boundary — declare, don't run

Per `PLAN-uniforme-representatie.md` guardrail **#9**: this package is
the project's bundle-declaration format. It **declares**; two peer
destination substrates **run**:

- **`@onderling/interface-registry`** — per-TYPE renderer registry
  (compact + full + conflict resolution, user-overridable).
  `renderWeb` / `renderMobile` (later SPs) compose its `renderCompact`
  / `renderFull` for per-item cells; this package **never** does
  per-type renderer dispatch. `operations.params` + `surfaces.ui`
  shapes are designed forward-compatible with
  `register({ type, renderer, actions })`.
- **`@onderling/protocol`** — state-machine substrate for multi-step
  processes. Multi-step operations declared in this manifest are
  expressible as `defineProtocol` data; the orchestrator runs them.

interface-registry / protocol / the Hub are **P6 destination scaffolds**
("direction-only" today). Near-term this package stands alone; the
composition materialises at the destination's pace.

### When mounted alongside other manifests

The runtime composition layer is `@onderling/manifest-host` (SP-4 V0).
A manifest authored in isolation can collide with siblings once mounted
into a multi-app host:

- **Slash commands** declared by two apps (e.g. both mount a `/add`)
  surface in `host.compose().collisions[]`.  The host **detects** but
  does **not** resolve — the resolution policy is a host-level
  decision, not a manifest concern.
- **`systemPrompt`** is returned per-app by the host; the consumer
  picks the composition strategy (concat / pick-primary / generic
  preamble).  Don't write a manifest assuming yours is the only prompt
  in the room.
- **Inline-keyboard buttons** on items that ≥2 manifests both target
  appear in mount-insertion order.  If your op's `surfaces.ui.label`
  matters next to a sibling's, the host's `Potential conflicts` notes
  document the (deferred) ordering controls.

See `packages/manifest-host/README.md` § "Potential conflicts the host
leaves to the consumer" for the full picture.

---

## Quick start

```js
import {
  renderChat, renderSlash, validateManifest,
} from '@onderling/app-manifest';

const manifest = {
  app:        'todo',
  itemTypes:  ['note'],
  operations: [
    {
      id:      'addNote',
      verb:    'add',
      params:  [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        chat:  { hint: 'add a note' },
        slash: { command: '/add',
                 match:   { verbs: ['add'], body: 'match' } },
      },
    },
  ],
  views: [{ id: 'all', title: 'All notes', type: 'note' }],
};

const { ok } = validateManifest(manifest);                       // → true

const chat = renderChat(manifest, {
  skillRegistry: {
    addNote: async (args) => ({
      replies:      [{ text: `noted: ${args.match}` }],
      stateUpdates: [],
    }),
  },
  toSkillCtx: (toolCtx) => ({ chatId: toolCtx.chatId }),
});
// chat.toolCatalogue, chat.toolHandlers, chat.systemPrompt, …

const { parse } = renderSlash(manifest);
parse('add buy milk');   // → { skillId: 'addNote', args: { match: 'buy milk' } }
```

---

## API (frozen 2026-05-19 — SP-1's input)

```text
validateManifest(manifest) → { ok, errors: [{path, message}, …] }
VERBS                       — frozen item-store verb allow-list
isCanonicalVerb(verb)       — set-lookup
classifyItemTypes(manifest) — { canonical, appLocal } against
                              @onderling/item-types list() (informational
                              only; app-local types are accepted by
                              validateManifest — F-SP1-a)

paramsToJsonSchema(params, { manifest? })
  → { type: 'object', properties, required }
  Properties + required preserve param declaration order.
  Enum: kind:'enum' + of:'itemTypes' resolves vs manifest.itemTypes;
        kind:'enum' + of:[…]         uses the inline array.

renderChat(manifest, { skillRegistry, toSkillCtx, onStateUpdates? }, opts?)
  → { toolCatalogue:        Array<{id, description, schema}>,
      toolHandlers:        Record<id, (args, toolCtx) => ToolResult>,
      systemPrompt:        string,
      commandMenu:         Array<{command, description}>,
      inlineKeyboardFor:   (item) => Array<{label, callbackData}> }

  toolHandlers[id] adapts an app-side skill
    (args, skillCtx) → { replies, stateUpdates }
  into a ChatAgent ToolHandler
    (args, toolCtx)  → { replies, data: { stateUpdates } }
  via toSkillCtx(toolCtx) + onStateUpdates(updates) — reproduces
  household's `chatAgentBridge.asToolHandler` generically.

renderSlash(manifest) → { parse(text) → null | Call | Call[] }
  Call = { skillId, args }
  Drop-in for household's regexParse(text). Driven by
  manifest.slashGrammar + per-op surfaces.slash.match.
```

---

## Status

- **SP-0** (this package) — greenfield; no consumers until SP-1.
- **SP-1** — household cutover (byte/behaviour-equivalence gate).
- See `CODING-uniforme-representatie.md` + `PLAN-uniforme-representatie.md`
  in the repo root for the full plan and the frozen contract.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/app-manifest`).
