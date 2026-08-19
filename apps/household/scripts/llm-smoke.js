#!/usr/bin/env node
/**
 * llm-smoke.js — exercise the LlmClient against a real Ollama (or
 * cloud) provider, with a small set of household-shaped prompts.
 *
 * Prints a table of input → expected → actual.  Useful for:
 *   - Sanity check: is Ollama reachable?  Does the model load?
 *   - Prompt iteration: tweak `SYSTEM_PROMPT_CLASSIFY`, re-run, see
 *     extraction quality shift.
 *   - Model swap: change `model` env var, re-run.
 *
 * Configuration via env vars:
 *
 *   HOUSEHOLD_LLM_PROVIDER       ollama (default) | openai | anthropic
 *   HOUSEHOLD_LLM_MODEL          override the default model
 *   HOUSEHOLD_LLM_BASE_URL       override the default base URL
 *   OPENAI_API_KEY               required if provider=openai
 *   ANTHROPIC_API_KEY            required if provider=anthropic
 *
 * Usage:
 *   node apps/household/scripts/llm-smoke.js
 *   HOUSEHOLD_LLM_MODEL=qwen2.5:7b-instruct node apps/household/scripts/llm-smoke.js
 *   HOUSEHOLD_LLM_PROVIDER=openai OPENAI_API_KEY=sk-... node apps/household/scripts/llm-smoke.js
 */

import { LlmClient }        from '../src/llm/LlmClient.js';
import { ollamaProvider }    from '../src/llm/providers/ollama.js';
import { openaiProvider }    from '../src/llm/providers/openai.js';
import { anthropicProvider } from '../src/llm/providers/anthropic.js';
import { SYSTEM_PROMPT_CLASSIFY, PROMPT_VERSION } from '../src/llm/prompts.js';
import { V0_TOOL_CATALOGUE }   from '../src/skills/classifyAndExtract.js';

// ── Test fixtures ────────────────────────────────────────────────
//
// Hand-labelled input → what we'd accept as "right".
//   tool       — expected tool id (LLM should produce this)
//   args.type  — expected `type` argument (when applicable)
//   noise      — true if the LLM should classify as 'noise'
//
// Match logic is forgiving: passes if the model picks the right
// tool even with slightly different args.

const FIXTURES = [
  // ── shopping
  { text: 'we need bread',                       expect: { tool: 'addItem', type: 'shopping' } },
  { text: 'add milk to groceries',               expect: { tool: 'addItem', type: 'shopping' } },
  { text: 'can someone pick up tomato passata?', expect: { tool: 'addItem', type: 'shopping' } },
  { text: 'we kunnen wat melk gebruiken',        expect: { tool: 'addItem', type: 'shopping' } },
  { text: 'voeg toe bread aan boodschappen',     expect: { tool: 'addItem', type: 'shopping' } },

  // ── errand
  { text: 'someone please pick up dry cleaning friday', expect: { tool: 'addItem', type: 'errand' } },
  { text: 'kan iemand de afwas doen',                   expect: { tool: 'addItem', type: 'errand' } },

  // ── repair
  { text: 'the kitchen tap is broken',                  expect: { tool: 'addItem', type: 'repair' } },
  { text: 'de wasmachine moet gerepareerd worden',      expect: { tool: 'addItem', type: 'repair' } },

  // ── listOpen
  { text: 'what do we need at the supermarket?',        expect: { tool: 'listOpen', type: 'shopping' } },
  { text: 'wat hebben we nodig?',                       expect: { tool: 'listOpen', type: 'shopping' } },
  { text: 'show me the open errands',                   expect: { tool: 'listOpen', type: 'errand' } },

  // ── markComplete
  { text: 'I bought bread',                             expect: { tool: 'markComplete' } },
  { text: 'milk is done',                               expect: { tool: 'markComplete' } },

  // ── noise
  { text: 'haha that is funny',                         expect: { noise: true } },
  { text: 'who left the lights on?',                    expect: { noise: true } },
  { text: 'good morning everyone',                      expect: { noise: true } },
  { text: 'goedemorgen',                                expect: { noise: true } },
];

// ── Provider wiring ──────────────────────────────────────────────

function buildProvider() {
  const id = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
  switch (id) {
    case 'ollama':
      return ollamaProvider({
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) { console.error('OPENAI_API_KEY required'); process.exit(2); }
      console.error('⚠  CLOUD PROVIDER ACTIVE — every prompt will be sent to OpenAI.  Q-H2.12 lock applies.');
      return openaiProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { console.error('ANTHROPIC_API_KEY required'); process.exit(2); }
      console.error('⚠  CLOUD PROVIDER ACTIVE — every prompt will be sent to Anthropic.  Q-H2.12 lock applies.');
      return anthropicProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
    }
    default:
      console.error(`Unknown HOUSEHOLD_LLM_PROVIDER: ${id}`); process.exit(2);
  }
}

function summarise(result) {
  if (result.toolCall) {
    const id = result.toolCall.id;
    const a  = result.toolCall.args ?? {};
    const argStr = Object.keys(a).length ? '(' + Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') + ')' : '';
    return `${id}${argStr}`;
  }
  if (result.classification === 'noise') return '[noise]';
  if (result.replyText) return `[reply] ${result.replyText.slice(0, 60)}${result.replyText.length > 60 ? '…' : ''}`;
  return '[?]';
}

function pass(result, expect) {
  if (expect.noise) return result.classification === 'noise';
  if (expect.tool) {
    if (!result.toolCall || result.toolCall.id !== expect.tool) return false;
    if (expect.type && result.toolCall.args?.type !== expect.type) return false;
    return true;
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const provider = buildProvider();
  const llm      = new LlmClient({ provider });

  console.log(`# llm-smoke — provider=${provider.id}  prompt-version=${PROMPT_VERSION}`);
  console.log(`# fixtures=${FIXTURES.length}\n`);

  let passes = 0;
  const t0 = Date.now();

  for (const fx of FIXTURES) {
    const expectStr = fx.expect.noise ? '[noise]'
      : (fx.expect.tool + (fx.expect.type ? `(type=${fx.expect.type})` : ''));
    process.stdout.write(`  IN:  ${fx.text}\n`);
    process.stdout.write(`       expect: ${expectStr}\n`);
    let result, err;
    try {
      result = await llm.invoke({
        system:   SYSTEM_PROMPT_CLASSIFY,
        messages: [{ role: 'user', content: fx.text }],
        tools:    V0_TOOL_CATALOGUE,
      });
    } catch (e) { err = e; }
    if (err) {
      process.stdout.write(`       ERROR: ${err.message ?? err}\n\n`);
      continue;
    }
    const got    = summarise(result);
    const ok     = pass(result, fx.expect);
    if (ok) passes++;
    process.stdout.write(`       got:    ${got}  ${ok ? '✓' : '✗'}\n\n`);
  }

  const ms = Date.now() - t0;
  const pct = ((passes / FIXTURES.length) * 100).toFixed(0);
  console.log(`# ${passes}/${FIXTURES.length} pass (${pct}%)  in ${(ms / 1000).toFixed(1)}s`);
  console.log('# precision-recall vs ground truth requires hand-labelled "actionable" set; this is just a sanity check');
  process.exit(passes === FIXTURES.length ? 0 : 1);
}

main().catch((err) => {
  console.error('llm-smoke: fatal:', err);
  process.exit(2);
});
