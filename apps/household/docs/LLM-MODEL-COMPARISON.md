# LLM Model Comparison — H2 Household Agent

**Date:** 2026-05-01
**Test harness:** `apps/household/scripts/llm-smoke.js`
**Prompt:** v3 (`apps/household/src/llm/prompts.js`, PROMPT_VERSION = 3)
**Fixtures:** 18 hand-labelled prompts (English + Dutch, mix of shopping / errand / repair / listOpen / markComplete / noise)
**Provider:** Ollama, local

## Final scoreboard

| Model                          | Size    | Score      | Tool-calls API | Noise handling | Hallucinations |
|--------------------------------|---------|------------|----------------|----------------|----------------|
| **qwen2.5:3b-instruct** (prod) | 1.9 GB  | **89%** (16/18) | ✅            | ✅             | none observed  |
| qwen2.5:7b-instruct            | 4.7 GB  | 78% (14/18) | ✅            | ✅             | none observed  |
| llama3.2:3b                    | 2.0 GB  | 50% (9/18)  | ✅            | ✗              | yes            |
| phi4-mini                      | 2.5 GB  | 22% (4/18)  | ✗ (text form) | partial        | mild           |
| phi3.5:latest                  | 2.2 GB  | —           | ✗ (rejected at API) | —        | —              |

## What each model gets wrong

### qwen2.5:3b-instruct — production winner
- 16/18 stable across 3 variance-check runs (16/16/17).
- Both misses are edge cases at the shopping/errand boundary or markComplete vs addItem.
- Fast (32s for 18 fixtures on local hardware), tiny memory footprint.

### qwen2.5:7b-instruct — bigger ≠ better
- Greetings/noise handling slightly improved over 3B.
- BUT introduced tool-call corruption: emits `olithOpen({"type":"repair"})` as plain text in the message body instead of a structured tool_calls field.
- Over-applies "pick up = errand" heuristic.
- Larger memory cost, slower, and worse on the bottom line.

### llama3.2:3b — broken noise category
- Uses the structured tool_calls API correctly (unlike phi4-mini).
- Most shopping/errand/repair extractions land cleanly.
- BUT noise-category collapses entirely:
  - `haha that is funny` → listOpen(shopping)
  - `who left the lights on?` → listOpen(errand)
  - `good morning everyone` → emits `"noise"` as a tool *name* (wrong format)
  - `goedemorgen` → help
- Hallucinates content not in the input:
  - `the kitchen tap is broken` → `addItem(text="de tap is kapots")` (mixed Dutch/English nonsense)
  - `what do we need at the supermarket?` → `addItem(text="we need bread")` (invented a grocery item)

### phi4-mini — broken tool-calls protocol
- Understands the task. Many extractions are semantically correct.
- BUT emits tool calls as **text in the message body** rather than via the structured tool_calls API:
  ```
  IN:  we need bread
  got: [reply] addItem({ type: "shopping", text: "bread" })  ✗
  ```
- Ollama's wire-protocol bridge for phi4-mini does not translate these to tool_calls.
- Adding a parser for text-form tool calls would be a brittle special-case AND wouldn't fix:
  - `kan iemand de afwas doen` → noise (should be errand)
  - `what do we need at the supermarket?` → noise (should be listOpen)
  - `I bought bread` → addItem (should be markComplete)

### phi3.5:latest — no tool support
- Ollama returns 400 for every call: `registry.ollama.ai/library/phi3.5:latest does not support tools`.
- Microsoft never trained Phi-3.5 for OpenAI-style structured tool calls. Would require prompt-based JSON extraction → different test setup, deviates from production.
- Eliminated as a candidate at the API layer.

## Lessons

1. **Tool-calling protocol support is binary.** Models either implement the OpenAI tools API correctly (qwen2.5, llama3.2) or they don't (phi3.5, phi4-mini). Size and benchmark scores don't predict this.
2. **Bigger models within the same family aren't automatically better.** qwen2.5:7b regressed vs qwen2.5:3b on this task, likely because the smaller model is more conservative.
3. **Noise/refusal training varies wildly across families.** qwen2.5 nailed it; llama3.2 catastrophically over-classifies; phi4-mini under-classifies.
4. **Hallucination matters at this scale.** llama3.2 invented Dutch text that wasn't in the input. Tiny models with weaker grounding will fabricate; tiny models with stronger grounding (qwen2.5) won't.
5. **Prompt-engineering plateaus quickly.** Earlier in the session, prompt v1 → v2 → v3 bought 22 percentage points; v3 → v4 lost 6. Beyond v3 the marginal returns are negative.
6. **Adding new tools to the catalogue reshuffles the whole decision space.** The askClarification experiment dropped qwen2.5:3b from 89% → 45-59% across 3 runs WITHOUT any prompt change, just by adding one extra tool. Catalogue growth is overtraining-equivalent.

## Production setting

- **Provider:** Ollama (local)
- **Model:** `qwen2.5:3b-instruct`
- **Prompt:** v3 (in `prompts.js`, PROMPT_VERSION = 3)
- **Tool catalogue:** 5 tools (`addItem`, `listOpen`, `markComplete`, `removeItem`, `help`) — see `V0_TOOL_CATALOGUE` in `classifyAndExtract.js`
- **Smoke baseline:** 16-17/18 (89-94%) across multiple runs

## Reproducing

```bash
# Default (qwen2.5:3b)
npm run llm-smoke --prefix apps/household

# Other models — pull first, then override
ollama pull qwen2.5:7b-instruct
HOUSEHOLD_LLM_MODEL=qwen2.5:7b-instruct npm run llm-smoke --prefix apps/household

ollama pull llama3.2:3b
HOUSEHOLD_LLM_MODEL=llama3.2:3b npm run llm-smoke --prefix apps/household

ollama pull phi4-mini
HOUSEHOLD_LLM_MODEL=phi4-mini npm run llm-smoke --prefix apps/household
```

## Future work

- If qwen2.5:3b's 89% becomes insufficient, candidates worth trying next:
  - `qwen3:4b` — newer Qwen, may have improved structured-output.
  - `mistral:7b-instruct-v0.3` — different family, native tool support.
  - `phi4-mini-tools` (if/when published) — a tool-calling-fine-tuned variant of phi4-mini.
- The 11% miss rate on qwen2.5:3b clusters around shopping/errand boundary and markComplete vs addItem. If this needs tightening, a regex pre-filter for the most common markComplete phrases ("I bought", "I got", "X is done") may be more robust than further LLM prompt tuning.
