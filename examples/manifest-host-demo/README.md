# manifest-host recombination demo

> **SP-4b + SP-11 (merged 2026-05-20).**  Composes household +
> tasks-v0 (with its real multi-circle runtime) in one process via
> `@onderling/manifest-host`, drives a chat-agent over the merged tool
> catalogue with a scripted LLM, and shows state landing in both apps'
> stores from one conversation.
>
> See `PLAN-uniforme-representatie.md` § SP-4b + § SP-11 (in the repo
> root) for the design context.

---

## What this proves

1. **Cross-app composition** — `@onderling/manifest-host`'s `compose()`
   merges N manifests into one toolCatalogue with `appId.opId`
   namespacing.  The chat-agent uses that merged catalogue directly,
   one mount per app.
2. **Multi-circle dispatch through the host** — tasks-v0's real
   multi-circle machinery (`bundleResolver` / `wireSkills` /
   `CircleState`, the same code `bin/tasks-ui.js --multi-circle`
   constructs) is mounted via the host's `toSkillCtx` adapter.
   bundleResolver still dispatches per-circle internally; the host
   doesn't know or care about circles — orthogonal layers.
3. **Zero changes to either app's production code** — household uses
   its existing skills + manifest; tasks-v0 uses its existing
   meshAgent + multi-circle runtime.  The host integrates additively
   via new `mountable.js` shims (one per app).
4. **Policy decisions made deliberately** — `perAppSystemPrompts`
   composed via the **generic preamble** policy (the host README's
   recommended default for ≥2 apps).  Collisions: zero in this
   two-app combo (household has slash; tasks-v0 doesn't).

---

## Run it

```bash
cd examples/manifest-host-demo
npm install
npm start        # node index.js
```

You'll see something like:

```
@onderling manifest-host recombination demo
— composing household + tasks-v0 in one chat surface

mounted apps:        household, tasks
composed toolCatalogue: 22 tools
  household tools:   10
  tasks tools:       12
command collisions:  0

— conversation —
  user[1]:  add bread to my shopping list
  bot:        Toegevoegd …
  user[2]:  add a task: paint the hallway
  bot:        {"task":{"text":"paint the hallway",...}}
  user[3]:  what's on my shopping list?
  bot:        …

— final state —
household.lists:
  shopping: [bread]
tasks.primary-circle open items:
  paint the hallway

✓ done
```

The integration test runs the same scenario and asserts both stores
ended up with the right items in the right places:

```bash
npm test
```

---

## How it composes

```text
                     ┌─────────────────────────────────────┐
                     │       ChatAgent (LLM-mediated)      │
                     │ toolCatalogue: [{id:"household.add…"} │
                     │              {id:"tasks.addTask"}…] │
                     └────────────────┬────────────────────┘
                                      │ toolCall {id, args}
                                      ▼
                     ┌─────────────────────────────────────┐
                     │  host.compose().toolHandlers[id]    │
                     │  (namespaced dispatch by appId)     │
                     └─────┬─────────────────────┬─────────┘
                "household.*"                "tasks.*"
                           │                     │
                           ▼                     ▼
           ┌──────────────────────┐  ┌──────────────────────┐
           │  household mountable │  │  tasks mountable     │
           │  • renderChat shape  │  │  • SDK→renderChat    │
           │    skills (native)   │  │    adapter           │
           │  • InMemoryStore     │  │  • bundleResolver    │
           │                      │  │    dispatch via      │
           │                      │  │    toSkillCtx        │
           └──────────────────────┘  └──────────────────────┘
                                                │
                                                ▼
                                     ┌────────────────────┐
                                     │ multi-circle runtime │
                                     │   circlesMap         │
                                     │   ├ primary-circle   │
                                     │   └ sibling-circle … │
                                     └────────────────────┘
```

### Key design choices

- **`bundleResolver` stays untouched.**  Multi-circle dispatch was never
  meant to live in the host layer; the host operates on the chat
  surface, bundleResolver operates on the mesh skill graph.  They are
  orthogonal — which is exactly what SP-4b's framing correction made
  explicit.

- **System-prompt composition: generic preamble.**  Lists the mounted
  apps; lets the merged tool catalogue's per-tool descriptions carry
  the rest.  Recommended for ≥2 apps in
  `packages/manifest-host/README.md` § "Potential conflicts".
  Alternatives ("concat", "pick primary") fit other scenarios — pick
  per host.

- **No `item.audience` field used yet.**  Demo runs against the SP-5
  V0 substrate (audience model + circles substrate published, no
  item-store schema change).  The audience model is wired up and
  available; concrete consumption is SP-5b once a real cross-app
  audience scenario surfaces.

- **`text` substrate-compat note.**  `@onderling/item-store`'s `addItems`
  requires a non-empty `text` field on every partial.  Household
  skills already comply; tasks-v0 skills also do.  Documented in
  `packages/circles/README.md` and the SP-5b backlog.

---

## What this demo does NOT do

- **No real LLM.**  Tool calls are scripted via
  `@onderling/llm-client`'s `mockProvider` for deterministic execution.
  Wiring a real LLM (e.g. Ollama, OpenAI) is a one-line change in
  `scenario.js`; the rest of the pipeline is provider-agnostic.
- **No web / mobile surface.**  Chat-only.  Web + mobile surfaces
  consuming the manifest are the
  `PLAN-gui-chat-uplift.md` track (deferred, designed in parallel).
- **No cross-app audience query.**  An LLM call from household
  doesn't (yet) consult tasks-v0's data, or vice versa.  Cross-app
  audience plumbing is SP-5b + a concrete consumer.
- **No real network / TG bot wiring.**  Headless `InMemoryBridge`
  for inputs + outputs.  Production deployments wire whichever
  bridges are needed.
