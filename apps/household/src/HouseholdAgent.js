/**
 * HouseholdAgent — the glue layer.
 *
 * Receives messages from registered bridges, runs the Path-2 hybrid
 * routing (regex fast path → LLM slow path), dispatches to skills,
 * returns replies.
 *
 * v0 (Phase 1): regex-only.  No LLM yet.  When regex returns null,
 * the agent replies with a help hint.  Phase 3 wires classifyAndExtract
 * into the slow path.
 *
 * Construction:
 *
 *   const agent = new HouseholdAgent({ store, bridges });
 *   await agent.start();              // starts every bridge
 *   // ... bridges receive messages and forward to agent.onMessage
 *   await agent.stop();
 *
 * The agent registers itself with each bridge via the bridge's
 * `onMessage` API.  Bridges call back into `agent.onMessage(msg)`
 * which returns a Reply; the bridge then walks `replies[]` and posts
 * each via `sendReply`.
 */

import { ChatAgent }               from '@onderling/chat-agent';
import { renderChat, renderSlash } from '@onderling/app-manifest';

import { householdManifest }  from '../manifest.js';
import {
  HOUSEHOLD_SKILL_REGISTRY as SKILL_REGISTRY,
  noopContextBuilder,
} from './skillRegistry.js';

// Compile the manifest's slash grammar once at module load so
// `#routeMessage` stays cheap.  `renderSlash().parse` is drop-in for the
// retired `regexParse` (byte-equal, proven by
// `test/manifest-equivalence.test.js`).
const slash = renderSlash(householdManifest);

/**
 * Build the SkillContext for one incoming message.  Resolves a
 * placeholder webid when the bridge didn't provide one (Phase 2's
 * MemberWebIdMap will fill this in for real).
 *
 * @param {object} args
 * @param {import('./storage/Store.js').Store} args.store
 * @param {import('./types.js').IncomingMessage} args.msg
 * @param {HouseholdAgent} args.agent
 * @returns {import('./types.js').SkillContext}
 */
function buildSkillContext({ store, msg, agent }) {
  const senderWebid = msg.sender.webid
    ?? `unknown:${msg.bridgeId}:${msg.sender.bridgeUid}`;
  return {
    store,
    chatId:      msg.chatId,
    senderWebid,
    bridgeId:    msg.bridgeId,
    agent,
  };
}

const EMPTY_REPLY = Object.freeze({ replies: [], stateUpdates: [] });

const HELP_HINT_REPLY = Object.freeze({
  replies: [{
    text: "I couldn't parse that — try `add <type> <text>`, `list <type>`, `done <text>`, or `help`.",
  }],
  stateUpdates: [],
});

export class HouseholdAgent {
  /** @type {import('./storage/Store.js').Store} */
  #store;
  /** @type {Array<import('./bridges/MessagingBridge.js').MessagingBridge>} */
  #bridges;
  /** @type {object|null} */
  #llm;
  /** @type {object|null} */
  #scheduler;
  /** @type {ChatAgent|null} */
  #chatAgent = null;
  /** @type {boolean} */
  #started = false;

  /**
   * @param {object} args
   * @param {import('./storage/Store.js').Store} args.store
   * @param {Array<import('./bridges/MessagingBridge.js').MessagingBridge>} args.bridges
   * @param {object} [args.llm]         Phase 3 — LlmClient.  null in Phase 1.
   * @param {object} [args.scheduler]   Phase 4 — Scheduler.  null in Phase 1.
   */
  constructor({ store, bridges, llm = null, scheduler = null } = {}) {
    if (!store)            throw new Error('HouseholdAgent: store required');
    if (!Array.isArray(bridges) || bridges.length === 0) {
      throw new Error('HouseholdAgent: at least one bridge required');
    }
    this.#store     = store;
    this.#bridges   = bridges;
    this.#llm       = llm;
    this.#scheduler = scheduler;

    // When an LLM is configured, the slow path delegates to a
    // headless `@onderling/chat-agent` ChatAgent: substrate handles
    // session state + tool dispatch; HouseholdAgent owns the
    // bridge/regex layers above it.  `renderChat` projects the manifest
    // (`../manifest.js`) onto the ChatAgent ctor input — byte-equal to
    // the retired hand-catalogues (V0_TOOL_CATALOGUE /
    // SYSTEM_PROMPT_CLASSIFY / buildHouseholdToolHandlers), proven by
    // `test/manifest-equivalence.test.js`.
    if (this.#llm) {
      const { toolCatalogue, toolHandlers, systemPrompt } = renderChat(
        householdManifest,
        {
          skillRegistry: SKILL_REGISTRY,
          toSkillCtx:    (toolCtx) => ({
            store:       this.#store,
            chatId:      toolCtx.chatId,
            senderWebid: toolCtx.actorWebid,
            bridgeId:    toolCtx.bridgeId,
            agent:       this,
          }),
          onStateUpdates: (updates) => {
            const sch = this.#scheduler;
            if (!sch || typeof sch.onStateUpdate !== 'function') return;
            for (const u of updates) {
              try { sch.onStateUpdate(u); }
              catch (err) {
                // eslint-disable-next-line no-console
                console.error('[HouseholdAgent] scheduler.onStateUpdate threw:', err?.message ?? err);
              }
            }
          },
        },
      );
      this.#chatAgent = new ChatAgent({
        bridges:        [],          // headless — Household sends replies itself
        llm:            this.#llm,
        toolCatalogue,
        toolHandlers,
        systemPrompt,
        contextBuilder: noopContextBuilder,
      });
    }
  }

  /**
   * Live LLM client (Phase 3) — exposed so classifyAndExtract can
   * call it via ctx.agent.llm.  Null when no LLM is configured.
   */
  get llm() { return this.#llm; }

  /**
   * Invoke a skill by id — used by classifyAndExtract to dispatch
   * to the LLM-chosen tool.  Returns the skill's Reply.
   *
   * @param {string} skillId
   * @param {object} args
   * @param {import('./types.js').SkillContext|import('./types.js').IncomingMessage} msgOrCtx
   *   Either an IncomingMessage (rebuild the context) or a pre-built
   *   SkillContext (reuse).  When classifyAndExtract calls back here,
   *   it passes its own SkillContext through unchanged.
   * @returns {Promise<import('./types.js').Reply>}
   */
  async invokeSkill(skillId, args, msgOrCtx) {
    const ctx = msgOrCtx?.store
      ? msgOrCtx              // looks like a SkillContext
      : buildSkillContext({ store: this.#store, msg: msgOrCtx, agent: this });
    return this.#dispatchSkill(skillId, args, ctx);
  }

  /**
   * Dispatch outbound replies — invoked by the scheduler when a nudge
   * or daily digest fires.  Posts to the first bridge that's started.
   * v0 simplification: assumes a single primary bridge per chat.
   *
   * @param {string} chatId
   * @param {Array<import('./types.js').ReplyMessage>} replies
   */
  async dispatch(chatId, replies) {
    if (!Array.isArray(replies) || replies.length === 0) return;
    // For v0, blast to every bridge; in practice only one is registered.
    for (const bridge of this.#bridges) {
      for (const r of replies) {
        try {
          await bridge.sendReply({
            chatId,
            text:    r.text,
            buttons: r.buttons,
          });
        } catch (err) {
          console.error('[HouseholdAgent.dispatch]', err?.message ?? err);
        }
      }
    }
  }

  /**
   * Wire each bridge's onMessage to this agent's onMessage, then
   * start every bridge.  Idempotent.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;
    for (const bridge of this.#bridges) {
      bridge.onMessage((msg) => this.onMessage(msg));
    }
    for (const bridge of this.#bridges) {
      await bridge.start();
    }
  }

  /**
   * Stop every bridge.  Idempotent.
   */
  async stop() {
    if (!this.#started) return;
    this.#started = false;
    for (const bridge of this.#bridges) {
      try { await bridge.stop(); } catch { /* swallow */ }
    }
  }

  /**
   * The function bridges call when a message arrives.
   *
   * @param {import('./types.js').IncomingMessage} msg
   * @returns {Promise<import('./types.js').Reply>}
   */
  async onMessage(msg) {
    // Defence: bridges should already have filtered.
    if (!msg.isAddressed) return EMPTY_REPLY;

    const reply = await this.#routeMessage(msg);
    this.#forwardStateUpdates(reply);
    return reply;
  }

  /** @returns {Promise<import('./types.js').Reply>} */
  async #routeMessage(msg) {
    // ── Fast path: manifest-projected slash grammar ─────────────
    // `slash.parse` is the renderSlash projection of `householdManifest`
    // — byte-equal to the retired `regexParse`.
    const parsed = slash.parse(msg.text);

    if (parsed === null) {
      // ── Slow path: LLM via @onderling/chat-agent (B.4) ────────
      if (this.#chatAgent) {
        return this.#runChatAgent(msg);
      }
      // No LLM, no parse → help hint
      return HELP_HINT_REPLY;
    }

    if (Array.isArray(parsed)) {
      // Multi-item command → run each in sequence, merge replies +
      // state updates so the bridge gets one Reply object back.
      const merged = { replies: [], stateUpdates: [] };
      for (const call of parsed) {
        const r = await this.#dispatchSkill(call.skillId, call.args, msg);
        merged.replies.push(...r.replies);
        merged.stateUpdates.push(...r.stateUpdates);
      }
      return merged;
    }

    return this.#dispatchSkill(parsed.skillId, parsed.args, msg);
  }

  /**
   * Delegate the LLM slow path to the embedded @onderling/chat-agent
   * ChatAgent.  ChatAgent handles session state + tool dispatch; tool
   * handlers (built in ./llm/chatAgentBridge.js) wrap the existing
   * skills and forward stateUpdates to the scheduler.  We collect the
   * substrate's `replies` and turn them back into Household's Reply
   * shape so the rest of the agent's flow is unchanged.
   *
   * @param {import('./types.js').IncomingMessage} msg
   * @returns {Promise<import('./types.js').Reply>}
   */
  async #runChatAgent(msg) {
    // Synthesise the IncomingMessage shape the substrate expects.
    // Most fields already match; ensure isAddressed is true (the
    // outer onMessage already filtered, so the substrate would
    // otherwise no-op).
    const subMsg = { ...msg, isAddressed: true };
    let result;
    try {
      result = await this.#chatAgent.processMessage(subMsg);
    } catch (err) {
      return {
        replies: [{ text: `Sorry, that didn't work — ${err?.message ?? 'unknown error'}.` }],
        stateUpdates: [],
      };
    }
    // Aggregate stateUpdates that the tool handlers stashed into
    // toolResults[].data.stateUpdates (chatAgentBridge.js puts them
    // there for downstream forwarding).
    const stateUpdates = [];
    for (const tr of result.toolResults ?? []) {
      const ups = tr?.data?.stateUpdates;
      if (Array.isArray(ups)) stateUpdates.push(...ups);
    }
    return {
      replies:      result.replies ?? [],
      stateUpdates,
    };
  }

  /** Forward state updates to the scheduler (Phase 4). */
  #forwardStateUpdates(reply) {
    if (!this.#scheduler) return;
    if (typeof this.#scheduler.onStateUpdate !== 'function') return;
    for (const u of reply.stateUpdates ?? []) {
      try { this.#scheduler.onStateUpdate(u); }
      catch (err) {
        console.error('[HouseholdAgent] scheduler.onStateUpdate threw:', err?.message ?? err);
      }
    }
  }

  /**
   * Resolve a skillId → handler and invoke.  Catches skill errors so
   * a misbehaving skill never crashes the agent — the user sees a
   * friendly error reply instead.
   *
   * @param {string} skillId
   * @param {object} args
   * @param {import('./types.js').IncomingMessage} msg
   * @returns {Promise<import('./types.js').Reply>}
   */
  async #dispatchSkill(skillId, args, msgOrCtx) {
    const handler = SKILL_REGISTRY[skillId];
    if (!handler) {
      return {
        replies: [{ text: `Unknown command: ${skillId}.  Try \`help\`.` }],
        stateUpdates: [],
      };
    }
    // Accept either a SkillContext (has `store`) or an IncomingMessage
    // (has `bridgeId`).  Lets callers like invokeSkill pass the ctx
    // through unchanged when chaining skills.
    const ctx = msgOrCtx?.store
      ? msgOrCtx
      : buildSkillContext({ store: this.#store, msg: msgOrCtx, agent: this });
    try {
      return await handler(args, ctx);
    } catch (err) {
      return {
        replies: [{ text: `Sorry, that didn't work — ${err?.message ?? 'unknown error'}.` }],
        stateUpdates: [],
      };
    }
  }
}
