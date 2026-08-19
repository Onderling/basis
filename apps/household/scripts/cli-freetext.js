#!/usr/bin/env node
/**
 * cli-freetext.js — terminal REPL for the free-text experiment.
 *
 * Same prompt + tools + store as `tg-freetext.js`, but uses
 * @onderling/chat-agent's `InMemoryBridge` so you can iterate without
 * the Telegram round-trip.  Drastically faster for prompt-tuning.
 *
 * Modes:
 *   - INTERACTIVE: `npm run cli-freetext --prefix apps/household`
 *     Type a message, see what the bot does.  `/tap N` simulates a
 *     button tap on the Nth button shown most recently.  `/quit`
 *     exits.
 *
 *   - ONE-SHOT:    `npm run cli-freetext --prefix apps/household -- "voeg melk toe aan boodschappen"`
 *     Process a single message and exit.  Useful for scripted runs.
 *
 *   - BATCH:       `npm run cli-freetext --prefix apps/household -- --fixtures path/to/fixtures.json`
 *     Read a JSON array of message strings, run them in order.
 *
 * Configuration (env):
 *   HOUSEHOLD_LLM_PROVIDER   ollama (default) | openai | anthropic
 *   HOUSEHOLD_LLM_MODEL      override default model
 *   HOUSEHOLD_LLM_BASE_URL   override default base URL
 *   OPENAI_API_KEY           required if provider=openai
 *   ANTHROPIC_API_KEY        required if provider=anthropic
 *
 * Usage examples:
 *   HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct npm run cli-freetext --prefix apps/household
 *
 *   npm run cli-freetext --prefix apps/household -- "voeg melk toe aan boodschappen"
 */

import readline                from 'node:readline';
import { promises as fs }      from 'node:fs';

import { ChatAgent, InMemoryBridge } from '@onderling/chat-agent';

import { LlmClient }         from '../src/llm/LlmClient.js';
import { ollamaProvider, OLLAMA_DEFAULT_MODEL } from '../src/llm/providers/ollama.js';
import { openaiProvider }    from '../src/llm/providers/openai.js';
import { anthropicProvider } from '../src/llm/providers/anthropic.js';

import {
  TOOL_CATALOGUE,
  createListStore,
  createToolHandlers,
  createContextBuilder,
  pickPrompt,
  pickLocalisation,
  pickFallbackNotDone,
  parseLlmOptions,
  installSlashCommandPreprocessor,
  stripFakeListBlocks,
  looksLikeActionConfirmation,
} from './lib/freetext-core.js';

const LANG          = (process.env.HOUSEHOLD_LANG ?? '').toLowerCase();
const LOCALISATION          = pickLocalisation(LANG);
const FALLBACK      = pickFallbackNotDone(LANG);
const PROMPT_NAME   = process.env.HOUSEHOLD_PROMPT ?? (LANG === 'en' ? 'lean-en' : 'lean');

const SYSTEM_PROMPT = pickPrompt(PROMPT_NAME);
const LLM_OPTIONS   = parseLlmOptions();

const PROVIDER_ID = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
const PROVIDER_DEFAULTS = { ollama: OLLAMA_DEFAULT_MODEL };
const RESOLVED_MODEL = process.env.HOUSEHOLD_LLM_MODEL
  ?? PROVIDER_DEFAULTS[PROVIDER_ID]
  ?? '(provider default)';
const MODEL_BANNER = process.env.HOUSEHOLD_LLM_MODEL
  ? RESOLVED_MODEL
  : `${RESOLVED_MODEL}  (default)`;

// ─── LLM wiring (mirrors tg-freetext.js) ────────────────────────

function buildLlm() {
  const id = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
  let provider;
  switch (id) {
    case 'ollama':
      provider = ollamaProvider({
        baseUrl:        process.env.HOUSEHOLD_LLM_BASE_URL,
        model:          process.env.HOUSEHOLD_LLM_MODEL,
        defaultOptions: LLM_OPTIONS,
      });
      break;
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY required when HOUSEHOLD_LLM_PROVIDER=openai');
      provider = openaiProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
      break;
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY required when HOUSEHOLD_LLM_PROVIDER=anthropic');
      provider = anthropicProvider({
        apiKey,
        baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL,
        model:   process.env.HOUSEHOLD_LLM_MODEL,
      });
      break;
    }
    default:
      throw new Error(`Unknown HOUSEHOLD_LLM_PROVIDER: ${id}`);
  }
  return new LlmClient({ provider });
}

// ─── Pretty-print a single bridge.sendReply result. ─────────────

const C = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  bot:   '\x1b[36m',   // cyan
  btn:   '\x1b[33m',   // yellow
};

/**
 * @param {{text?: string, buttons?: Array<{id, label}>}} reply
 * @returns {Array<{id: string, label: string}>} buttons (so caller can save them for /tap)
 */
function printReply(reply) {
  const text = (reply?.text ?? '').replace(/\n/g, '\n      ');
  process.stdout.write(`${C.bot}[bot]${C.reset} ${text}\n`);
  const buttons = Array.isArray(reply?.buttons) ? reply.buttons : [];
  if (buttons.length > 0) {
    process.stdout.write(`      ${C.btn}[buttons]${C.reset}\n`);
    buttons.forEach((b, i) => {
      process.stdout.write(
        `        ${(i + 1).toString().padStart(2)}. ${b.label.padEnd(24)} ${C.dim}(id: "${b.id}")${C.reset}\n`,
      );
    });
    process.stdout.write(`        ${C.dim}(type "/tap N" to simulate a tap, or paste any id)${C.reset}\n`);
  }
  return buttons;
}

// ─── Build agent + bridge once. ─────────────────────────────────

async function buildAgent() {
  const bridge = new InMemoryBridge({ id: 'cli' });
  const llm    = buildLlm();

  const store          = createListStore();
  const toolHandlers   = createToolHandlers(store, { localisation: LOCALISATION });
  const contextBuilder = createContextBuilder(store, { localisation: LOCALISATION });

  // Slash-command pre-processor — deterministic, model-agnostic
  // fast path.  Falls through to LLM when text isn't a slash command.
  installSlashCommandPreprocessor(bridge, store, { localisation: LOCALISATION });

  const agent = new ChatAgent({
    bridges:        [bridge],
    llm,
    toolCatalogue:    TOOL_CATALOGUE,
    toolHandlers,
    systemPrompt:   SYSTEM_PROMPT,
    contextBuilder,
    sessionTtlMs:   60_000,
    historyDepth:   16,
    suppressFreeTextOnToolCalls: true,
    replyTransformer: (reply, ctx) => {
      if (!reply || typeof reply.text !== 'string') return reply;
      if (reply.buttons) return reply;
      const calledShow = ctx.calls.some((c) => c.id === 'showList');
      let text = reply.text;
      if (!calledShow) text = stripFakeListBlocks(text);
      if (ctx.calls.length === 0 && looksLikeActionConfirmation(text)) {
        return { ...reply, text: FALLBACK };
      }
      if (text.length === 0) return null;
      return { ...reply, text };
    },
  });

  agent.on('error', (e) => {
    console.error('[agent.error]', e.error?.message ?? e.error ?? e);
  });

  await agent.start();
  return { agent, bridge, llm, store };
}

// ─── Run a single message turn and print the result. ────────────

/**
 * @param {InMemoryBridge} bridge
 * @param {string} text
 * @returns {Promise<Array<{id: string, label: string}>>} latest buttons
 */
async function runTurn(bridge, text) {
  bridge.clearOutbox();
  await bridge.simulateIncoming({ text });
  let lastButtons = [];
  for (const r of bridge.outbox) {
    const btns = printReply(r);
    if (btns.length > 0) lastButtons = btns;
  }
  return lastButtons;
}

// ─── Mode dispatch. ─────────────────────────────────────────────

async function runOneShot(text) {
  const { bridge, llm, agent } = await buildAgent();
  console.error(`# llm:   ${llm.providerId}`);
  console.error(`# model: ${MODEL_BANNER}`);
  console.error(`> ${text}`);
  await runTurn(bridge, text);
  await agent.stop();
}

async function runFixtures(path) {
  const raw = await fs.readFile(path, 'utf8');
  const fixtures = JSON.parse(raw);
  if (!Array.isArray(fixtures)) {
    throw new Error('fixtures file must be a JSON array of strings');
  }
  const { bridge, llm, agent } = await buildAgent();
  console.error(`# llm:      ${llm.providerId}`);
  console.error(`# model:    ${MODEL_BANNER}`);
  console.error(`# fixtures: ${path} (${fixtures.length} messages)\n`);
  for (const text of fixtures) {
    if (typeof text !== 'string' || !text.trim()) continue;
    process.stdout.write(`\n> ${text}\n`);
    await runTurn(bridge, text);
  }
  await agent.stop();
}

async function runRepl() {
  const { bridge, llm, agent } = await buildAgent();
  console.error(`# cli-freetext — terminal REPL`);
  console.error(`# provider: ${llm.providerId}`);
  console.error(`# model:    ${MODEL_BANNER}`);
  console.error(`# prompt:   ${(process.env.HOUSEHOLD_PROMPT ?? 'default').toLowerCase()}`);
  if (LLM_OPTIONS) {
    const optStr = Object.entries(LLM_OPTIONS)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    console.error(`# llm-opts: ${optStr}`);
  }
  console.error(`# Type a message.  Commands: "/tap N" (sim button), "/quit".`);
  console.error(`# Slash commands (deterministic — no LLM): /add, /show, /remove, /done, /lists, /help`);
  console.error();

  /** @type {Array<{id: string, label: string}>} */
  let lastButtons = [];
  let processing  = false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }

    if (processing) {
      // Defensive — rl.pause() should prevent this, but kernel buffers
      // can deliver lines that landed before the pause took effect.
      process.stdout.write(`${C.dim}(still processing previous turn — input ignored)${C.reset}\n`);
      return;
    }

    if (text === '/quit' || text === '/exit') {
      rl.close();
      await agent.stop();
      process.exit(0);
    }

    let actualText = text;
    if (text.startsWith('/tap ')) {
      const idx = parseInt(text.slice(5).trim(), 10) - 1;
      if (Number.isFinite(idx) && lastButtons[idx]) {
        actualText = lastButtons[idx].id;
        process.stdout.write(`${C.dim}[tap] ${lastButtons[idx].label} → "${actualText}"${C.reset}\n`);
      } else {
        process.stdout.write(`${C.dim}(no button #${idx + 1})${C.reset}\n`);
        rl.prompt();
        return;
      }
    }

    // Block new input during the turn so user can't type ahead and
    // get out-of-order replies / confused state.
    processing = true;
    rl.pause();
    process.stdout.write(`${C.dim}  (processing…)${C.reset}\n`);

    const startedAt = Date.now();
    try {
      const newButtons = await runTurn(bridge, actualText);
      if (newButtons.length > 0) lastButtons = newButtons;
    } catch (err) {
      console.error('[turn error]', err?.message ?? err);
    } finally {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stdout.write(`${C.dim}  (${elapsed}s)${C.reset}\n`);
      processing = false;
      rl.resume();
      rl.prompt();
    }
  });

  rl.on('close', async () => {
    await agent.stop();
    process.exit(0);
  });
}

// ─── Main: parse argv, pick mode. ───────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await runRepl();
    return;
  }
  if (argv[0] === '--fixtures' && argv[1]) {
    await runFixtures(argv[1]);
    return;
  }
  // Treat the rest as a single one-shot message.
  await runOneShot(argv.join(' '));
}

main().catch((err) => {
  console.error('fatal:', err?.stack ?? err);
  process.exit(1);
});
