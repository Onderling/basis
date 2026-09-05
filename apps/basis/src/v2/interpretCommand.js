// NL → slash command, via the circle's LLM — the `interpret` half of the v2 circle free-text
// surface (`circleDispatch.js`). Maps the dispatch catalogue's operations onto LLM tool descriptors,
// hands the addressed free text to the LLM, and returns the tool it called as `{opId, args}` — or
// `null` when the model treats it as chat / no command fits. The shell then dispatches `{opId,args}`
// exactly as it dispatches a button tap. Mirrors household's `classifyAndExtract` (LLM tool-call →
// dispatch by id+args), generalized to basis's manifest-merged catalogue.

/** Default tool-selection prompt. Internal (LLM-facing), not a user-visible string. */
export const DEFAULT_INTERPRET_SYSTEM =
  'You are the assistant in a shared circle. When a member\'s message is a clear request to DO or SEE '
  + 'something, call AT MOST ONE matching tool — this INCLUDES requests to view, list, or show data (use '
  + 'the matching list/open tool). Take arguments verbatim from the message; never invent them.\n'
  + 'When no single tool clearly fits:\n'
  + '- If you only need ONE detail to choose the right tool or argument, reply with a SHORT clarifying '
  + 'question to the member (e.g. "Which list — shopping or tasks?").\n'
  + '- If it is ordinary chat or a greeting, reply briefly and naturally.\n'
  + 'A reply of yours DOES NOTHING: only a tool call adds, completes or shows anything. Never claim that '
  + 'something was added or done, and never write a confirmation line (no ✓) — call the tool instead.\n'
  + 'Always address the MEMBER directly in plain language. NEVER describe your own tool-calling decision — '
  + 'do not say things like "no tool call needed" or "this is a general question"; the member must never '
  + 'see that. When in doubt between acting and asking, ASK a short question rather than guessing a tool.';

const KIND_TO_JSON_TYPE = { string: 'string', number: 'number', integer: 'integer', boolean: 'boolean' };

/**
 * Project a merged catalogue's operations onto `@onderling/llm-client` ToolDescriptors
 * (`{id, description, schema}`). The tool `id` is the catalogue's canonical key, so a returned
 * tool-call resolves straight back through `resolveDispatch` / the button-tap path.
 *
 * @param {{opsById?: Map<string, {op: object, appOrigin?: string}>}} catalogue
 * @returns {Array<{id:string, description:string, schema:object}>}
 */
export function buildToolDescriptors(catalogue) {
  const tools = [];
  const opsById = catalogue && catalogue.opsById;
  if (!opsById || typeof opsById.forEach !== 'function') return tools;
  for (const [key, entry] of opsById) {
    const op = entry && entry.op ? entry.op : entry;
    if (!op) continue;
    // Part G enabler — only ops that declare a chat surface are LLM tools. No-op for the current
    // catalogue (every op has surfaces.chat); it lets a merged REAL manifest carry internal/destructive
    // ops (deleteFromPod, forceRepush, …) without the model ever proposing them.
    if (!op.surfaces || !op.surfaces.chat) continue;
    const params = Array.isArray(op.params) ? op.params : [];
    const properties = {};
    const required = [];
    for (const p of params) {
      if (!p || !p.name) continue;
      const prop = { type: KIND_TO_JSON_TYPE[p.kind] || 'string' };
      // Pass enum values through so the model knows the valid choices (e.g. addItem.type ∈
      // {shopping,errand,repair,schedule}) — without this it sends a bare string and can't tell
      // addItem (a typed list) apart from addTask (a generic chore), so "add X to the shopping list"
      // mis-routes to addTask. The enum is the strongest signal for correct tool + arg selection.
      if (p.kind === 'enum' && Array.isArray(p.of) && p.of.length) prop.enum = p.of.slice();
      properties[p.name] = prop;
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
 * @param {{catalogue?: object, llm?: {invoke: Function}, system?: string, options?: object, context?: any[],
 *          history?: Array<{role:'user'|'assistant', content:string}>}} [opts]
 *        `context` = RAG items (e.g. from the token gate's `retrieve`) woven into the system prompt.
 *        `history` = prior conversation turns threaded as real messages — so a clarifying follow-up
 *        ("which list?" → "shopping") resolves against what the bot just asked, not a stateless guess.
 * @returns {Promise<{opId:string, args:object}|{reply:string}|null>}
 */
export async function interpretToCommand(text, { catalogue, llm, system, options, context, history } = {}) {
  const q = String(text ?? '').trim();
  if (!q || !llm || typeof llm.invoke !== 'function') return null;
  const tools = buildToolDescriptors(catalogue);
  if (tools.length === 0) return null;                       // nothing dispatchable → never call the LLM

  const priorMsgs = Array.isArray(history)
    ? history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    : [];
  const result = await llm.invoke({
    system: withContext(system || DEFAULT_INTERPRET_SYSTEM, context),
    messages: [...priorMsgs, { role: 'user', content: q }],
    tools,
    ...(options ? { options } : {}),
  });

  const call = result && result.toolCall;
  if (call && call.id) {
    return { opId: String(call.id), args: call.args && typeof call.args === 'object' ? call.args : {} };
  }
  // No tool — surface the model's conversational reply (a clarifying question, a short answer) so the
  // bot can CONVERSE instead of dead-ending on "couldn't turn that into an action". `{reply}` carries
  // no opId, so dispatch treats it as a spoken reply rather than a command. null = nothing usable.
  const reply = result && typeof result.replyText === 'string' ? result.replyText.trim() : '';
  // A reply that LOOKS like an act ("✓ added to shopping: …") is a fabrication — the model copied the shape
  // of an earlier confirmation instead of calling the tool (seen live 2026-09-05: two items "added" that
  // never landed). Drop it; the caller's no-match path answers honestly.
  if (reply && looksLikeConfirmation(reply)) return null;
  return reply ? { reply } : null;
}

/** A reply shaped like a system confirmation — a check mark, or "added/done/marked …" as the first words. */
export function looksLikeConfirmation(text) {
  const t = String(text ?? '').trim();
  return /^[✓✔☑]/.test(t) || /^(added|toegevoegd|marked complete|afgevinkt|done|gedaan|removed|verwijderd)\b/i.test(t);
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
