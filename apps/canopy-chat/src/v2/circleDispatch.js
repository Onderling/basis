// v2 circle free-text → dispatch — the decision a typed turn in a circle conversation goes through:
//   1. a slash command                                  → dispatch it
//   2. free text + the circle's `llmTool` is on + the bot is ADDRESSED (@tag / name)
//                                                        → interpret it as a slash command via the
//                                                          circle's LLM → dispatch the result
//   3. otherwise                                         → post it to the kring as a normal message
//
// Platform-neutral: the shell injects HOW to dispatch a slash string, HOW to post to the kring, the
// command catalog (the LLM's "tool list"), the per-circle LLM providers, and the NL→slash
// `interpret`. Web's classic shell already does step 1; this unifies 1–3 for the v2 circle surface
// (mobile `CircleLauncherScreen`) and is shared by the household bot + the feedback v2 rewire — the
// difference between them is only the catalog/interpreter (slash commands vs feedback intents).

import { selectLlmClient } from './llmPicker.js';

/**
 * @param {object} a
 * @param {object} [a.catalog]      dispatch catalog (slash commands = the LLM tool list); passed to interpret
 * @param {{llmTool?:'off'|'local'|'cloud'}|null} [a.policy]   the circle policy
 * @param {{local?:object,cloud?:object}|null} [a.llmProviders] host-supplied LlmClients
 * @param {(text:string, opts:{catalog,llm}) => Promise<{opId:string,args?:object}|null>} [a.interpret]  NL→slash
 * @param {(slash:string, ctx:object) => any|Promise<any>} a.dispatch      run a slash string (the shell's pipeline)
 * @param {(text:string, ctx:object) => any|Promise<any>} a.postToKring    post a normal kring message
 * @param {string} [a.botName]      the assistant's address/name for @-tag detection (default 'assistant')
 */
export function createCircleDispatch({ catalog, policy, llmProviders, interpret, dispatch, postToKring, botName = 'assistant' }) {
  if (typeof dispatch !== 'function' || typeof postToKring !== 'function') {
    throw new Error('createCircleDispatch: dispatch + postToKring are required');
  }
  return {
    /** Route one typed turn. Returns `{ via: 'slash'|'llm'|'kring'|'none', cmd? }`. */
    async handle(text, ctx = {}) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed) return { via: 'none' };

      // 1. explicit slash command → dispatch verbatim (the shell's normal slash pipeline).
      if (trimmed.startsWith('/')) {
        await dispatch(trimmed, ctx);
        return { via: 'slash' };
      }

      // 2. free text + the circle's LLM is enabled + the bot is addressed → interpret → dispatch.
      const llm = selectLlmClient(policy, llmProviders);
      if (llm && typeof interpret === 'function' && addressesBot(trimmed, botName)) {
        const cmd = await interpret(stripBotTag(trimmed, botName), { catalog, llm });   // → {opId,args} | null
        if (cmd && cmd.opId) {
          await dispatch(toSlash(cmd), ctx);
          return { via: 'llm', cmd };
        }
        // the LLM couldn't map it to a command → fall through to a normal post.
      }

      // 3. otherwise → post to the kring.
      await postToKring(trimmed, ctx);
      return { via: 'kring' };
    },
  };
}

/** The bot is "addressed" when the turn @-tags it or opens with its name (phase-1: tag the bot). */
export function addressesBot(text, botName) {
  const t = String(text || '').toLowerCase();
  const n = String(botName || '').toLowerCase();
  if (/(^|\s)@(bot|assistent|assistant)\b/.test(t)) return true;
  if (!n) return false;
  return t.includes('@' + n) || t.startsWith(n + ' ') || t.startsWith(n + ',');
}

function stripBotTag(text, botName) {
  const out = String(text)
    .replace(/(^|\s)@?(bot|assistent|assistant)\b[:,]?/ig, ' ')
    .replace(new RegExp('(^|\\s)@?' + escapeRe(botName) + '\\b[:,]?', 'ig'), ' ')
    .trim();
  return out || text;
}

/** {opId, args} → a slash string the shell's dispatch pipeline understands. */
function toSlash(cmd) {
  const args = cmd.args && typeof cmd.args === 'object' && Object.keys(cmd.args).length
    ? ' ' + Object.entries(cmd.args).map(([k, v]) => `--${k}=${v}`).join(' ')
    : '';
  return `/${cmd.opId}${args}`;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
