# Testing the household app

The household app has three concentric test rings.  The default one
(unit + e2e against mocks) runs fully offline and gates every commit.
The outer two (real Telegram, real LLM, real pod) are explicit
opt-ins so you can validate end-to-end against real services without
breaking CI.

```
        ┌────────────────────────────────┐
        │  outer: real Telegram          │  ←  HOUSEHOLD_TEST_REAL_TG=1
        │  ┌──────────────────────────┐  │
        │  │  middle: real LLM        │  │  ←  HOUSEHOLD_TEST_REAL_LLM=1
        │  │  ┌────────────────────┐  │  │
        │  │  │  inner: mocks only │  │  │  ←  default — runs in CI
        │  │  └────────────────────┘  │  │
        │  └──────────────────────────┘  │
        └────────────────────────────────┘
```

This file has the recipes for each ring.

---

## Inner ring — unit + e2e against mocks (the default)

Runs offline.  No real Telegram, no real Ollama, no real Solid pod.
This is what `npm test` runs.

```bash
npm install --prefix apps/household
npm test    --prefix apps/household
```

### Coverage at a glance (as of Phase 3)

- **bridges/** — `MockBridge` (test seam) + `TelegramBridge` against
  a fake telegraf instance injected via the constructor.
- **parsers/** — table-driven tests across the locked grammar
  (English + Dutch, all type aliases, multi-item, quoted strings,
  edge cases).
- **storage/** — `InMemoryStore` round-trip + each `Store` method.
- **pods/** — `HouseholdPod` / `BotPod` / `MemberPod` against an
  inline `MockPodClient` that simulates `read` / `write` / `list` /
  `delete` in memory.  `routingTable` lock test.
- **identity/** — `BotIdentity` + `AdminCapability` over `VaultMemory`,
  no real keys persist.
- **scheduler/** — `NudgeTimer` / `DailyDigest` / `CronLite` /
  `Scheduler` with `vi.useFakeTimers()`.
- **llm/** — `parseOpenAIChatResponse` + `parseLooseToolCall` +
  Ollama provider wiring with a fake `fetch`.
- **skills/** — every skill against `InMemoryStore`.
- **e2e/** — five integration tests:
  - `round-trip.test.js` — bridge → agent → regex → skill → store
  - `hybrid-roundtrip.test.js` — same against the hybrid pod stack
  - `scheduler-roundtrip.test.js` — nudge + digest with fake timers
  - `llm-roundtrip.test.js` — hybrid routing + scripted LLM responses

### When something fails

The full output is more readable with vitest's filter:

```bash
# Just one test file
npx vitest run apps/household/test/e2e/llm-roundtrip.test.js

# Just one test by name
npx vitest run -t "regex-matched commands skip the LLM"

# Watch mode while iterating
npm run test:watch --prefix apps/household
```

---

## Middle ring — real LLM (Ollama / OpenAI / Anthropic)

Runs the LLM slow path against a real model.  Useful for:

- Tuning prompts (does this prompt make qwen2.5:3b extract reliably?).
- Quality-bar checking (Q-H2.9: 50 real chat lines → ≥90% precision /
  ≥80% recall on shopping extraction).
- Confirming a new model swap doesn't regress.

### Setup — local Ollama (default)

1. Install Ollama: https://ollama.com (~100 MB binary on macOS / Linux).
2. Pull the v0 model (default is `qwen2.5:3b-instruct`):
   ```bash
   ollama pull qwen2.5:3b-instruct
   ```
3. Start the server:
   ```bash
   ollama serve
   # (it binds 127.0.0.1:11434 by default)
   ```
4. Sanity check it works:
   ```bash
   curl http://127.0.0.1:11434/v1/chat/completions \
     -H 'content-type: application/json' \
     -d '{"model":"qwen2.5:3b-instruct","messages":[{"role":"user","content":"hello"}]}'
   ```

### Setup — cloud opt-in (privacy warning)

Q-H2.12 lock: cloud is opt-in only with a visible warning.  Set the
provider via env:

```bash
export HOUSEHOLD_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
# OR
export HOUSEHOLD_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

The CLI prints a startup warning when a cloud provider is active.

### Running real-LLM tests

There aren't dedicated `*.real-llm.test.js` files yet (Phase 3 ships
mock-only).  To validate against a real provider, write a one-off
script:

```js
// apps/household/scripts/llm-smoke.js
import { LlmClient }      from '../src/llm/LlmClient.js';
import { ollamaProvider } from '../src/llm/providers/ollama.js';
import { SYSTEM_PROMPT_CLASSIFY } from '../src/llm/prompts.js';
import { V0_TOOL_CATALOGUE }        from '../src/skills/classifyAndExtract.js';

const llm = new LlmClient({ provider: ollamaProvider() });

const samples = [
  'we need bread',
  'we kunnen wat melk gebruiken',
  'who left the lights on?',                 // expect noise
  'I bought groceries',                      // expect markComplete
  'someone please pick up dry cleaning',     // expect addItem errand
];

for (const s of samples) {
  const r = await llm.invoke({
    system:   SYSTEM_PROMPT_CLASSIFY,
    messages: [{ role: 'user', content: s }],
    tools:    V0_TOOL_CATALOGUE,
  });
  console.log(s, '→', r.toolCall ?? r.classification ?? r.replyText);
}
```

Run with:

```bash
node apps/household/scripts/llm-smoke.js
```

For the formal Q-H2.9 quality-bar test (50 real chat messages →
precision/recall): same shape, but read messages from a JSON fixture
and compare the LLM's output to a hand-labelled ground truth.  Phase
5 promotes this to a formal harness if model swaps need it.

### Quality-bar fixture format (Phase 5)

```json
[
  { "text": "we need bread",
    "expected": { "skillId": "addItem", "args": { "type": "shopping", "text": "bread" } } },
  { "text": "haha that's funny",
    "expected": { "classification": "noise" } },
  { "text": "did anyone pick up the kids?",
    "expected": { "classification": "noise" } }
]
```

Precision = (correct extractions / total LLM-classified-as-actionable).
Recall    = (correct extractions / total ground-truth-actionable).

### Provider swap during testing

Edit the entry-point (or set env, when Phase 5 ships the CLI flag):

```js
// Local default
const llm = new LlmClient({ provider: ollamaProvider({ model: 'qwen2.5:3b-instruct' }) });

// Switch to a 7B model on the same Ollama
const llm = new LlmClient({ provider: ollamaProvider({ model: 'qwen2.5:7b-instruct' }) });

// Switch to OpenAI for the slow path (privacy warning applies)
const llm = new LlmClient({ provider: openaiProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' }) });

// Switch to Anthropic
const llm = new LlmClient({ provider: anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }) });
```

The skills + the agent don't change; only the provider wiring does.

---

## Outer ring — real Telegram

Runs against a live Telegram bot.  Useful for:

- Confirming the bot framework choice + addressed-only filter behave
  as expected on real-world chat.
- Smoke-testing webhook + long-polling deployment shapes.
- "Does this actually feel good in a real household?" UX validation.

### Setup — register a test bot

1. In Telegram, DM `@BotFather`, run `/newbot`, follow the prompts.
2. Save the **bot token** that BotFather returns.  Treat it like a
   password.
3. Add the bot to a test chat (a private chat or a small group you
   control).  In group chats, the bot's "privacy mode" defaults to
   ON, so it only sees `@<botusername>`-mentions and replies-to-bot.

### Running locally with long-polling

```bash
export HOUSEHOLD_TG_BOT_TOKEN=...      # from BotFather
export HOUSEHOLD_TG_MODE=long-polling   # default
# Optional — set the bot's @-handle so the addressed filter doesn't
# need an extra API round-trip to discover it:
export HOUSEHOLD_TG_USERNAME=YourTestBot

# Run a small smoke harness
node apps/household/scripts/tg-smoke.js
```

(Phase 5 wires `household serve` to read these env vars.  Until
then, write a one-off script that constructs a `TelegramBridge` +
`HouseholdAgent` + `InMemoryStore` and calls `agent.start()`.)

### Webhook mode

Webhook needs a public HTTPS endpoint Telegram can POST to.
Options for testing:
- ngrok / cloudflared tunnel pointing at your local agent.
- A small VPS.

Set:

```bash
export HOUSEHOLD_TG_MODE=webhook
export HOUSEHOLD_TG_WEBHOOK_URL=https://your-domain/tg
export HOUSEHOLD_TG_PORT=3000
```

The TelegramBridge handles the rest.  Telegraf calls
`bot.telegram.setWebhook(url)` at start.

### Test chat checklist

Once the agent is running and the bot is in a chat:

- `@YourTestBot help` → bot prints the command list.
- `@YourTestBot add shopping bread` → `✓ added to shopping: bread`.
- `@YourTestBot list shopping` → list with the item.
- `@YourTestBot done bread` → marked complete.
- `@YourTestBot wat hebben we nodig?` (Dutch) → list of open shopping.
- (with LLM wired) `@YourTestBot we should pick up some milk` → LLM
  routes to `addItem({type: 'shopping', text: 'milk'})`.

---

## Pod-side testing — real Solid pod

Runs the hybrid-pod stack against a real Solid pod.  Useful for the
Phase 2 "first-of-kind" validation and any time you suspect the
mock pod is too forgiving.

### Setup

1. Get a pod URL.  Options:
   - **Inrupt-hosted** (https://signin.inrupt.com) — most polished.
   - **CommunitySolidServer** locally (`npx @solid/community-server`).

2. Authenticate.  V0 of household runs server-side and uses
   `@onderling/pod-client`'s `SolidOidcAuth` (same primitive Folio
   uses).  Configure in the agent's `init` step (Phase 5).

3. Set env to opt in:

   ```bash
   export HOUSEHOLD_TEST_REAL_POD=1
   export HOUSEHOLD_POD_URL=https://your-pod.example/household/
   ```

4. Run the integration test (Phase 5 ships a real-pod harness; until
   then, write a one-off node script that constructs `HouseholdPod`
   + `BotPod` + `MemberPod` against a real `PodClient`).

### What to check on first run

- Bot identity persists (restart agent → bot's keypair survives).
- Capability tokens for admins verify after the bot's pod is set up.
- Adding a shopping item via `@household add shopping bread` lands
  at `<pod>/groceries/open/<ulid>.json` — verify in the Inrupt pod
  browser.
- Marking complete moves to `<pod>/groceries/done/yyyy-mm/<ulid>.json`.
- 412 / NOT_FOUND errors during `ensure-container` — those are
  noise (already documented in `HYBRID-POD-NOTES.md`); sync continues.

Document anything surprising in `HYBRID-POD-NOTES.md` — that file is
the trap-by-trap walkthrough for future pod-on-RN work too.

---

## CI matrix (planned, Phase 5)

```
GitHub Actions / npm-test:
  - apps/household: inner ring only       (default)
  - apps/folio:     full suite            (default)
  - apps/archive:   full suite            (default)

Manual / nightly (Phase 5):
  - HOUSEHOLD_TEST_REAL_LLM=1 + Ollama-on-runner
    (verifies prompts haven't regressed against the locked model)
```

The outer-ring tests stay user-attended for v0.  CI promoting them
needs (a) a non-leaky way to share a Telegram bot token and (b) a
real-pod sandbox account — both are deployment decisions.

---

## Reading order if you've never touched this codebase

1. `apps/household/README.md` — quick orientation.
2. `Project Files/projects/07-household-app/implementation-plan.md`
   — phase-by-phase what's been built.
3. `Project Files/projects/07-household-app/programming-plan.md` —
   per-module contracts.
4. **This file** — how to actually run the thing.
5. `apps/household/docs/HYBRID-POD-NOTES.md` — fence-post warnings
   for hybrid-pod work.
6. `Project Files/coding-plans/track-H-app-household.md` — the
   full design doc with Q-H2.1–14 locks.
