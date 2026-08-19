/**
 * llmChat —: LLM tool-calling on top of Stoop's chat surface.
 *
 * **Layering** (per `PLAN-gui-chat-uplift.md`):
 *   - Stoop's existing chat is bilateral peer-to-peer via
 *     `@onderling/chat-p2p` (`apps/stoop/src/chat/wireChat.js`), driven by
 *     the `respondToItem` / `sendChatMessage` skill pair.  That stays
 *     unchanged.
 *   - D.1 declared the 13-op `stoopManifest` (`apps/stoop/manifest.js`)
 *     with both slash commands AND chat hints.  Slash is already live;
 *     this file adds the chat (free-text) side.
 *   - D.2 (this file) lays an LLM tool-calling layer over the existing
 *     chat surface using `renderChat(stoopManifest, …)` →
 *     `@onderling/chat-agent` `ChatAgent`.  Free-text → LLM → manifest op
 *     dispatch; the LLM picks one of the 13 tools and invokes the
 *     underlying SDK skill via this adapter.
 *
 * Mirrors `apps/household/src/HouseholdAgent.js`'s renderChat wiring
 * (lines 100–145) and `apps/tasks-v0/src/mountable.js`'s SDK-skill-to-
 * renderChat adapter (`adaptSdkSkill` / `stringifyReply`).  Stoop's
 * skills are SDK-native (`({parts, from, agent}) → reply-object`), so
 * the same adapter pattern applies.
 *
 * Slash commands continue to take the regex fast path (the consumer
 * dispatches them directly via `bundle.agent.skills.get(opId).handler`
 * — that's unchanged).  Free text falls through to `onFreeText`.
 *
 * **No package.json change in:** `@onderling/llm-client` is NOT
 * imported here — callers pass in any `llm` exposing `invoke(req)`
 * (real or mock).  See `apps/stoop/test/chat-llm.test.js`.
 */

import { ChatAgent }   from '@onderling/chat-agent';
import { renderChat }  from '@onderling/app-manifest';
import { DataPart }    from '@onderling/core';

import { stoopManifest } from '../../manifest.js';

/**
 * Convert any stoop skill's raw return value into a chat-friendly text
 * line.  Skills return plain JSON objects (e.g. `{requestId, claims}`,
 * `{items: [...]}`, `{error}`); the LLM tool-call channel needs text.
 *
 * Per-op formatters (when richer text helps a human read the chat
 * reply) come AFTER a generic JSON-stringify fallback.  Adding more
 * formatters is purely additive — tests cover the substantive paths.
 *
 * @param {string} opId
 * @param {*} reply
 * @returns {string}
 */
function formatReply(opId, reply) {
  if (reply == null) return 'ok';
  if (typeof reply === 'string') return reply;
  if (reply.error) return `error: ${reply.error}`;

  switch (opId) {
    case 'postRequest': {
      const id = reply.requestId ?? reply.id ?? '<no-id>';
      return `posted (${id})`;
    }
    case 'cancelRequest': {
      return `withdrawn`;
    }
    case 'markReturned': {
      return `marked as returned`;
    }
    case 'listOpen':
    case 'listMyRequests': {
      const items = Array.isArray(reply.items) ? reply.items : [];
      if (items.length === 0) return '(no open items)';
      const lines = items.slice(0, 20).map((it) => {
        const intent = it.intent ?? it.kind ?? it.type ?? '?';
        const text   = it.text ?? '';
        return `- [${intent}] ${text}`;
      });
      return lines.join('\n');
    }
    default: {
      try { return JSON.stringify(reply); }
      catch { return String(reply); }
    }
  }
}

/**
 * Build a `renderChat`-compatible adapter for a single stoop SDK skill.
 *
 * @param {{ id: string, handler: function }} skillDef
 * @param {object} agent  the underlying `core.Agent`
 * @returns {(args: object, skillCtx: object) => Promise<{replies: Array, stateUpdates: Array}>}
 */
function adaptSdkSkill(skillDef, agent) {
  return async (args, skillCtx) => {
    const reply = await skillDef.handler({
      parts:    [DataPart(args ?? {})],
      from:     skillCtx?.senderWebid ?? skillCtx?.actorWebid ?? skillCtx?.from ?? null,
      agent,
      envelope: null,
    });
    return {
      replies:      [{ text: formatReply(skillDef.id, reply) }],
      // SDK skills mutate the ItemStore directly — there are no
      // householdesque stateUpdates to forward through the scheduler.
      // Mirror tasks-v0's mountable convention.
      stateUpdates: [],
    };
  };
}

/**
 * Build the manifest-op-id → renderChat-adapter map from a live
 * stoop bundle.  Walks `stoopManifest.operations` and looks up each
 * skill on the bundle's agent.  Ops without a backing skill are
 * skipped (renderChat treats them as "unknown tool" at runtime, which
 * is the manifest-drift signal — better than silent failure).
 *
 * @param {object} bundle  the bundle returned by `createNeighbourhoodAgent`
 * @returns {{ skillRegistry: Record<string, function>, missing: string[] }}
 *   `missing` is a diagnostic for tests / boot-time logging.
 */
/**
 * Part G dissolve (2026-06-17) — the manifest now also carries the
 * chat-shell ops folded in from basis's former mockStoopManifest.
 * Two of them are SEMANTIC ALIASES of a real stoop skill (mirrors
 * basis's `STOOP_OP_ALIAS`): resolve them here so the standalone
 * stoop LLM chat binds them to the right skill.
 */
const STOOP_OP_ALIAS = {
  listFeed:        'listOpen',
  getStoopProfile: 'getMyProfile',
};

/**
 * Ops that are basis-SHELL-ONLY surfaces (customRenderer wizards,
 * the [DM] button alias, and the realAgent-synthesized /groups op).
 * They have NO backing skill in the standalone stoop substrate — the
 * functionality lives in the basis client (side-panel wizards) or
 * is synthesized by the basis realAgent adapter.  They are NOT a
 * manifest-drift signal for the standalone bundle, so the registry
 * builder skips them rather than reporting them `missing`.
 */
const SHELL_ONLY_OPS = new Set([
  'startDm',                    // basis [DM] button → ensureDmThread
  'getCurrentGroup',            // synthesized in realAgent (single-circle /groups)
  'restoreFromMnemonicWizard',  // customRenderer
  'conflictDisputeWizard',      // customRenderer
  'postAudienceWizard',         // customRenderer
  'encryptedBackupWizard',      // customRenderer
  'createGroupWizard',          // customRenderer
  'joinGroupWizard',            // customRenderer
]);

export function buildStoopSkillRegistry(bundle) {
  if (!bundle?.agent?.skills?.get) {
    throw new TypeError('buildStoopSkillRegistry: bundle.agent.skills required');
  }
  const skillRegistry = {};
  const missing = [];
  for (const op of stoopManifest.operations) {
    if (SHELL_ONLY_OPS.has(op.id)) continue;   // no standalone substrate skill
    const skillId = STOOP_OP_ALIAS[op.id] ?? op.id;
    const def = bundle.agent.skills.get(skillId);
    if (!def) { missing.push(op.id); continue; }
    // Register under the MANIFEST op id (so the LLM tool catalogue +
    // dispatch key on op.id); the adapter targets the resolved skill.
    skillRegistry[op.id] = adaptSdkSkill(def, bundle.agent);
  }
  return { skillRegistry, missing };
}

/** Exported for tests — the ops with no standalone-substrate skill. */
export const STOOP_SHELL_ONLY_OPS = SHELL_ONLY_OPS;

/**
 * Create the LLM chat adapter for a live stoop bundle.
 *
 * @param {object} args
 * @param {object} args.bundle    a `createNeighbourhoodAgent` bundle
 * @param {object} args.llm       any LlmClient-shaped object (`invoke(req)`)
 * @param {string} [args.localActor]  webid to attribute LLM-triggered
 *   skill calls to.  Defaults to `bundle.agent.identity?.webid` or
 *   `'urn:stoop:local'` — tests pass an explicit value for clarity.
 * @param {object} [args.chatAgentOpts]  forwarded to the underlying
 *   `ChatAgent` ctor (e.g. `historyDepth`, `sessionTtlMs`,
 *   `suppressFreeTextOnToolCalls`).
 * @returns {{
 *   chatAgent: ChatAgent,
 *   skillRegistry: Record<string, function>,
 *   missingSkills: string[],
 *   onFreeText: (text: string, ctx?: object) => Promise<{replies: Array, toolResults: Array}>,
 * }}
 */
export function createLlmChat({ bundle, llm, localActor, chatAgentOpts = {} } = {}) {
  if (!bundle) throw new TypeError('createLlmChat: bundle required');
  if (!llm || typeof llm.invoke !== 'function') {
    throw new TypeError('createLlmChat: llm with invoke() required');
  }

  const { skillRegistry, missing } = buildStoopSkillRegistry(bundle);

  const { toolCatalogue, toolHandlers, systemPrompt } = renderChat(stoopManifest, {
    skillRegistry,
    // Each tool call hands the SDK adapter a `skillCtx` matching the
    // stoop skill convention (`senderWebid` is the actor).  ChatAgent
    // calls toolHandlers with `(args, toolCtx)` where toolCtx already
    // carries `actorWebid` + `chatId`; renderChat itself forwards
    // through this mapper.
    toSkillCtx: (toolCtx) => ({
      senderWebid: toolCtx?.actorWebid,
      chatId:      toolCtx?.chatId,
      bridgeId:    toolCtx?.bridgeId,
    }),
    // Stoop has no scheduler today — doesn't add one.
  });

  const chatAgent = new ChatAgent({
    bridges:        [],            // headless — caller drives via onFreeText
    llm,
    toolCatalogue,
    toolHandlers,
    systemPrompt,
    contextBuilder: noopContextBuilder,
    ...chatAgentOpts,
  });

  // Default attribution for synthesised IncomingMessages.
  const defaultActor = localActor
    ?? bundle.agent?.identity?.webid
    ?? 'urn:stoop:local';

  /**
   * Free-text entry point.  Builds a minimal IncomingMessage shape and
   * runs the LLM tool-calling loop.  Slash commands should be filtered
   * out BEFORE calling this (the existing chat surface dispatches
   * slash directly via `bundle.agent.skills.get(...).handler(...)`).
   *
   * @param {string} text
   * @param {object} [ctx]
   * @param {string} [ctx.chatId='stoop:llm']
   * @param {string} [ctx.senderWebid]   defaults to localActor / agent webid
   * @param {string} [ctx.bridgeId='stoop-llm']
   * @returns {Promise<{replies: Array<{text: string}>, toolResults: Array<object>}>}
   */
  async function onFreeText(text, ctx = {}) {
    if (typeof text !== 'string' || text.length === 0) {
      return { replies: [], toolResults: [] };
    }
    const msg = {
      bridgeId:    ctx.bridgeId    ?? 'stoop-llm',
      chatId:      ctx.chatId      ?? 'stoop:llm',
      messageId:   ctx.messageId   ?? `stoop-llm-${Date.now()}`,
      sender: {
        webid:       ctx.senderWebid ?? defaultActor,
        displayName: ctx.displayName ?? 'stoop-user',
        bridgeUid:   ctx.bridgeUid   ?? (ctx.senderWebid ?? defaultActor),
      },
      text,
      replyTo:     null,
      isAddressed: true,
    };
    return chatAgent.processMessage(msg);
  }

  return { chatAgent, skillRegistry, missingSkills: missing, onFreeText };
}

/**
 * Default contextBuilder — stoop's free-text channel has no NL pod-state
 * preamble (mirrors household's `noopContextBuilder`).  A future Slice
 * (E?) may inject per-group / per-actor context here.
 */
async function noopContextBuilder() { return ''; }

export { noopContextBuilder };
