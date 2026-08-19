# @onderling/chat-agent

> **Layer: substrate.** Composes the `@onderling/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Conversational LLM-mediated chat surface — `MessagingBridge`
interface, per-chat session manager, narrow tool dispatcher.

This is **L1c** in the substrate-first plan
(`Project Files/Substrates/L1c-chat-agent.md`).  Generalised from
H2 V2's chat surface; designed by reading H2 V2 + H5 (optional
chat) specs side-by-side per the rule-of-two policy.

---

## Quick start

```js
import { ChatAgent, InMemoryBridge } from '@onderling/chat-agent';
import { LlmClient } from '@onderling/llm-client';
import { ollamaProvider } from '@onderling/llm-client/providers/ollama';

const bridge = new InMemoryBridge({ id: 'memory' });
const llm = new LlmClient({
  provider: ollamaProvider({ model: 'qwen2.5:7b-instruct' }),
});

const agent = new ChatAgent({
  bridges: [bridge],
  llm,
  toolCatalogue: [
    { id: 'addItems',     description: 'Add items to the household list', schema: {/*...*/} },
    { id: 'markComplete', description: 'Mark items complete',             schema: {/*...*/} },
  ],
  toolHandlers: {
    addItems: async (args, ctx) => {
      const items = await itemStore.addItems(args.items, { actor: ctx.actorWebid });
      return { reply: `✓ added ${items.length} items`, data: { ids: items.map((i) => i.id) } };
    },
    markComplete: async (args, ctx) => {
      // ...
    },
  },
  systemPrompt: 'You are the household assistant for the De Roos family ...',
  contextBuilder: async (chatId, member) => {
    const open = await itemStore.listOpen();
    return formatNL(open, member);  // app-specific NL formatting
  },
  memberResolver: async (chatId, sender) => identityResolver.resolveByExternalId(
    'telegramUid', sender.bridgeUid,
  ),
  sessionTtlMs: 30 * 60 * 1000,
  historyDepth: 10,
});

await agent.start();

agent.on('tool-call', ({chatId, member, tool, args, result}) => {
  // notifier reacts to schedule nudges, etc.
});
```

---

## API surface

### `ChatAgent`

```ts
new ChatAgent({
  bridges:        MessagingBridge[],
  llm:            { invoke(req): result },
  toolCatalogue:    Array<{id, description?, schema?}>,
  toolHandlers:   Record<string, ToolHandler>,
  systemPrompt:   string,
  contextBuilder: (chatId, member) => Promise<string>,
  memberResolver?: (chatId, sender) => Promise<{webid, displayName}>,
  sessionTtlMs?:  number,    // default 30 min
  historyDepth?:  number,    // default 10
})

agent.start() / agent.stop()
agent.dispatch(chatId, text, {bridgeId?, replyTo?, buttons?})  // outbound (notifier hook)
agent.pruneSessions()                                          // manual eviction
```

### `MessagingBridge` interface

```ts
interface MessagingBridge {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendReply({chatId, replyTo?, text, buttons?}): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}
```

Substrate ships `InMemoryBridge` (testing).  TelegramBridge,
SignalBridge, MatrixBridge follow the same shape (deferred — needs
real-bot test environment).

### Events

`ChatAgent` extends Node's `EventEmitter`:

| Event | Payload | When |
|---|---|---|
| `tool-call` | `{chatId, member, tool, args, result}` | each successful tool dispatch |
| `reply` | `{chatId, member, text}` | each free-text or composed reply posted |
| `error` | `{chatId, error}` | bridge / LLM / handler failure |

---

## Architecture

```
incoming msg → bridge.onMessage → ChatAgent
                                      │
                                      ▼
                          [SessionManager — get or create
                           session for chatId; build NL
                           context via contextBuilder once]
                                      │
                                      ▼
                          [LlmClient.invoke — system + history + tools]
                                      │
                                      ▼
                          [tool dispatcher — handles single + multi tool_calls;
                           routes to toolHandlers[id]]
                                      │
                                      ▼
                          [combine handler replies + LLM replyText →
                           bridge.sendReply]
```

Per H2 V2 reframe: **no regex fast path**.  Chat is always
LLM-mediated.  Apps that want command shortcuts can pre-filter on
the bridge or match-and-route inside their tool handlers.

---

## Session lifecycle

- Each chatId gets its own `Session`: rolling history buffer
  (default depth 10), member webid + display name, NL context
  snapshot built at session start.
- TTL eviction (default 30 min of inactivity).  Next message after
  expiry rebuilds the session — incl. a fresh `contextBuilder`
  call.
- In-memory only; restart-survival is V1+ (per L1c sketch's open
  question).

---

## Tool dispatch

- LLM result with `toolCalls: []` (multi) or `toolCall: {}` (single)
  → substrate dispatches each in order.
- Each handler runs `(args, ctx)` where `ctx = {chatId, actorWebid,
  actorDisplayName, bridgeId, agent}`.
- Handler returns `{reply?: string, data?: object}`.
  - `reply` is concatenated into the user-facing message.
  - `data` flows into the `tool-call` event for downstream consumers
    (notifier, audit, etc.).
- Handler errors emit the `error` event but don't crash the agent.
- Unknown tool ids emit `error` and skip.

---

## Pattern source

Generalised from `apps/household/src/{HouseholdAgent.js,
bridges/TelegramBridge.js, skills/classifyAndExtract.js,
llm/prompts.js}`.

Differences from the H2 V0 implementation:

- **No regex fast path** (per V2 reframe).
- **Sessions** instead of stateless dispatch (per V2 reframe).
- **NL context loading** at session start (per V2 reframe).
- **Bulk tool dispatch** via toolCalls[].
- **Generic toolHandlers map** instead of a fixed SKILL_REGISTRY.

---

## Out of scope for V0

- Regex command shortcuts (apps can layer this on if they want).
- Streaming LLM responses.
- Cross-bridge message routing.
- Restart-survival of session state.
- Concurrent-LLM-call queuing (Ollama serialises naturally).

---

## See also

- `Project Files/Substrates/L1c-chat-agent.md` — substrate sketch.
- `@onderling/llm-client` — the LLM provider abstraction this consumes.
- `@onderling/notifier` — paired substrate; subscribes to `tool-call` events.
- `Project Files/Substrates/apps/H2-household.md` — primary consumer.
