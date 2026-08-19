#!/usr/bin/env node
/**
 * tg-freetext.js — free-text experimental bot (Telegram bridge).
 *
 * Standalone Telegram bot that bypasses HouseholdAgent entirely and
 * wires ChatAgent directly with a conversational system prompt and
 * a minimal multi-list tool catalogue.  Shared internals (prompt,
 * catalogue, store, handlers, contextBuilder) live in
 * `./lib/freetext-core.js` so both this script and `cli-freetext.js`
 * (terminal REPL) iterate against the same code.
 *
 * Storage: in-memory Map<listName, items[]>.  Lists vanish on
 * restart — pod backing is out of scope for this experiment.
 *
 * Edit prompt / tools in `./lib/freetext-core.js`.
 *
 * Configuration (env):
 *
 *   HOUSEHOLD_TG_BOT_TOKEN       required.  From @BotFather.
 *   HOUSEHOLD_TG_USERNAME        optional.  Bot's @-handle.
 *   HOUSEHOLD_TG_MODE            'long-polling' (default) | 'webhook'
 *   HOUSEHOLD_TG_WEBHOOK_URL     required if mode=webhook.
 *   HOUSEHOLD_TG_PORT            webhook server port (default 3000).
 *
 *   HOUSEHOLD_LLM_PROVIDER       'ollama' (default) | 'openai' | 'anthropic'
 *   HOUSEHOLD_LLM_MODEL          override default model
 *   HOUSEHOLD_LLM_BASE_URL       override default base URL
 *   OPENAI_API_KEY               required if HOUSEHOLD_LLM_PROVIDER=openai
 *   ANTHROPIC_API_KEY            required if HOUSEHOLD_LLM_PROVIDER=anthropic
 *
 * Usage:
 *   export HOUSEHOLD_TG_BOT_TOKEN=...
 *   HOUSEHOLD_LLM_MODEL=qwen2.5:3b-instruct \
 *     npm run tg-freetext --prefix apps/household
 *
 * Ctrl-C to stop.
 */

import { ChatAgent }         from '@onderling/chat-agent';
import { TelegramBridge }    from '@onderling/chat-agent/bridges/telegram';
import { LlmClient }         from '../src/llm/LlmClient.js';
import { ollamaProvider, OLLAMA_DEFAULT_MODEL } from '../src/llm/providers/ollama.js';
import { openaiProvider }    from '../src/llm/providers/openai.js';
import { anthropicProvider } from '../src/llm/providers/anthropic.js';

import { homedir }    from 'node:os';
import { resolve }    from 'node:path';

import {
  TOOL_CATALOGUE,
  createListStore,
  createPersistedListStore,
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

// HOUSEHOLD_LANG=en switches the system prompt + tool reply strings
// + button-tap shape to English.  Anything else (or unset) → Dutch.
// HOUSEHOLD_PROMPT overrides the language-derived prompt if set.
const LANG          = (process.env.HOUSEHOLD_LANG ?? '').toLowerCase();
const LOCALISATION          = pickLocalisation(LANG);
const FALLBACK      = pickFallbackNotDone(LANG);
const PROMPT_NAME   = process.env.HOUSEHOLD_PROMPT ?? (LANG === 'en' ? 'lean-en' : 'lean');
const SYSTEM_PROMPT = pickPrompt(PROMPT_NAME);
const LLM_OPTIONS   = parseLlmOptions();

// ─── LLM wiring (mirrors tg-smoke.js shape) ─────────────────────

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
      console.error('⚠  CLOUD PROVIDER ACTIVE — every message goes to OpenAI.');
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
      console.error('⚠  CLOUD PROVIDER ACTIVE — every message goes to Anthropic.');
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

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const token = process.env.HOUSEHOLD_TG_BOT_TOKEN;
  if (!token) {
    console.error('error: HOUSEHOLD_TG_BOT_TOKEN env var required.');
    console.error('  1. DM @BotFather on Telegram, run /newbot, follow prompts.');
    console.error('  2. export HOUSEHOLD_TG_BOT_TOKEN=...');
    process.exit(2);
  }

  const mode = process.env.HOUSEHOLD_TG_MODE ?? 'long-polling';
  if (mode === 'webhook' && !process.env.HOUSEHOLD_TG_WEBHOOK_URL) {
    console.error('error: HOUSEHOLD_TG_MODE=webhook requires HOUSEHOLD_TG_WEBHOOK_URL.');
    process.exit(2);
  }

  // Drop the queued backlog by default so a slow local LLM (geitje
  // observed at 100–150s/turn) doesn't spend half an hour catching up
  // on stale messages from while the bot was offline.  Opt out with
  // HOUSEHOLD_TG_KEEP_PENDING=1 if you actually want to process them.
  const dropPendingUpdates = process.env.HOUSEHOLD_TG_KEEP_PENDING !== '1';

  const bridge = new TelegramBridge({
    botToken:    token,
    mode,
    webhookUrl:  process.env.HOUSEHOLD_TG_WEBHOOK_URL,
    port:        process.env.HOUSEHOLD_TG_PORT ? Number(process.env.HOUSEHOLD_TG_PORT) : undefined,
    botUsername: process.env.HOUSEHOLD_TG_USERNAME,
    dropPendingUpdates,
  });
  if (dropPendingUpdates) {
    console.error('# dropping pending updates on launch (set HOUSEHOLD_TG_KEEP_PENDING=1 to keep)');
  }

  // Wrap bridge.onMessage so every incoming message is logged.
  // Full text — no truncation, multi-line preserved with a marker.
  const _originalOnMessage = bridge.onMessage.bind(bridge);
  bridge.onMessage = (handler) => {
    _originalOnMessage(async (msg) => {
      const text   = (msg?.text ?? '').replace(/\n/g, '\\n');
      const sender = msg?.sender?.displayName ?? msg?.sender?.bridgeUid ?? 'unknown';
      console.error(`[user ${sender} chatId=${msg.chatId}] ${text}`);
      return handler(msg);
    });
  };

  const llm = buildLlm();

  // Persistent storage — survives restarts.  Path overridable via
  // HOUSEHOLD_LISTS_PATH; defaults to ~/.household/lists.json.
  // Pass HOUSEHOLD_LISTS_PATH=:memory: to opt out (lists vanish on
  // restart, useful for dev / smoke testing).
  const listsPathEnv = process.env.HOUSEHOLD_LISTS_PATH;
  const inMemory     = listsPathEnv === ':memory:';
  const listsPath    = inMemory
    ? null
    : resolve(listsPathEnv ?? `${homedir()}/.household/lists.json`);
  const store        = inMemory
    ? createListStore()
    : createPersistedListStore({ path: listsPath });

  const toolHandlers   = createToolHandlers(store, { localisation: LOCALISATION });
  const contextBuilder = createContextBuilder(store, { localisation: LOCALISATION });

  // Slash-command pre-processor: deterministic /add /show /remove
  // /done /lists /help.  Bypasses the LLM when matched; otherwise
  // falls through to ChatAgent's LLM path.
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
    // Sanitise LLM prose: strip hallucinated `📋 listname:` blocks,
    // markdown code fences, prompt-template <placeholders>, AND
    // confirmation phrases ("✓", "verwijderd", "toegevoegd") that
    // appear without an actual tool call — geitje observed lying
    // about removals it never performed.
    replyTransformer: (reply, ctx) => {
      if (!reply || typeof reply.text !== 'string') return reply;
      if (reply.buttons) return reply;            // real tool reply, leave it
      const calledShow = ctx.calls.some((c) => c.id === 'showList');
      let text = reply.text;
      if (!calledShow) text = stripFakeListBlocks(text);
      // No tool call AND the reply is confirmation-shaped → silent lie.
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
  agent.on('reply', (e) => {
    // Full text — no truncation, multi-line preserved with marker.
    const text = (e.text ?? '').replace(/\n/g, '\\n');
    console.error(`[reply chatId=${e.chatId}] ${text}`);
  });

  console.error('# tg-freetext — free-text-primary experiment (no HouseholdAgent)');
  console.error(`# tg-mode:     ${mode}`);
  console.error(`# llm:         ${llm.providerId}`);
  // Show the actual model that will be used (so the user can spot
  // env-var-not-propagated mishaps, e.g. when `MODEL=… && npm run …`
  // accidentally sets the var only in the parent shell).
  const providerDefaults = { ollama: OLLAMA_DEFAULT_MODEL };
  const providerId = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
  const resolvedModel = process.env.HOUSEHOLD_LLM_MODEL
    ?? providerDefaults[providerId]
    ?? '(provider default)';
  console.error(`# model:       ${resolvedModel}${process.env.HOUSEHOLD_LLM_MODEL ? '' : '  (default)'}`);
  console.error(`# prompt:      ${PROMPT_NAME.toLowerCase()}`);
  console.error(`# lang:        ${LANG === 'en' ? 'en (English replies + button shape)' : 'nl (Dutch — default)'}`);
  if (LLM_OPTIONS) {
    const optStr = Object.entries(LLM_OPTIONS)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    console.error(`# llm-opts:    ${optStr}`);
  }
  console.error(`# storage:     ${inMemory ? 'in-memory (lists vanish on restart)' : `file-persisted at ${listsPath}`}`);
  console.error('# Ctrl-C to stop.\n');

  await agent.start();
  console.error('# bot is live.  Try DM-ing it:');
  console.error('#   /add boodschappen brood, melk, eieren  ← deterministic slash command');
  console.error('#   /show boodschappen                     ← renders tappable buttons');
  console.error('#   /remove boodschappen brood');
  console.error('#   /lists');
  console.error('#   /help');
  console.error('#');
  console.error('#   or natural language (LLM fallback):');
  console.error('#   "voeg brood en melk toe aan mijn boodschappenlijst"');
  console.error('#   "wat staat er op de boodschappen?"');
  console.error('#   "ik heb melk"');
  console.error('#   "haha goedemorgen"\n');

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.error(`\n# ${signal}: stopping…`);
    const safety = setTimeout(() => {
      console.error('# safety timer: forcing exit');
      process.exit(1);
    }, 4000);
    try { await agent.stop(); } catch (err) {
      console.error('# stop error:', err?.message ?? err);
    }
    clearTimeout(safety);
    console.error('# shutdown: ok');
    process.exit(0);
  }
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal:', err?.stack ?? err);
  process.exit(1);
});
