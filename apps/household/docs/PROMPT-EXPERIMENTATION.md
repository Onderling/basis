# Prompt experimentation — playbook

How to play with the household bot's behaviour without breaking the
production code path.  Three levers, fast iteration loop, a
`tg-freetext.js` sandbox script that lets you run alternative
prompt + tool-catalogue combinations against a real Telegram bot.

---

## The three levers

### Lever 1 — System prompt (biggest impact)

**File**: `apps/household/src/llm/prompts.js`

Currently has `SYSTEM_PROMPT_CLASSIFY` (~line 25), written for the
"pick a tool / classify noise" framing.  Edit in place, or add a new
constant alongside and switch which one gets imported.

The smoke harness imports `SYSTEM_PROMPT_CLASSIFY` directly, so just
editing the constant gives you immediate effect on the next
`llm-smoke` run.

**What to play with:**
- **Persona** — "you are a friendly household assistant" vs "you are
  a precise tool-call classifier".  Big behavioural lever.
- **Output framing** — "respond conversationally, *also* call tools
  when needed" vs "your job is to extract and pick a tool."  This
  controls whether the model leans free-text or tool-shaped.
- **Language** — "respond in Dutch" / "match the user's language" /
  examples in target language.  Small models often need explicit
  language instruction.
- **Few-shot examples** — small models (3B) benefit from 2-3 worked
  examples in the prompt much more than large models.

**Tip**: bump `PROMPT_VERSION` (~line 9) when you change the prompt
materially.  The audit layer hashes by version, so you'll see
old-vs-new entries cleanly in audit logs.

### Lever 2 — Tool catalogue

**File**: `apps/household/src/skills/classifyAndExtract.js`

`V0_TOOL_CATALOGUE` (~line 26) is a hand-built array of 5 tools
(`addItem`, `listOpen`, `markComplete`, `removeItem`, `help`).  Each
has `id`, `description`, `schema`.

**What to play with:**
- **Drop tools entirely** for pure free-text mode.  Just
  `export const V0_TOOL_CATALOGUE = [];`.  See whether the bare model
  + good prompt outperforms the constrained tool-pick framing.
- **Drop just `listOpen`** to see if removing the easily-confused
  "list vs add" choice helps Dutch / questioning phrasings.
- **Tweak descriptions** — wording matters a lot.
  "Add a new open item" vs "Use this when the user asks to add
  something to a shopping/errand/repair/schedule list" can swing
  behaviour considerably.
- **Add new tools** — e.g. `chitchat` (a no-op that lets the LLM
  acknowledge non-actionable messages explicitly instead of guessing
  noise).  Models often misclassify when given a binary choice
  between "tool call" and "noise" with no middle.

### Lever 3 — Reply rendering

**File**: `packages/chat-agent/src/ChatAgent.js`

Two places shape how replies become Telegram messages:

- **`#dispatchToolCalls`** (~line 254) — collects per-tool reply
  shapes (`{reply}` / `{replies: []}`) into the master `replies[]`
  array.
- **`#onMessage`** (~line 220) — sends each item in `replies[]` as
  its own bridge message.

**Today's behaviour**: every tool's reply lands as a separate
Telegram message + the LLM's `replyText` is appended at the end.

**Free-text mode** wants the opposite shape: `replyText` is
*primary* (the user-visible message), tool calls execute silently
with no reply text or get a tiny acknowledgement merged into one
line.

The simplest way to switch: have your tool handlers return
`{ data: ... }` with **no** `reply` / `replies` field.  ChatAgent
won't push anything from those handlers — only the LLM's
`replyText` ends up as the user-visible message.  This is exactly
what `tg-freetext.js` does (see below).

If you want global rendering changes (suppressing tool acks,
combining replies, re-ordering), edit in-place and the substrate
tests will tell you when something's off.

---

## Fast iteration loop

```bash
# 1. Edit one lever (prompt / catalogue / rendering)

# 2. Run the smoke against a warm Ollama (~30s with model loaded)
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run llm-smoke --prefix apps/household

# 3. Read the actual LLM output in the table — exactly what the
#    model emitted vs what was expected.

# 4. Iterate.  Add fixtures to apps/household/scripts/llm-smoke.js
#    (~line 58) for cases you care about — Dutch phrasing, edge
#    cases, etc.
```

For reply-rendering / live-feel experiments, run the bot itself:

```bash
export HOUSEHOLD_TG_BOT_TOKEN=...
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run tg-smoke --prefix apps/household
```

…and DM the bot.

---

## Practical hygiene

Before you start mutating prompts:

- **Keep a baseline.**  Add a `SYSTEM_PROMPT_CLASSIFY_v3_baseline`
  constant next to your edited version — one-line swap to A/B
  compare when an experiment makes things worse.
- Same for the tool catalogue: `V0_TOOL_CATALOGUE_baseline`.
- Bump `PROMPT_VERSION` when you commit a new candidate.  Audit
  layer hashes by version so you can attribute live behaviour to
  the prompt that produced it.

The smoke harness is forgiving — it scores against hand-labelled
fixtures, so a regression on one fixture is normal during iteration.
What you're looking for is the *aggregate* pass rate trend.

---

## How the two bots share the substrate (with filenames)

Two distinct bots live in this codebase — the production household bot
and the free-text experiment.  They share substrate code but each has
its own **system prompt**, **tool catalogue**, and **storage**.

```
              PRODUCTION                              EXPERIMENT
              ──────────                              ──────────

apps/household/src/cli.js                  apps/household/scripts/
        │                                  tg-freetext.js
        ▼                                          │
┌────────────────────────────┐                     │
│ apps/household/src/        │                     │
│   HouseholdAgent.js        │                     │
│   - regex fast path        │                     │
│   - LLM slow path          │                     │
│     (delegates to ChatAgent│                     │
│      in headless mode)     │                     │
└─────┬───────────────┬──────┘                     │
      │               │                            │
      ▼               ▼                            ▼
catalogue used:                            catalogue used:
V0_TOOL_CATALOGUE                          TOOL_CATALOGUE (inline)
= [addItem, listOpen,                    = [addToList,
   markComplete,                            removeFromList,
   removeItem, help]                        showList]
defined in:                              defined in:
apps/household/src/skills/               apps/household/scripts/
  classifyAndExtract.js                    tg-freetext.js
                                           (top of file)

system prompt:                           system prompt:
SYSTEM_PROMPT_CLASSIFY                   inline (free-text +
defined in:                              tool-as-side-effect)
apps/household/src/llm/                  defined in:
  prompts.js                             apps/household/scripts/
                                           tg-freetext.js

handlers:                                handlers:
the 5 skills/*.js wrapped via            inline functions that
apps/household/src/llm/                  mutate a Map<list, items[]>
  chatAgentBridge.js                     in the script itself

storage:                                 storage:
apps/household/src/storage/              Map<string, string[]>
  InMemoryStore.js                       (lives in script process,
(adapter over @onderling/                  vanishes on restart)
  item-store substrate)


              ─────── BOTH ROUTE THROUGH ───────

           ┌────────────────────────────────────────────┐
           │  @onderling/chat-agent  (substrate L1c)     │
           │  packages/chat-agent/src/ChatAgent.js      │
           │                                            │
           │  ChatAgent.processMessage(msg) →           │
           │   1. get/create per-chat session           │
           │   2. build context (contextBuilder hook)   │
           │   3. call LLM with toolCatalogue             │
           │   4. dispatch returned tool_calls to       │
           │      registered toolHandlers               │
           │   5. return {replies, toolResults}         │
           └────────────────────┬───────────────────────┘
                                │
                                ▼
           ┌────────────────────────────────────────────┐
           │  @onderling/llm-client  (substrate L1j)     │
           │  packages/llm-client/src/LlmClient.js      │
           │  + providers/ollama.js                     │
           │  + providers/openai.js                     │
           │  + providers/anthropic.js                  │
           │  + parseLooseToolCall  (recovers tool      │
           │     calls emitted as text — currently      │
           │     JSON only; v0.2.0 will add JS-call     │
           │     syntax recognition)                    │
           └────────────────────┬───────────────────────┘
                                │
                                ▼
                    Ollama / OpenAI / Anthropic
                    (qwen / mistral / geitje / phi / …)


              ─────── TELEGRAM I/O (BOTH USE) ───────

           ┌────────────────────────────────────────────┐
           │  TelegramBridge                            │
           │  packages/chat-agent/src/bridges/          │
           │    TelegramBridge.js                       │
           │                                            │
           │  text-in:    ctx.message → IncomingMessage │
           │  button-tap: callback_query →              │
           │              IncomingMessage with          │
           │              text = button.id              │
           │  reply-out:  bridge.sendReply({chatId,     │
           │              text, buttons}) →             │
           │              telegraf reply +              │
           │              inline keyboard               │
           └────────────────────┬───────────────────────┘
                                │
                                ▼
                          Telegram bot API
                                │
                                ▼
                        User's Telegram chat
```

### Reading guide

- The two bots **never share state at runtime**.  The production bot
  uses its own store (production `Store`); the experiment uses its
  own in-script `Map`.  Running both at once with the same bot token
  would conflict at the Telegram side, but their internal worlds
  are independent.
- The substrate boxes (`@onderling/chat-agent`, `@onderling/llm-client`,
  `TelegramBridge`) are the same code paths in both flows.  Bug
  fixes there benefit both.
- A `[tool] X(...)` line in the terminal means the substrate's
  dispatcher actually called handler `X`.  No `[tool]` line + tool-
  shaped text in a `[reply ...]` line means the LLM emitted the call
  as text and the parser missed it (model issue + parser-fix
  candidate).
- The experiment's silent-execution trick: each handler returns
  \`{ data: ... }\` with no \`reply\` field.  The substrate's
  reply-render code only forwards the LLM's free-text \`replyText\`
  to Telegram in that case, so structured operations don't bloat the
  chat with system-style "added X" / "removed Y" messages — the LLM
  composes the natural reply itself.  \`showList\` is the exception:
  it returns \`{reply: {text, buttons}}\` because that's the whole
  point.

---

## Testing in the terminal — `cli-freetext.js`

Going through Telegram for every iteration is slow.  The terminal
REPL gives the same conversation flow with the same prompt, tools,
and store — minus the network round-trip.

**Three modes:**

```bash
# 1. Interactive REPL (most common while iterating)
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run cli-freetext --prefix apps/household

# 2. One-shot — process a single message and exit
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run cli-freetext --prefix apps/household -- "voeg melk toe aan boodschappen"

# 3. Batch — run a JSON array of messages in order
echo '["voeg melk toe","wat staat er op boodschappen","ik heb melk"]' > /tmp/fix.json
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run cli-freetext --prefix apps/household -- --fixtures /tmp/fix.json
```

**REPL commands:**
- Type any message → bot responds.
- `/tap N` → simulates tapping the Nth button from the bot's most
  recent reply.
- `/quit` → exit.

**What you see:**

```
> voeg melk en brood toe aan boodschappen
[tool] addToList(boodschappen, melk)
[tool] addToList(boodschappen, brood)
[bot] Toegevoegd: melk en brood.

> wat staat er op boodschappen
[tool] showList(boodschappen) → 2 item(s)
[bot] 📋 boodschappen:
      • melk
      • brood

      _Tap een item om af te vinken._
      [buttons]
         1. ✓ melk                   (id: "ik heb melk van boodschappen")
         2. ✓ brood                  (id: "ik heb brood van boodschappen")
        (type "/tap N" to simulate a tap, or paste any id)

> /tap 1
[tap] ✓ melk → "ik heb melk van boodschappen"
[tool] removeFromList(boodschappen, ik heb melk van boodschappen) → melk
[bot] ✓ verwijderd: melk

      📋 boodschappen (resterend):
      • brood
      [buttons]
         1. ✓ brood                  (id: "ik heb brood van boodschappen")
```

The REPL uses **`InMemoryBridge`** (instead of `TelegramBridge`),
so everything runs in-process — typically 1–3 seconds per turn vs
the 5–15s of a real Telegram round-trip.

The `lib/freetext-core.js` module is the single source of truth for
the system prompt, tool catalogue, store, handlers, and context
builder.  Both `tg-freetext.js` and `cli-freetext.js` import from
it, so editing the prompt or catalogue there updates both bots.

---

## Multi-model smoke (`freetext-smoke.js`)

Runs hand-written multi-turn conversation fixtures across several
models, scoring each turn against expectations.  Useful for picking
which model wins for the free-text + clickable-list workflow before
committing to it in the live bot.

```bash
# LITE — fast first impression.  ~5 fixtures × 1 fast model (qwen2.5:3b).
#  ~30–60s total.  Use this while iterating on the prompt or the
#  smoke harness itself.
npm run freetext-smoke-lite --prefix apps/household

# FULL — all 19 fixtures on 3 local 7B models.  ~10–20 min total.
npm run freetext-smoke --prefix apps/household

# Custom model set (comma-separated):
HOUSEHOLD_LLM_MODELS=qwen2.5:3b-instruct,qwen2.5:7b-instruct \
  npm run freetext-smoke --prefix apps/household

# Filter to a single fixture (substring match on name):
HOUSEHOLD_SMOKE_FILTER=remove \
  npm run freetext-smoke --prefix apps/household
```

**The lite subset** covers the four core capabilities + one
multi-turn workflow:

1. `add 3 items (direct phrasing)` — basic add
2. `show list (toon de …)` — basic show
3. `remove via "ik heb X"` — basic remove
4. `chitchat (hoi)` — should NOT trigger any tool
5. `workflow: show → tap → confirm` — the button-tap round-trip

**Fixture set** (8 conversations, ~25 turns total — inspired by real
REPL/TG sessions):

1. `add → show → remove → show` — basic happy path.
2. `multi-list management` — boodschappen + klusjes side by side.
3. `no-translate (boodschappen ≠ shopping)` — catches the
   translation-bug we saw with mistral.
4. `list-view phrasings` — multiple Dutch ways to say "show".
5. `remove via natural-language` — "ik heb X" / "X is klaar".
6. `button-tap simulation` — "ik heb X van Y" arriving as a tap.
7. `chitchat does not trigger tools` — greetings, weather.
8. `robust to typos` — "bwananen" must round-trip verbatim.

**What's checked per turn:**

- Right tool ids fired (multiset — `addToList × 3` means 3 calls).
- Right primary args present (item / match values, case-insensitive).
- Strict listName matching (catches `boodschappen` ↔ `shopping`
  translation bugs).
- `hasButtons` for showList turns.
- `replyContains` for substring/regex checks (e.g. typo round-trip).
- No unexpected extra tool calls (unless `allowExtraTools: true`).

**Output:**

```
=== qwen2.5:7b-instruct ===

[add → show → remove → show]
  ✓ Wil je een boodschappenlijst bijhouden met kaas, boter en p…  (4.2s)
      calls: addToList(listName="boodschappen", item="kaas"), addToList(…), …
  ✓ Wat staat er op de boodschappenlijst?  (3.1s)
  ✗ ik heb kaas van boodschappen  (3.5s)
      reason: removeFromList missing arg "kaas" (got: [—])
      calls:
  …
  → 3/4 turns (75%)

…

=== Summary ===

  qwen2.5:7b-instruct                    23/25 (92%)
  mistral:7b-instruct                    14/25 (56%)
  bramvanroy/geitje-7b-ultra:Q4_K_M       8/25 (32%)
```

(Numbers fictional — your run will tell us reality.)

This makes model-comparison fast: edit the prompt in
`lib/freetext-core.js`, run the smoke, see which model handles the
new prompt best.

Both the REPL and the live TG bot emit the same log markers.  Use
them to tell whether the LLM actually invoked a tool or merely
text-rendered tool-shaped output.

| Marker (in terminal) | Meaning |
|---|---|
| `[user <name> chatId=…] <text>` | Incoming message — what the user typed (or what a button-tap synthesised) |
| `[tool] addToList(boodschappen, melk)` | A real tool handler **executed**.  The LLM emitted a structured `tool_call`, the substrate's dispatcher matched it, and the handler ran.  This is what you want. |
| `[tool] showList(boodschappen) → 2 item(s)` | Same as above, with a result-summary appended by the handler.  Real call, real button keyboard going out. |
| `[reply chatId=…] <text>` | Bot sent a text reply via the bridge.  This fires for both LLM free-text replies AND tool handler `reply.text` outputs. |
| `[agent.error] <message>` | ChatAgent caught an error somewhere — bridge mismatch, LLM provider failure, parser failure, etc. |

### Telltale signs

**✓ Real tool call (good):**
```
[user anne] wat staat er op boodschappen
[tool] showList(boodschappen) → 3 item(s)
[reply chatId=…] 📋 boodschappen: …
```
The `[tool] showList(...)` line appears **before** the `[reply …]`.
In Telegram, the reply has tappable buttons.  In the REPL, the
buttons are listed under the reply.

**✗ Faked tool call — text-rendered list (bad):**
```
[user anne] wat staat er op boodschappen
[reply chatId=…] 📋 boodschappen:
                  • melk
                  • brood
```
**No** `[tool] showList(...)` line — the LLM imagined the format and
emitted it as text.  In Telegram, you'd see the rendered text but
**no real buttons** (because no real tool emitted them).  In the
REPL, no `[buttons]` block appears under the reply.

This is the most common failure mode with small models. Fix
options: switch to a more reliable tool-calling model (qwen ≥ 3B),
strengthen the prompt's "never text-render lists" rule, or add a
deterministic intent-router before the LLM.

**✗ Tool call as text in reply (also bad):**
```
[user anne] wat staat er op boodschappen
[reply chatId=…] showList("boodschappen")
```
or
```
[reply chatId=…] {"name": "showList", "arguments": {"listName": "boodschappen"}}
```
The LLM tried to call the tool but emitted JS-call or JSON syntax
in the reply text instead of as a structured `tool_call`.  The
substrate's `parseLooseToolCall` should catch the JSON form (it
does, currently); JS-call form is the v0.2.0 substrate-fix candidate.

**✗ Duplicate tool calls:**
```
[tool] addToList(boodschappen, melk)
[tool] addToList(boodschappen, melk)
[tool] addToList(shopping, melk)
```
LLM is over-eager.  Symptom of weak instruction-following.  Prompt
the model with "Use the EXACT list name; never translate.  Never
call the same tool twice with the same args."  (Already in the
experiment's prompt; mistral 7B still violates it occasionally.)

### Quick triage workflow

1. Type a message in the REPL.
2. Look at the terminal output BEFORE the `[bot]` line:
   - `[tool] X(...)` lines tell you which tools fired.
   - Their absence + a tool-shaped `[bot]` reply = LLM faked it.
3. Look at the `[bot]` reply:
   - Has a `[buttons]` block? → real `showList` ran.
   - Has a markdown list but no `[buttons]` block? → LLM faked it.
4. Iterate on prompt / catalogue in `lib/freetext-core.js` and re-run.

---

## The free-text experiment — `tg-freetext.js`

**File**: `apps/household/scripts/tg-freetext.js`
**npm alias**: `npm run tg-freetext --prefix apps/household`

A standalone Telegram bot that bypasses `HouseholdAgent` entirely.
Wires up `ChatAgent` directly with:

- A **conversational system prompt** designed for natural chat — not
  the classify-and-extract framing.
- A **minimal tool catalogue** (`addToList`, `removeFromList`) that
  supports **arbitrary list names** (not the fixed shopping/errand/
  repair/schedule taxonomy).  Read access is via context-injection
  (the LLM sees current list state in the system prompt) so it
  doesn't need a `getList` tool.
- A small **in-memory list store** (a `Map<string, string[]>`).
  Lists vanish on restart — pod backing is out of scope for this
  experiment.
- **Silent tool execution**: the tool handlers return `{ data: ... }`
  only, no `reply` field — so the LLM's `replyText` is the only
  thing that reaches Telegram.

**To run:**

```bash
export HOUSEHOLD_TG_BOT_TOKEN=<your @BotFather token>
HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
  npm run tg-freetext --prefix apps/household
```

**To iterate on the prompt / tools**: edit
`apps/household/scripts/tg-freetext.js` directly.  Everything is
inline at the top of the file (system prompt, tool catalogue, store,
context builder).  Restart the bot after each edit.

**What to try first:**
- Talk to the bot like you would a human assistant: *"hey, can you
  add bread, milk, and eggs to my shopping list?"*
- Mix lists in one message: *"oh and put 1984 on my book list."*
- Ask without command shape: *"what's on my shopping list?"*  /
  *"wat staat er op de boodschappenlijst?"*
- Test multiple lists: *"can you make a list called 'gifts' for me?"*
  (the LLM should just start using a new list on first add.)
- Test removal phrasings: *"got the bread"* / *"ik heb de melk al"*.
- Test chitchat: *"goedemorgen"* / *"how are you?"*  (should reply
  naturally without calling any tool.)

**Comparing to the production bot**: keep `tg-smoke` available too.
A side-by-side feel test (one bot per Telegram bot token) tells you
quickly which framing wins for which kind of message.

---

## Multilingual support — extension path

This experiment is currently Dutch + English first.  Extending to
German / French / Spanish / etc. touches several layers; here's the
map.

### What's locale-bound today

| Layer | File | What's locale-bound |
|---|---|---|
| **System prompt** | `lib/freetext-core.js` (`SYSTEM_PROMPT`) | Examples, contrast pairs, trigger-word cheat sheet are Dutch + English.  Replies modeled in Dutch. |
| **ContextBuilder** | `lib/freetext-core.js` (`createContextBuilder`) | Output text "Bekende lijsten:" / "(item-inhoud is verborgen…)" is Dutch. |
| **Tool handlers** | `lib/freetext-core.js` (`createToolHandlers`) | User-facing reply text from `removeFromList` (`"🤔 X stond niet op je <list>lijst."`) is Dutch. |
| **NL fallback parser** | `@onderling/llm-client` v0.2.0 (`parseLooseToolCalls`) | Hard-coded Dutch + English regex patterns (`is klaar`, `verwijder`, `is done`). |
| **Default list name** | `parseLooseToolCalls` option | `"boodschappen"` — Dutch-flavoured. |

### Recommended extension shape

For a clean multi-language story, four small refactors are needed.
None are blockers; all are mechanical.

**1. Make the system prompt language-pluggable.**

Today: one `SYSTEM_PROMPT` constant.
Tomorrow: a function `buildSystemPrompt({language: 'nl'|'en'|'de'|...})`
that composes the prompt from per-language fragments:
- Header + tool-description block (could be language-neutral or per-language).
- Per-language example pack (~10 examples, mirroring the Dutch ones).
- Per-language trigger-word cheat sheet.
- Per-language contrast pairs.

A 7B model handles a single-language prompt better than a multi-
language one (less context, less ambiguity).  So pick the user's
language at session start (from the bridge / config) and build a
language-specific system prompt.

**2. ContextBuilder + handler reply text → localisation.**

Replace hard-coded Dutch strings with a tiny localisation table:

```js
const STRINGS = {
  nl: { listsKnown: 'Bekende lijsten', empty: 'is leeg', ... },
  en: { listsKnown: 'Known lists',     empty: 'is empty', ... },
  de: { listsKnown: 'Bekannte Listen', empty: 'ist leer', ... },
};
```

Pass language to `createContextBuilder({store, language})` and
`createToolHandlers({store, language})`.

**3. NL fallback parser → pluggable pattern packs.**

Today's `parseLooseToolCalls` has Dutch + English patterns hard-coded
inside.  Refactor to accept patterns as input:

```js
parseLooseToolCalls(text, {
  descriptors,
  naturalLanguagePatterns: NL_PATTERNS_DE,   // German pack
});
```

Each language ships its own pattern pack:

```js
// patterns-de.js
export const NL_PATTERNS_DE = [
  { regex: /(\w+) ist fertig/gi,   toolId: 'removeFromList', argKey: 'match' },
  { regex: /entferne (\w+)/gi,     toolId: 'removeFromList', argKey: 'match' },
  // ...
];
```

The substrate could ship `de`, `en`, `nl`, `fr`, `es` packs out of
the box; consumers can extend.

**4. Default list name → user-config.**

Drop the hard-coded `"boodschappen"` default.  Either:
- Take from contextBuilder state (most-recently-mentioned list).
- Or take from a per-language default (e.g. `"shopping"` for English, `"Einkaufsliste"` for German).
- Or take from app config.

### What stays the same across languages

- **Tool ids** (`addToList`, `removeFromList`, `showList`) stay
  English — they're internal contract names, not user-facing.
- **JSON shape** stays language-neutral (it's just data).
- **Telegram bridge** is fully language-agnostic.
- **Substrate (chat-agent / llm-client)** stays the same except for
  the patterns refactor in (3).

### Suggested order to ship

1. Patterns refactor in `parseLooseToolCalls` (substrate change,
   purely additive — existing consumers pass nothing and existing
   Dutch + English patterns still apply by default).
2. localisation table for the household app's user-facing text.
3. Per-language prompt builder.
4. Add a second language (German is the obvious next pick — geitje
   doesn't help with German, but Mistral and Qwen support German
   well; we can A/B-compare against Dutch results).

### Why we haven't done this yet

The current experiment is intentionally Dutch-first to stress-test
the contract under a non-English language.  When we reach the V2
production reshape (per `Project Files/Substrates/apps/H2-household.md`),
multi-language support is a natural V1+ extension — not a V0
blocker.

---

## What we learned about model fit (May 2026)

Real numbers from running the lite-3 smoke across model + prompt
combinations.  Recorded here so future experiments don't re-litigate.

| Model | Default prompt | Trimmed prompt + temp 0.1 + stop |
|---|---|---|
| qwen2.5:7b-instruct | 6/6 (100%) | 5/6 (83%) |
| mistral:7b-instruct | 2/6 (33%) | 2/6 (33%) |
| bramvanroy/geitje-7b-ultra:Q4_K_M | 5/6 (83%) | 2/6 (33%) |

### Key findings

1. **Small models need MORE examples, not fewer.**  Trimming the
   prompt by 50% hurt geitje by 50% (5/6 → 2/6) because geitje
   relies on concrete examples to follow the contract.  Without
   them it falls back to "I'll explain instead of act" mode.
2. **The directive prompt with 8+ examples is the sweet spot for
   7B models.**  Going longer would help even more, but you start
   hitting context-window costs.
3. **Mistral 7B is fundamentally unreliable for structured
   output**, even with temperature pinned to 0.1 and stop sequences
   in place.  Observed failures: hallucinating items not mentioned
   by the user, echoing prompt example dialog as if it were chat,
   echoing context-builder output as user-facing reply, calling
   wrong tool for ambiguous Dutch ("ik heb melk" → addToList).
   Tuning more won't fix this; the model lacks the fidelity for the
   workload.  Re-evaluate when newer Mistral variants
   (mistral-nemo-12b, mistral-small-3) become available.
4. **Geitje is workable for Dutch fluency-first deployments** at
   83% on the directive prompt + the auto-fallback (no tool template)
   + loose-parser recovery (parses geitje's JSON-text emissions).
5. **Qwen 2.5 (3B or 7B) is the production answer**: 100% on lite,
   reliable structured emission, native tool-calling.

### Production recommendations

- Default model: **qwen2.5:7b-instruct** (capable + reliable) or
  **qwen2.5:3b-instruct** (faster + same fidelity for this workload).
- Default prompt: **the current `SYSTEM_PROMPT`** (directive style,
  ~3500 tokens, 8+ examples).  `SYSTEM_PROMPT_TRIMMED` is preserved
  for context-pressure cases but should NOT be the default.
- Default LLM options: **none** (use Ollama defaults).  Tuning is
  opt-in via `HOUSEHOLD_LLM_TEMPERATURE` / `HOUSEHOLD_LLM_STOP` env
  vars when investigating a specific model.
- Geitje: usable as an alternative when Dutch fluency dominates;
  deploy with the directive prompt + auto-fallback (already wired).
Mistral 7B: not suitable. Skip for production until a stronger
  variant lands.

---

## When an experiment is worth promoting

The free-text variant earns promotion to production code when:

1. The pass rate on your domain fixtures matches or beats the
   tool-shaped variant on the same model.
2. Real chat feels noticeably better — fewer "huh?" moments, more
   natural Dutch / English replies, better handling of multi-item
   utterances ("add bread and milk").
3. List-state queries ("what's on my shopping list?") are handled
   accurately — depends on the contextBuilder refreshing fast
   enough.

Path forward at that point is the H2 V2 architecture pivot
documented in `Project Files/Substrates/apps/H2-household.md` — drop
regex, all-LLM, multi-session 1:1 DM proper.  The free-text
experiment is essentially the V2 implementation done in a sandbox;
promoting it = wire its system prompt + tool catalogue + reply
rendering into `HouseholdAgent` + delete `parsers/regexCommands.js`
+ `classifyAndExtract.js`.
