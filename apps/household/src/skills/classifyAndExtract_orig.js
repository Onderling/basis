/**
 * classifyAndExtract — the LLM-mediated slow-path skill.
 *
 * Called by HouseholdAgent when the regex parser couldn't parse a
 * message AND an LlmClient is configured.  Hands the raw text to the
 * LLM with the agent's tool catalogue; if the LLM tool-calls, we
 * dispatch to the corresponding skill via `ctx.agent.invokeSkill`
 * and return its reply.  If the LLM classifies as "noise" we return
 * an empty reply.  If the LLM emits a free reply we relay it.
 *
 * v0 tool catalogue is hand-built from the static skill set (the
 * `programming-plan.md` flagged the "tool-catalogue accessor on
 * SkillRegistry" as deferrable until H3 needs it).  When that L0
 * SDK addition lands, this skill switches to using it.
 *
 * Audit hook: every LLM call goes through `LlmClient.invoke` which
 * has its own audit pipeline — this skill doesn't audit separately.
 */

import { SYSTEM_PROMPT_CLASSIFY } from '../llm/prompts.js';

/**
 * Hand-built tool catalogue for v0.  The schemas are intentionally
 * loose; the agent tolerates extra fields and missing optionals.
 */
export const V0_TOOL_CATALOGUE = Object.freeze([
  {
    id: 'addItem',
    description: 'Add a new open item to the household pod.',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['shopping', 'errand', 'repair', 'schedule'] },
        text: { type: 'string', minLength: 1 },
      },
      required: ['type', 'text'],
    },
  },
  {
    id: 'listOpen',
    description: 'List open items of a type.',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['shopping', 'errand', 'repair', 'schedule'] },
      },
      required: ['type'],
    },
  },
  {
    id: 'markComplete',
    description: 'Mark an open item complete.  match = id, id-prefix, or keyword.',
    schema: {
      type: 'object',
      properties: { match: { type: 'string', minLength: 1 } },
      required: ['match'],
    },
  },
  {
    id: 'removeItem',
    description: 'Hard-delete an item.',
    schema: {
      type: 'object',
      properties: { match: { type: 'string', minLength: 1 } },
      required: ['match'],
    },
  },
  {
    id: 'help',
    description: 'Print the command list.',
    schema: { type: 'object', properties: {} },
  },
]);

/**
 * @typedef {object} ClassifyArgs
 * @property {string} text         the raw user message
 *
 * Notes on the SkillContext:
 *  - `ctx.agent` is required and must expose `invokeSkill(skillId, args, msg)`.
 *  - `ctx.agent.llm` is required and must be an LlmClient.
 */

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function classifyAndExtract(args, ctx) {
  const text = (args?.text ?? '').trim();
  if (text.length === 0) {
    return { replies: [], stateUpdates: [] };
  }

  const llm = ctx?.agent?.llm;
  if (!llm) {
    // Defensive: agent shouldn't have routed here without an LLM.
    return {
      replies: [{ text: "I couldn't parse that — try `add <type> <text>`, `list <type>`, `done <text>`, or `help`." }],
      stateUpdates: [],
    };
  }

  /** @type {import('../llm/LlmClient.js').LlmInvocationResult} */
  let result;
  try {
    result = await llm.invoke({
      system:   SYSTEM_PROMPT_CLASSIFY,
      messages: [{ role: 'user', content: text }],
      tools:    V0_TOOL_CATALOGUE,
    });
  } catch (err) {
    return {
      replies: [{ text: `Sorry, the LLM is unreachable (${err?.message ?? 'unknown'}).  Try a structured command — \`help\`.` }],
      stateUpdates: [],
    };
  }

  // Tool call → dispatch.
  if (result.toolCall && result.toolCall.id) {
    const target = V0_TOOL_CATALOGUE.find((t) => t.id === result.toolCall.id);
    if (!target) {
      return {
        replies: [{ text: `(LLM picked an unknown tool '${result.toolCall.id}'; ignoring.)` }],
        stateUpdates: [],
      };
    }
    if (typeof ctx.agent.invokeSkill !== 'function') {
      return {
        replies: [{ text: '(Agent has no invokeSkill — internal error.)' }],
        stateUpdates: [],
      };
    }
    return ctx.agent.invokeSkill(result.toolCall.id, result.toolCall.args, ctx);
  }

  // Noise → silent.
  if (result.classification === 'noise') {
    return { replies: [], stateUpdates: [] };
  }

  // Free reply.
  if (result.replyText) {
    return { replies: [{ text: result.replyText }], stateUpdates: [] };
  }

  // Anything else → friendly fallback.
  return {
    replies: [{ text: "I'm not sure how to handle that — try `help` for the command list." }],
    stateUpdates: [],
  };
}
