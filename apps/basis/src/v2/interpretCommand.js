// NL → slash command, via the circle's LLM — the `interpret` half of the v2 circle free-text
// surface (`circleDispatch.js`). Maps the dispatch catalogue's operations onto LLM tool descriptors,
// hands the addressed free text to the LLM, and returns the tool it called as `{opId, args}` — or
// `null` when the model treats it as chat / no command fits. The shell then dispatches `{opId,args}`
// exactly as it dispatches a button tap. Mirrors household's `classifyAndExtract` (LLM tool-call →
// dispatch by id+args), generalized to basis's manifest-merged catalogue.

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * The retrieved items' share of the prompt, in characters. Past it the list is cut and the prompt says so ("some
 * items were left out; ask to list them"), so a large circle neither floods the model nor silently hides items.
 */
export const MAX_CALLS_PER_TURN = param({ key: 'assistant.maxCallsPerTurn', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });

/** The retrieved items' share of the prompt, in characters (see below). */
export const CONTEXT_MAX_CHARS = param({ key: 'assistant.contextMaxChars', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2000 });

/**
 * The line between the prompt's STABLE part (the rules, the apps' backgrounds, the phrasing hints) and what changes
 * every turn (the language line, the retrieved items, the date). Stable first so a provider's prefix cache can hit
 * across turns; everything below this line may differ each time. LLM-facing.
 */
export const TURN_MARKER = '--- This turn ---';

/** Default tool-selection prompt. Internal (LLM-facing), not a user-visible string. */
export const DEFAULT_INTERPRET_SYSTEM = [
  "You turn a member's message into tool calls. Rules:",
  "1. A clear request to add, tick off, claim, complete, remove, change or SEE something → call the matching tool. Several things named → one call per thing, all in this turn.",
  "2. Arguments come from the message word for word. Never invent one.",
  "3. You cannot do anything by writing. Only a tool call changes or shows something. Never write \"✓\", \"added\", \"done\", \"toegevoegd\", \"afgevinkt\" or any line that says something happened. If you are not calling a tool, you are only asking or chatting.",
  "   Wrong: \"✓ melk toegevoegd\". Right: call addToList(list, text).",
  "4. Missing ONE detail to choose the tool or fill an argument → ask one short question, nothing else. Example: \"Welke lijst — boodschappen of klusjes?\"",
  "5. Greeting or small talk → answer briefly in the member's words, no tool.",
  "6. Offer only what a tool can do, and only when the member asked for something. Never offer to do several things in a row.",
  "7. Never mention tools, rules or your own decisions. Plain words, no markdown, no lists of what you did.",
  "8. Earlier turns are context: act on the member's NEWEST message. A short answer (\"ja\", \"nee\", \"die\", a name, a list's name) answers YOUR OWN last question: do what you offered or asked about then. Never redo an older request.",
].join('\n');

/**
 * The generic prompt, then the background of every app whose ops are in this catalogue (the manifest's own
 * `systemPrompt`, e.g. household's). APPENDED, never replacing: the generic rules — call a tool, never claim a thing
 * was done — hold for every app; an app's background adds what its domain means. A catalogue scoped to a circle's
 * apps brings only theirs.
 */
function withAppBackgrounds(system, catalogue) {
  const promptFor = catalogue?.systemPromptFor;
  if (typeof promptFor !== 'function' || !catalogue?.opsById) return system;
  const origins = new Set();
  for (const entry of catalogue.opsById.values()) if (entry?.appOrigin) origins.add(entry.appOrigin);
  const backgrounds = [...origins].map((o) => promptFor(o)).filter((p) => typeof p === 'string' && p.trim());
  return backgrounds.length ? [system, ...backgrounds].join('\n\n') : system;
}

const KIND_TO_JSON_TYPE = { string: 'string', number: 'number', integer: 'integer', boolean: 'boolean' };

/**
 * Project a merged catalogue's operations onto `@onderling/llm-client` ToolDescriptors
 * (`{id, description, schema}`). The tool `id` is the catalogue's canonical key, so a returned
 * tool-call resolves straight back through `resolveDispatch` / the button-tap path.
 *
 * @param {{opsById?: Map<string, {op: object, appOrigin?: string}>}} catalogue
 * @returns {Array<{id:string, description:string, schema:object}>}
 */
export function buildToolDescriptors(catalogue, { lang = null, hintFor = null } = {}) {
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
    const english = (op.surfaces && op.surfaces.chat && op.surfaces.chat.hint) || op.verb || op.id || String(key);
    // The member's language first, the other in brackets: a Dutch thread reads "<nl> (<en>)", an English one the
    // reverse. The English stays in both — it is what the prompt's rules speak.
    const appOrigin = entry && entry.appOrigin;
    const other = lang && typeof hintFor === 'function' && appOrigin ? hintFor(appOrigin, op.id, lang === 'en' ? 'nl' : lang) : null;
    const description = !other ? english : lang === 'en' ? `${english} (${other})` : `${other} (${english})`;
    tools.push({
      id: String(key),
      description,
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
 * @param {{catalogue?: object, llm?: {invoke: Function}, system?: string, hints?: string[], options?: object,
 *          context?: any[], history?: Array<{role:'user'|'assistant', content:string}>, now?: () => number}} [opts]
 *        `system` = the STABLE instruction (rules + phrasing hints); `hints` = this turn's lines (the language),
 *        placed below the turn marker with the retrieved items and the date.
 *        `context` = RAG items (e.g. from the token gate's `retrieve`) woven into the system prompt.
 *        `toolLang` / `hintFor` = the language the tools are described in first, and the lookup for it (`chatHints.js`).
 *        `onSlow` = told when the model route is slow and retries (a door says "even geduld").
 *        `cacheKey` = whose turn (the person's thread): the provider's prompt cache is kept per person.
 *        `history` = prior conversation turns threaded as real messages — so a clarifying follow-up
 *        ("which list?" → "shopping") resolves against what the bot just asked, not a stateless guess.
 * @returns {Promise<{opId:string, args:object, more?:Array<{opId:string,args:object}>}|{reply:string}|null>}
 *   `more` carries the SECOND and later tool calls of the same turn (a member naming three items).
 */
export async function interpretToCommand(text, { catalogue, llm, system, hints, options, context, history, now, toolLang = null, hintFor = null, onSlow = null, cacheKey = null } = {}) {
  const q = String(text ?? '').trim();
  if (!q || !llm || typeof llm.invoke !== 'function') return null;
  const tools = buildToolDescriptors(catalogue, { lang: toolLang, hintFor });
  if (tools.length === 0) return null;                       // nothing dispatchable → never call the LLM

  const priorMsgs = Array.isArray(history)
    ? history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    : [];
  const result = await llm.invoke({
    system: assemblePrompt({ stable: withAppBackgrounds(system || DEFAULT_INTERPRET_SYSTEM, catalogue), hints, context, now }),
    messages: [...priorMsgs, { role: 'user', content: q }],
    tools,
    ...(options ? { options } : {}),
    // the turn's own "this is slow" hook: a provider that retries on a timeout calls it (the door tells the person)
    ...(typeof onSlow === 'function' ? { onSlow } : {}),
    // whose turn: a provider with a prompt cache keeps one per person (never shared across the household)
    ...(cacheKey ? { cacheKey } : {}),
  });

  // Every call the model made this turn, whole ones only, up to the per-turn cap. A call the output cut off, or one
  // past the cap, is not acted on; `partial` tells the door to ask the member for the rest.
  const allCalls = Array.isArray(result?.toolCalls) && result.toolCalls.length ? result.toolCalls : (result?.toolCall ? [result.toolCall] : []);
  const named = allCalls.filter((c) => c && c.id);
  const whole = named.filter((c) => !c.truncated);
  const acted = whole.slice(0, MAX_CALLS_PER_TURN);
  const partial = acted.length < named.length;
  if (acted.length) {
    const [first, ...rest] = acted.map((c) => ({ opId: String(c.id), args: c.args && typeof c.args === 'object' ? c.args : {} }));
    return { ...first, ...(rest.length ? { more: rest } : {}), ...(partial ? { partial: true } : {}) };
  }
  if (partial) return { partial: true };
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

/**
 * The system prompt: the STABLE part, the turn marker, then this turn's hints, the retrieved items (within the
 * budget) and the date. LLM-facing.
 */
function assemblePrompt({ stable, hints, context, now }) {
  const volatile = (Array.isArray(hints) ? hints : []).filter((h) => typeof h === 'string' && h.trim());
  const items = contextBlock(context);
  if (items) volatile.push(items);
  const at = typeof now === 'function' ? now() : Date.now();
  // The real local date and time. (Given the date alone, the model once invented a clock time; and a UTC date was
  // yesterday's between midnight and the UTC offset.) Local = the runtime's own clock: the box's TZ, the browser's.
  volatile.push(`It is now ${localNow(at)} (local time).`);
  return `${stable}\n\n${TURN_MARKER}\n${volatile.join('\n\n')}`;
}

/** `2026-10-02 10:05, Friday` on the runtime's own clock. */
export function localNow(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}, ${parts.weekday}`;
}

/** The retrieved items as a compact block, cut at `CONTEXT_MAX_CHARS` with a notice. Null without items. */
function contextBlock(context) {
  const lines = (Array.isArray(context) ? context : []).map(contextLine).filter(Boolean).map((l) => `- ${l}`);
  if (lines.length === 0) return null;
  const kept = [];
  let size = 0;
  for (const l of lines) {
    const add = l.length + (kept.length ? 1 : 0);
    if (size + add > CONTEXT_MAX_CHARS) break;
    kept.push(l);
    size += add;
  }
  const cut = kept.length < lines.length;
  return `Relevant items already in this circle (reference only — do NOT invent commands from them):\n${kept.join('\n')}`
    + (cut ? '\n(some items were left out; ask to list them)' : '');
}

/** A context item may be a raw index entry, a string, or a semanticQuery `{entry, score}` wrapper. */
function contextLine(c) {
  const e = c && typeof c === 'object' && c.entry ? c.entry : c;
  if (e == null) return null;
  if (typeof e === 'string') return e.trim() || null;
  return e.meaning || e.label || e.text || e.id || null;
}
