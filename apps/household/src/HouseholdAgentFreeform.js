/**
 * HouseholdAgentFreeform — V2 prototype agent (additive coexistence
 * with the legacy `HouseholdAgent`).
 *
 * Free-form list names + LLM-driven dispatch via @onderling/chat-agent
 * + deterministic slash-command pre-processor.  Implements the H2 V2
 * architecture per `Project Files/Substrates/apps/H2-household.md`.
 *
 * V2 Phase 1 (this commit): ships in src/ alongside the legacy
 * `HouseholdAgent` so consumers can opt in via `cli.js serve --mode=
 * freeform` (or via direct construction in tests / scripts) without
 * breaking the 398 legacy tests.
 *
 * V2 Phase 2 (future session): retire legacy classifyAndExtract +
 * regex parser + fixed-type tools; flip default to freeform; migrate
 * the type-bound test suite.
 *
 * Design tradeoffs the experiment validated:
 * - Free-form list names (boodschappen / klusjes / books / anything)
 *   beat fixed enums for natural-language interaction.
 * - Slash commands (/add /show /remove /done /lists /help) give
 *   deterministic, model-agnostic shortcuts that boost UX.
 * - The directive prompt + ChatAgent's loose-parser recovery handles
 *   tool-template-less models (geitje) AND models with native
 *   tool-call (qwen).  Both score 100% on lite.
 *
 * Code organisation note: the bulk of this agent's logic still lives
 * in `apps/household/scripts/lib/freetext-core.js` (TOOL_CATALOG,
 * SYSTEM_PROMPT, the store factories, slash-command preprocessor).
 * Phase 2 will move that lib into `src/freeform/` proper; for Phase
 * 1 we import across the scripts/src boundary deliberately to keep
 * this commit minimal.
 */

import { ChatAgent } from '@onderling/chat-agent';

import {
  TOOL_CATALOG,
  SYSTEM_PROMPT,
  createListStore,
  createPersistedListStore,
  createToolHandlers,
  createContextBuilder,
  installSlashCommandPreprocessor,
} from '../scripts/lib/freetext-core.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — chat-session TTL + retained history depth (scope:device, kind:internal).
const DEFAULT_SESSION_TTL_MS = param({ key: 'household.sessionTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
const DEFAULT_HISTORY_DEPTH  = param({ key: 'household.historyDepth', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 16 });

export class HouseholdAgentFreeform {
  /** @type {object} */                          #store;
  /** @type {Array<object>} */                   #bridges;
  /** @type {object} */                          #llm;
  /** @type {ChatAgent} */                       #chatAgent;
  /** @type {boolean} */                         #started = false;
  /** @type {object|null} */                     #scheduler;

  /**
   * @param {object} args
   * @param {Array<object>} args.bridges
   *   MessagingBridge instances (TelegramBridge, InMemoryBridge, ...).
   *   Slash-command pre-processing is installed on each.
   * @param {object} args.llm
   *   `@onderling/llm-client` LlmClient (or any compatible).
   * @param {object} [args.store]
   *   Free-form list store (`createListStore`-shaped: has `lists` Map +
   *   `addItem(name, item)` + `removeItem(name, match)`).  When
   *   omitted, one is built per the persistence options below.
   * @param {boolean} [args.persist=false]
   *   When true (and `store` not given), build a persisted store.
   * @param {string} [args.listsPath]
   *   File path for persistence (required when `persist: true`).
   * @param {string} [args.systemPrompt]
   *   System prompt to use.  Defaults to the directive `SYSTEM_PROMPT`
   *   from freetext-core (proven on lite-3).
   * @param {Array} [args.toolCatalog]
   *   Tool descriptors for ChatAgent.  Defaults to the experiment's
   *   3-tool catalogue (addToList / removeFromList / showList).
   * @param {Record<string, Function>} [args.toolHandlers]
   *   When omitted, built from the store via `createToolHandlers`.
   * @param {Function} [args.contextBuilder]
   *   When omitted, built from the store via `createContextBuilder`.
   * @param {number} [args.sessionTtlMs=60_000]
   * @param {number} [args.historyDepth=16]
   * @param {object} [args.scheduler]
   *   Optional `@onderling/notifier`-shaped scheduler for digests +
   *   nudges.  Surfaced as a getter for downstream wiring; this V2
   *   prototype doesn't yet feed scheduler events.  V2 Phase 2 wires
   *   addToList / removeFromList state-update events through.
   */
  constructor({
    bridges,
    llm,
    store,
    persist        = false,
    listsPath,
    systemPrompt   = SYSTEM_PROMPT,
    toolCatalog    = TOOL_CATALOG,
    toolHandlers,
    contextBuilder,
    sessionTtlMs   = DEFAULT_SESSION_TTL_MS,
    historyDepth   = DEFAULT_HISTORY_DEPTH,
    suppressFreeTextOnToolCalls = true,
    scheduler      = null,
  } = {}) {
    if (!Array.isArray(bridges) || bridges.length === 0) {
      throw new Error('HouseholdAgentFreeform: bridges (non-empty array) required');
    }
    if (!llm || typeof llm.invoke !== 'function') {
      throw new Error('HouseholdAgentFreeform: llm with invoke() required');
    }

    // Resolve store: caller-supplied → persisted → in-memory.
    if (store) {
      this.#store = store;
    } else if (persist) {
      if (typeof listsPath !== 'string' || listsPath.length === 0) {
        throw new Error('HouseholdAgentFreeform: listsPath required when persist=true');
      }
      this.#store = createPersistedListStore({ path: listsPath });
    } else {
      this.#store = createListStore();
    }

    this.#bridges   = bridges;
    this.#llm       = llm;
    this.#scheduler = scheduler;

    // Wire ChatAgent with the store-bound handlers + context builder.
    const handlers = toolHandlers   ?? createToolHandlers(this.#store);
    const ctx      = contextBuilder ?? createContextBuilder(this.#store);

    this.#chatAgent = new ChatAgent({
      bridges,
      llm,
      toolCatalog,
      toolHandlers: handlers,
      systemPrompt,
      contextBuilder: ctx,
      sessionTtlMs,
      historyDepth,
      suppressFreeTextOnToolCalls,
    });

    // Slash-command pre-processor — runs BEFORE ChatAgent's bridge
    // handler for each bridge.  Order matters: install first, then
    // chatAgent.start() registers the LLM handler underneath.
    for (const bridge of bridges) {
      installSlashCommandPreprocessor(bridge, this.#store);
    }
  }

  /** @returns {object} the in-memory or persisted list store */
  get store() { return this.#store; }

  /** @returns {ChatAgent} for advanced consumers (event hooks, etc.) */
  get chatAgent() { return this.#chatAgent; }

  /** @returns {Array<object>} */
  get bridges() { return this.#bridges; }

  /** @returns {object|null} */
  get scheduler() { return this.#scheduler; }

  /**
   * Start the agent.  Wires bridges, opens TG / etc.  Idempotent.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;
    await this.#chatAgent.start();
  }

  /**
   * Stop the agent.  Closes bridges.  Idempotent.
   */
  async stop() {
    if (!this.#started) return;
    this.#started = false;
    await this.#chatAgent.stop();
  }
}
