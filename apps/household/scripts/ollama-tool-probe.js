#!/usr/bin/env node
/**
 * ollama-tool-probe.js — single-shot diagnostic.
 *
 * Hits Ollama's OpenAI-compatible chat-completions endpoint with the
 * free-text experiment's TOOL_CATALOGUE and a sample user message,
 * then prints the RAW response so you can see exactly what the
 * model emits — structured `tool_calls`, free text, or both.
 *
 * Useful when a smoke run reports 0/N for a model and you want to
 * know if the issue is:
 *   - model not loaded / not responding (raw error)
 *   - model emits empty content (template / config issue)
 *   - model emits tool calls in plain text (parser-recovery target)
 *   - model just doesn't tool-call this prompt (prompt-tuning issue)
 *
 * Usage:
 *   node scripts/ollama-tool-probe.js                                       # geitje + default prompt
 *   node scripts/ollama-tool-probe.js qwen2.5:7b-instruct
 *   node scripts/ollama-tool-probe.js mistral:7b-instruct "voeg melk toe aan boodschappen"
 *   HOUSEHOLD_LLM_BASE_URL=http://other:11434 node scripts/ollama-tool-probe.js
 */

import { TOOL_CATALOGUE, SYSTEM_PROMPT } from './lib/freetext-core.js';

const DEFAULT_MODEL  = 'bramvanroy/geitje-7b-ultra:Q4_K_M';
const DEFAULT_PROMPT = 'voeg kaas, boter en peren toe aan boodschappen';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red:   '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const model  = process.argv[2] ?? DEFAULT_MODEL;
const prompt = process.argv[3] ?? DEFAULT_PROMPT;
const baseUrl = (process.env.HOUSEHOLD_LLM_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');

const tools = TOOL_CATALOGUE.map((t) => ({
  type: 'function',
  function: { name: t.id, description: t.description ?? '', parameters: t.schema ?? {} },
}));

const body = {
  model,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: prompt },
  ],
  tools,
  stream: false,
};

console.error(`${C.cyan}# ollama-tool-probe${C.reset}`);
console.error(`${C.dim}# model:  ${model}`);
console.error(`# url:    ${baseUrl}/v1/chat/completions`);
console.error(`# prompt: ${JSON.stringify(prompt)}`);
console.error(`# tools:  ${tools.length} (${tools.map((t) => t.function.name).join(', ')})${C.reset}\n`);

const post = async (b) => fetch(`${baseUrl}/v1/chat/completions`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  body:    JSON.stringify(b),
});

const startedAt = Date.now();
let res;
let usedTools = true;
try {
  res = await post(body);
} catch (err) {
  console.error(`${C.red}fetch error: ${err.message}${C.reset}`);
  console.error('  → is Ollama running on ' + baseUrl + '?  (try: curl ' + baseUrl + '/api/tags)');
  process.exit(2);
}

// Auto-fallback for models without a tool template (e.g. geitje 7B
// Ultra Q4_K_M).  Mirrors the production ollamaProvider's behaviour
// so the probe shows what the model actually emits in text.
if (!res.ok) {
  const text = await res.text().catch(() => '');
  if (/does not support tools/i.test(text)) {
    console.error(`${C.yellow}# model has no tool template — retrying WITHOUT tools…${C.reset}`);
    console.error(`${C.dim}#   (this is what the production ollamaProvider does too;${C.reset}`);
    console.error(`${C.dim}#    the model's text reply still gets fed through${C.reset}`);
    console.error(`${C.dim}#    parseLooseToolCalls for tool-intent recovery.)${C.reset}\n`);
    const { tools: _ignored, ...bodyNoTools } = body;
    try {
      res = await post(bodyNoTools);
      usedTools = false;
    } catch (err) {
      console.error(`${C.red}fetch error on retry: ${err.message}${C.reset}`);
      process.exit(2);
    }
  } else {
    console.error(`${C.red}HTTP error body:${C.reset}`);
    console.error(text);
    process.exit(1);
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.error(`${C.dim}# elapsed: ${elapsed}s, status: ${res.status} ${res.statusText}${C.reset}`);
console.error(`${C.dim}# tools sent: ${usedTools ? 'yes' : 'no (fallback)'}${C.reset}\n`);

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`${C.red}HTTP error body:${C.reset}`);
  console.error(text);
  process.exit(1);
}

const json = await res.json();
const choice = json?.choices?.[0];
const msg    = choice?.message ?? {};
const finishReason = choice?.finish_reason;

console.error(`${C.cyan}=== response.choices[0].message.content ===${C.reset}`);
if (msg.content) {
  console.error(msg.content);
} else {
  console.error(`${C.dim}(empty)${C.reset}`);
}

console.error(`\n${C.cyan}=== response.choices[0].message.tool_calls ===${C.reset}`);
if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
  console.error(`${C.green}${msg.tool_calls.length} structured tool_call(s) emitted:${C.reset}`);
  for (const tc of msg.tool_calls) {
    console.error('  - ' + JSON.stringify(tc, null, 2).split('\n').join('\n    '));
  }
} else {
  console.error(`${C.yellow}(none — model did NOT emit any structured tool_call)${C.reset}`);
}

console.error(`\n${C.cyan}=== finish_reason ===${C.reset}`);
console.error(finishReason ?? '(missing)');

console.error(`\n${C.cyan}=== verdict ===${C.reset}`);
const hasTextLooksLikeToolCall = typeof msg.content === 'string' &&
  /\b(addToList|removeFromList|showList)\b/.test(msg.content);
const hasJsonInText = typeof msg.content === 'string' &&
  /\{\s*"(?:tool|name|function)"/.test(msg.content);

if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
  console.error(`  ${C.green}✓ structured tool_call emitted — model + template support tools cleanly.${C.reset}`);
} else if (hasJsonInText) {
  console.error(`  ${C.yellow}⚠ no structured tool_call, but JSON-shaped tool intent in content text.${C.reset}`);
  console.error(`    The substrate's parseLooseToolCalls (v0.2.0) should recover this.`);
  if (!usedTools) {
    console.error(`    (Model has no tool template — this is the expected good outcome${C.reset}`);
    console.error(`    ${C.dim}for tool-less models.)${C.reset}`);
  }
} else if (hasTextLooksLikeToolCall) {
  console.error(`  ${C.yellow}⚠ no structured tool_call, but tool name appears in content text.${C.reset}`);
  console.error(`    Likely emitted as JS-call syntax — parseLooseToolCalls (v0.2.0)`);
  console.error(`    with the tool catalogue should recover this.`);
  if (!usedTools) {
    console.error(`    ${C.dim}(Model has no tool template — this is the expected good outcome${C.reset}`);
    console.error(`    ${C.dim}for tool-less models.)${C.reset}`);
  }
} else if (!msg.content) {
  console.error(`  ${C.red}✗ empty response.  Model may not be loaded.${C.reset}`);
  console.error(`    Try: ollama run ${model} 'hi'  (warm the model)`);
  console.error(`    Then re-run this probe.`);
} else if (!usedTools) {
  console.error(`  ${C.dim}plain text reply, no tool intent detected.${C.reset}`);
  console.error(`  ${C.yellow}⚠ This model lacks a tool template AND emitted no tool-shaped intent.${C.reset}`);
  console.error(`    The bot won't be able to drive list operations from this model.`);
  console.error(`    Try: stronger prompt examples in lib/freetext-core.js, or use a different model.`);
} else {
  console.error(`  ${C.dim}plain text reply, no tool intent detected.  Model is "chatting" instead of acting.${C.reset}`);
}
