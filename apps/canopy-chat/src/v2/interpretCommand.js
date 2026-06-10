// NL → slash command, via the circle's LLM — the `interpret` half of the v2 circle free-text
// surface (`circleDispatch.js`). Maps the dispatch catalog's operations onto LLM tool descriptors,
// hands the addressed free text to the LLM, and returns the tool it called as `{opId, args}` — or
// `null` when the model treats it as chat / no command fits. The shell then dispatches `{opId,args}`
// exactly as it dispatches a button tap. Mirrors household's `classifyAndExtract` (LLM tool-call →
// dispatch by id+args), generalized to canopy-chat's manifest-merged catalog.

/** Default tool-selection prompt. Internal (LLM-facing), not a user-visible string. */
export const DEFAULT_INTERPRET_SYSTEM =
  'You turn a household member\'s message into AT MOST ONE of the available tools (commands). '
  + 'If the message clearly maps to a command, call that tool with the right arguments drawn from '
  + 'the message. If it is ordinary chat, a question, or nothing fits, do NOT call any tool — say '
  + 'nothing. Never invent arguments that are not present in the message.';

const KIND_TO_JSON_TYPE = { string: 'string', number: 'number', integer: 'integer', boolean: 'boolean' };

/**
 * Project a merged catalog's operations onto `@canopy/llm-client` ToolDescriptors
 * (`{id, description, schema}`). The tool `id` is the catalog's canonical key, so a returned
 * tool-call resolves straight back through `resolveDispatch` / the button-tap path.
 *
 * @param {{opsById?: Map<string, {op: object, appOrigin?: string}>}} catalog
 * @returns {Array<{id:string, description:string, schema:object}>}
 */
export function buildToolDescriptors(catalog) {
  const tools = [];
  const opsById = catalog && catalog.opsById;
  if (!opsById || typeof opsById.forEach !== 'function') return tools;
  for (const [key, entry] of opsById) {
    const op = entry && entry.op ? entry.op : entry;
    if (!op) continue;
    const params = Array.isArray(op.params) ? op.params : [];
    const properties = {};
    const required = [];
    for (const p of params) {
      if (!p || !p.name) continue;
      properties[p.name] = { type: KIND_TO_JSON_TYPE[p.kind] || 'string' };
      if (p.required) required.push(p.name);
    }
    tools.push({
      id: String(key),
      description: (op.surfaces && op.surfaces.chat && op.surfaces.chat.hint) || op.verb || op.id || String(key),
      schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    });
  }
  return tools;
}

/**
 * Interpret one free-text turn as a command. Returns `{opId, args}` when the LLM tool-calls, else
 * `null` (chat / no command). Signature matches what `createCircleDispatch` calls as `interpret`.
 *
 * @param {string} text
 * @param {{catalog?: object, llm?: {invoke: Function}, system?: string, options?: object, context?: any[]}} [opts]
 *        `context` = RAG items (e.g. from the token gate's `retrieve`) woven into the system prompt.
 * @returns {Promise<{opId:string, args:object}|null>}
 */
export async function interpretToCommand(text, { catalog, llm, system, options, context } = {}) {
  const q = String(text ?? '').trim();
  if (!q || !llm || typeof llm.invoke !== 'function') return null;
  const tools = buildToolDescriptors(catalog);
  if (tools.length === 0) return null;                       // nothing dispatchable → never call the LLM

  const result = await llm.invoke({
    system: withContext(system || DEFAULT_INTERPRET_SYSTEM, context),
    messages: [{ role: 'user', content: q }],
    tools,
    ...(options ? { options } : {}),
  });

  const call = result && result.toolCall;
  if (!call || !call.id) return null;                        // noise / free reply → no command
  return { opId: String(call.id), args: call.args && typeof call.args === 'object' ? call.args : {} };
}

/** Append a compact RAG-context block to the (LLM-facing) system prompt. No-op without context. */
function withContext(system, context) {
  const lines = (Array.isArray(context) ? context : []).map(contextLine).filter(Boolean);
  if (lines.length === 0) return system;
  return `${system}\n\nRelevant items already in this circle (reference only — do NOT invent commands from them):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** A context item may be a raw index entry, a string, or a semanticQuery `{entry, score}` wrapper. */
function contextLine(c) {
  const e = c && typeof c === 'object' && c.entry ? c.entry : c;
  if (e == null) return null;
  if (typeof e === 'string') return e.trim() || null;
  return e.meaning || e.label || e.text || e.id || null;
}
