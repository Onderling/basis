# @onderling/agent-ui

> **Layer: substrate.** Composes the `@onderling/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Localhost-only A2A glue for apps that run a UI process beside their own
agent. Ships two thin primitives:

- **`mountLocalUi(agent, opts)`** — wraps `core.A2ATransport` bound to
  `127.0.0.1`. The agent gets exposed over A2A's standard wire shape
  (`POST /tasks/send`, SSE subscribe, agent-card discovery, etc.). All
  dispatch flows through `core.taskExchange.handleTaskRequest` — the
  real path, with PolicyEngine, group filtering, capability tokens,
  streaming, IR, TTL, and abort.
- **`LocalAgentClient`** — an A2A-wire-shape client suitable for a
  browser tab, RN app, or CLI process running on the same host.

This is **L1d** in the substrate-first plan, re-scoped 2026-05-04 to
localhost-only (`Project Files/Substrates/L1d-agent-ui.md`).

> **What changed 2026-05-04:** the previous primitives — `composeAgent`,
> `SkillRouter`, `EventBroadcaster`, `ctxActor`, `AgentUiClient` — built
> a synthetic `{invokeSkill}` agent shape that bypassed `core.Agent` /
> `taskExchange` / `A2AAuth`. Consumers silently lost group filtering,
> tier visibility, capability tokens, and streaming. They were deleted
> when all three downstream consumers (`apps/tasks-v0`,
> `apps/neighbourhood-v0`, `apps/archive`) migrated to the real
> `core.Agent` dispatch path.

## Server side

```js
import { Agent, defineSkill, AgentIdentity,
         InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi } from '@onderling/agent-ui';

// Build a real core.Agent.  Apps usually do this inside their own
// factory (createTasksAgent / createArchiveWebServer / ...).
const id        = await AgentIdentity.generate(new VaultMemory());
const transport = new InternalTransport(new InternalBus(), id.pubKey);
const agent     = new Agent({ identity: id, transport, label: 'Tasks' });

agent.skills.register(defineSkill('addTask', async ({ parts, from }) => {
  // parts: A2A Parts[]; from: caller pubkey/webid
  return { task: { id: 'x', text: 'hi' } };   // auto-wrapped to a DataPart
}, { description: 'Create a task', visibility: 'authenticated' }));

await agent.start();

const ui = await mountLocalUi(agent, { port: 8888 });
console.log(`UI agent at ${ui.url}`);          // http://127.0.0.1:8888

// ... when shutting down:
await ui.stop();
await agent.stop();
```

`mountLocalUi` defaults `host: '127.0.0.1'` (localhost-only) and lets
the OS pick a port if you pass `port: 0`. Pass `host: '0.0.0.0'` only if
you understand the security implications — the bare `core.A2ATransport`
is the right primitive for that case.

## Client side

```js
import { LocalAgentClient } from '@onderling/agent-ui';
import { DataPart }         from '@onderling/core';

const client = new LocalAgentClient({
  baseUrl: 'http://127.0.0.1:8888',
  authHeader: async () => ({ Authorization: `Bearer ${await getOidcToken()}` }),
});

// Invoke a skill (sends `POST /tasks/send`).
const result = await client.invoke('addTask',
  [DataPart({ type: 'task', text: 'paint hallway' })]);
const data = result.parts.find((p) => p.type === 'DataPart')?.data;
//   ↑ skill-handler return value, auto-wrapped on the way out

// Discover skills via the agent card.
const card = await client.discoverSkills();
console.log(card.skills.map((s) => s.id));

// Streaming skill (sends `POST /tasks/sendSubscribe`, opens an SSE stream).
const off = client.subscribe('events', [], (event) => {
  console.log('event:', event);
});
// ...
off();
```

The client uses `globalThis.fetch` and `globalThis.EventSource` by
default.  Apps with non-standard environments (RN before
`react-native-sse`, Node before v22) inject `fetchFn` /
`eventSourceFactory` via the constructor.

## API

```ts
// Server
mountLocalUi(agent, {
  port?:    number = 0,        // 0 → OS-assigned
  host?:    string = '127.0.0.1',
  baseUrl?: string,            // override the public URL
  a2aTLSLayer?: A2ATLSLayer,   // TLS at the agent level (rare for localhost)
}) → Promise<{
  url:       string,
  port:      number,
  transport: A2ATransport,     // exposed for advanced wiring
  stop:      () => Promise<void>,
}>

// Client
new LocalAgentClient({
  baseUrl:           string,
  fetchFn?:          (input, init?) => Promise<Response>,
  eventSourceFactory?: (url, opts?) => EventSource,
  authHeader?:       () => Promise<Record<string, string> | null>,
})
client.invoke(skillId, parts?, opts?) → Promise<{parts, status, raw}>
client.subscribe(skillId, parts?, handler, opts?) → close-fn
client.discoverSkills() → Promise<AgentCard>
```

## Pattern source

The localhost-A2A pattern: `apps/folio-mobile` and the new
`apps/archive/src/server/index.js` are canonical examples.

## See also

- `Project Files/Substrates/L1d-agent-ui.md` — sketch.
- `Project Files/Substrates/refactor/L1d-agent-ui-refactor.md` — the
  audit that triggered the 2026-05-04 re-scope.
- `Project Files/Substrates/refactor/L1d-apps-rewrite-handoff.md` —
  per-app migration steps when this substrate's primitives changed.
