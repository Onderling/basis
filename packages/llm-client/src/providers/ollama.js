/**
 * Ollama provider — local LLM via the OpenAI-compatible chat-completions
 * endpoint at `${baseUrl}/v1/chat/completions`.
 *
 * Default port: 11434 (Ollama's standard).  Default model:
 * `qwen2.5:7b-instruct`.
 *
 * Tool-call recovery (v0.2.0+):
 *   - Native `tool_calls` (Qwen 2.5, Llama 3.1+, Mistral 7B v0.3) are
 *     parsed as-is.
 *   - When the model emits tool-call intent in plain text (common with
 *     7B Q4 models — geitje, mistral can do this), the loose parser
 *     recovers it.  Recognised shapes:
 *       JSON blobs:
 *         {"tool":"x","args":{...}}        — substrate convention
 *         {"name":"x","arguments":{...}}   — OpenAI tool_call shape
 *         {"function":"x","arguments":{...}}
 *       Anywhere in the reply (handles "blings\n{...}" prefixed noise).
 *       Multiple blobs in one reply → multiple recovered calls.
 *     JS-call syntax (only when the tool catalogue is provided):
 *         addToList("boodschappen", "kaas")
 *         showList(listName="boodschappen")
 *       Positional args mapped to the tool's schema parameter order
 *       (required first, then the rest).
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL    = 'qwen2.5:7b-instruct';
export const OLLAMA_DEFAULT_MODEL = DEFAULT_MODEL;

/**
 * Models for which we've already logged the "does not support tools"
 * warning.  Module-level so we don't spam stderr per turn.
 * @type {Set<string>}
 */
const _warnedToolless = new Set();

/**
 * @param {object} [args]
 * @param {string} [args.baseUrl]
 * @param {string} [args.model]
 * @param {(input, init?) => Promise<Response>} [args.fetchFn]   Test seam.
 * @param {object} [args.defaultOptions]
 *   Per-provider sampling defaults.  Merged shallowly with each
 *   `invoke` call's `options`; per-call values win.  Useful for
 *   pinning behaviour across an agent (e.g. `{temperature: 0.1,
 *   stop: ['\nUser:']}` for stricter, prompt-echo-resistant output).
 * @returns {import('../types.js').LlmProvider}
 */
export function ollamaProvider({
  baseUrl        = DEFAULT_BASE_URL,
  model          = DEFAULT_MODEL,
  fetchFn        = globalThis.fetch,
  defaultOptions = null,
  // Abort the request after this many ms so an unreachable / stalled endpoint (e.g. a dropped
  // `adb reverse` to a local ollama) fails FAST and gracefully instead of hanging the turn for
  // minutes (device-verify 2026-06-11: a flaky reverse hung an interpret call ~5 min). 0/false
  // disables the timeout. Per-call `options.timeoutMs` overrides.
  timeoutMs      = 12000,
} = {}) {
  return {
    id: 'ollama',
    requiresKey: false,
    async invoke({ system, messages, tools, options }) {
      const opts = { ...(defaultOptions ?? {}), ...(options ?? {}) };
      const baseBody = {
        model,
        messages: [
          { role: 'system', content: system },
          ...messages,
        ],
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens   !== undefined ? { max_tokens: opts.maxTokens   } : {}),
        ...(opts.topP        !== undefined ? { top_p:      opts.topP        } : {}),
        ...(opts.stop        !== undefined ? { stop:        opts.stop       } : {}),
        stream: false,
      };
      const hasTools = Array.isArray(tools) && tools.length > 0;
      const url      = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

      // Per-call timeout override; 0/false disables. An AbortController fires after the budget so a
      // stalled endpoint rejects fast (→ the gate path / a graceful "couldn't reach the assistant"
      // rather than a multi-minute hang). The timer is cleared on every settle.
      const budget = options?.timeoutMs ?? timeoutMs;
      const post = (body) => {
        const ctl = budget ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), budget) : null;
        return fetchFn(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body:    JSON.stringify(body),
          ...(ctl ? { signal: ctl.signal } : {}),
        }).finally(() => { if (timer) clearTimeout(timer); });
      };

      // First attempt — with tools (if any).
      let res = await post(hasTools ? { ...baseBody, tools: tools.map(toOpenAITool) } : baseBody);

      // Auto-fallback: some Ollama Modelfiles (e.g. geitje 7B Ultra
      // Q4_K_M) lack a tool template, so any request with `tools`
      // set returns 400 "does not support tools".  Retry without
      // tools — the system prompt has presumably listed them, and
      // parseLooseToolCalls will recover any tool intent the model
      // emits in plain text via the descriptors we still pass to
      // parseOpenAIChatResponse below.
      if (!res.ok && hasTools) {
        const text = await res.text().catch(() => '');
        if (/does not support tools/i.test(text)) {
          if (!_warnedToolless.has(model)) {
            _warnedToolless.add(model);
            // eslint-disable-next-line no-console
            console.error(
              `[ollama-provider] WARN: model "${model}" has no tool template; ` +
              `retrying without \`tools\`. Tool intent in the model's text reply ` +
              `will be recovered by parseLooseToolCalls (descriptors threaded through).`,
            );
          }
          res = await post(baseBody);
        } else {
          throw Object.assign(new Error(`ollama: ${res.status} ${text.slice(0, 200)}`),
            { code: 'PROVIDER_ERROR', status: res.status });
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`ollama: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
      }
      const json = await res.json();
      // Pass the tool catalogue through so the loose parser can
      // recognise JS-call syntax against the known tool ids.
      return parseOpenAIChatResponse(json, { descriptors: tools });
    },
  };
}

/**
 * Translate our `ToolDescriptor` to OpenAI's tool-spec shape.
 * @param {import('../types.js').ToolDescriptor} t
 */
function toOpenAITool(t) {
  return {
    type: 'function',
    function: {
      name:        t.id,
      description: t.description ?? '',
      parameters:  t.schema ?? { type: 'object', properties: {} },
    },
  };
}

/**
 * Parse an OpenAI-style chat-completion response and return our
 * normalised `LlmInvocationResult`.
 *
 * @param {object} resp
 * @param {{descriptors?: Array<{id: string, schema?: object}>}} [options]
 *   Tool catalogue — when provided, the loose parser also recognises
 *   JS-call syntax (`funcName("x", "y")`) for the listed tool ids.
 * @returns {import('../types.js').LlmInvocationResult}
 */
export function parseOpenAIChatResponse(resp, options = {}) {
  const choice = resp?.choices?.[0];
  const msg    = choice?.message ?? {};

  // 1. Native tool_calls — pass through (most reliable path).
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const calls = msg.tool_calls.map((tc) => {
      let args = {};
      try {
        args = typeof tc.function?.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments ?? {});
      } catch { args = {}; }
      return { id: tc.function?.name ?? '', args };
    });
    return {
      toolCall:       calls[0],
      ...(calls.length > 1 ? { toolCalls: calls } : {}),
      classification: 'actionable',
      replyText:      null,
      raw:            resp,
    };
  }

  // 2. Loose-parser pass over text content.
  const text  = (msg.content ?? '').trim();
  const looseCalls = parseLooseToolCalls(text, options);
  if (looseCalls.length > 0) {
    if (process.env.LLM_DEBUG_LOOSE_PARSER === '1') {
      // eslint-disable-next-line no-console
      console.error(`[loose-parser] recovered ${looseCalls.length} call(s):`,
        JSON.stringify(looseCalls));
    }
    // Preserve the surrounding natural-language portion as
    // replyText.  Critical for tool-less models (geitje) that emit
    // JSON + a Dutch confirmation in one turn — without this, the
    // confirmation gets dropped, ChatAgent doesn't record an
    // assistant turn, and the LLM re-emits prior tool calls on
    // subsequent turns thinking they were missed.
    const stripped = stripJsonBlobs(text);
    return {
      toolCall:       looseCalls[0],
      ...(looseCalls.length > 1 ? { toolCalls: looseCalls } : {}),
      classification: 'actionable',
      replyText:      stripped.length > 0 ? stripped : null,
      raw:            resp,
    };
  }

  // 3. Heuristic noise detection.
  const lower      = text.toLowerCase();
  const normalised = lower.replace(/^[\s'"`]+|[\s.!?'"`]+$/g, '');
  if (normalised === 'noise' || /["']?classification["']?\s*:\s*["']noise["']/.test(lower)) {
    return { toolCall: null, classification: 'noise', replyText: null, raw: resp };
  }

  // 4. Free reply text.
  return { toolCall: null, classification: null, replyText: text || null, raw: resp };
}

/**
 * Loose tool-call extractor — back-compat single-call API.  Returns
 * the FIRST recovered call from `text`, or null.  Use
 * `parseLooseToolCalls` for full multi-call recovery.
 *
 * @param {string} text
 * @param {{descriptors?: Array<{id: string, schema?: object}>}} [options]
 * @returns {{id: string, args: object} | null}
 */
export function parseLooseToolCall(text, options = {}) {
  const calls = parseLooseToolCalls(text, options);
  return calls.length > 0 ? calls[0] : null;
}

/**
 * Recover any number of tool calls from a free-text reply.  See
 * module-doc above for the recognised shapes.
 *
 * @param {string} text
 * @param {{descriptors?: Array<{id: string, schema?: object}>}} [options]
 * @returns {Array<{id: string, args: object}>}
 */
export function parseLooseToolCalls(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];

  /** @type {Array<{id: string, args: object}>} */
  const calls = [];

  // Pre-clean: some models (mistral 7B observed) emit JSON with
  // backslash-escaped braces ("\{ "name": ... \}").  Strip those
  // before scanning so the JSON-blob finder sees clean braces.
  const cleaned = text.replace(/\\([{}])/g, '$1');

  // 1. JSON-blob recovery — works without a tool catalogue.
  for (const blob of findJsonBlobs(cleaned)) {
    let obj;
    try { obj = JSON.parse(blob); } catch { continue; }
    const call = normaliseJsonCall(obj);
    if (call) calls.push(call);
  }

  // 2. JS-call syntax — needs the tool catalogue to know which
  //    function names map to tools and how positional args fit
  //    into each tool's schema.
  const descriptors = Array.isArray(options.descriptors) ? options.descriptors : [];
  if (descriptors.length > 0) {
    for (const call of parseJsCalls(text, descriptors)) {
      // Avoid double-counting if the same call was already recovered
      // via JSON-shape (e.g. when the model emits both forms).
      if (!calls.some((c) => sameCall(c, call))) calls.push(call);
    }
  }

  // 3. Natural-language patterns (Dutch + English).  Last resort —
  //    catches when the model "explains" the action in prose
  //    instead of emitting JSON / JS-call.  E.g. geitje observed
  //    saying "❌ appels is klaar, mark done." without any JSON.
  //    Patterns require an item word; listName falls back to a
  //    sensible default (the most-recently-mentioned list, or
  //    `boodschappen` if nothing else is known).
  if (descriptors.length > 0 && options.naturalLanguage !== false) {
    const defaultList = options.defaultListName ?? 'boodschappen';
    for (const call of parseNaturalLanguageCalls(text, descriptors, defaultList)) {
      if (!calls.some((c) => sameCall(c, call))) calls.push(call);
    }
  }

  return calls;
}

// ─── JSON-blob recovery ──────────────────────────────────────────

/**
 * Remove all top-level `{...}` blobs from the text, leaving only
 * the surrounding natural-language portion.  Used by
 * `parseOpenAIChatResponse` to preserve the model's accompanying
 * reply text ("Toegevoegd!") when its JSON tool calls are
 * recovered from content — so downstream consumers can record the
 * assistant's natural-language acknowledgement in conversation
 * history (preventing the "missed-turn re-emission" failure mode
 * observed with geitje).
 *
 * @param {string} text
 * @returns {string} text with JSON blobs stripped + whitespace tidied
 */
export function stripJsonBlobs(text) {
  if (typeof text !== 'string') return '';
  const blobs = findJsonBlobs(text);
  if (blobs.length === 0) return text;
  let result = text;
  // Process longest blob first to avoid partial-overlap issues if
  // two blobs happen to share a substring.
  for (const blob of [...blobs].sort((a, b) => b.length - a.length)) {
    result = result.split(blob).join('');
  }
  // Tidy: collapse 3+ newlines to 2; strip leading/trailing space.
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Find every top-level `{...}` blob in the text, respecting string
 * quoting + escapes + arbitrary internal nesting.  Returns the raw
 * blob substrings (caller decides whether they parse / matter).
 */
function findJsonBlobs(text) {
  const blobs = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"')  { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end < 0) break;
    blobs.push(text.slice(start, end + 1));
    i = end + 1;
  }
  return blobs;
}

/**
 * Normalise a parsed JSON object into a tool call.  Recognises:
 *   {tool: "x", args: {...}}            (substrate convention)
 *   {name: "x", arguments: {...}}        (OpenAI tool_call)
 *   {function: "x", arguments: {...}}    (variant)
 *   {function: {name, arguments}}        (nested OpenAI variant)
 *
 * `arguments` may be a string or an object.
 */
function normaliseJsonCall(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // Nested OpenAI shape: {function: {name, arguments}}
  if (obj.function && typeof obj.function === 'object' && !Array.isArray(obj.function)) {
    const inner = obj.function;
    return normaliseJsonCall({ name: inner.name, arguments: inner.arguments });
  }

  const name = obj.tool ?? obj.name ?? obj.function;
  const argsRaw = obj.args ?? obj.arguments ?? obj.parameters;
  if (typeof name !== 'string' || name.length === 0) return null;

  let args;
  if (argsRaw == null) {
    args = {};
  } else if (typeof argsRaw === 'string') {
    try { args = JSON.parse(argsRaw); } catch { return null; }
  } else {
    args = argsRaw;
  }
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  return { id: name, args };
}

// ─── JS-call recovery ────────────────────────────────────────────

/**
 * Find every `funcName(args)` occurrence in the text where funcName
 * matches one of the descriptor ids.
 */
function parseJsCalls(text, descriptors) {
  const calls = [];
  for (const d of descriptors) {
    if (!d || typeof d.id !== 'string') continue;
    const idEsc = d.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: funcName(<argsStr>)  — argsStr has no nested parens.
    // Word boundary on the function name (so 'addToList' doesn't
    // match inside 'doAddToListThing'); standalone or after
    // whitespace/punctuation.
    const re = new RegExp(`(?:^|[^a-zA-Z0-9_])(${idEsc})\\s*\\(([^)]*)\\)`, 'g');
    let m;
    while ((m = re.exec(text))) {
      const argsStr = m[2];
      const args    = parseJsArgList(argsStr, d.schema);
      if (args !== null) calls.push({ id: d.id, args });
    }
  }
  return calls;
}

/**
 * Parse the contents of `(...)` into an args object.  Tries named
 * form first (key="val", key2: "val2") then positional.
 */
function parseJsArgList(argsStr, schema) {
  if (typeof argsStr !== 'string') return null;
  const trimmed = argsStr.trim();
  if (trimmed === '') return {};

  // Named form: key=val or key:val pairs.  We need ALL of trimmed to
  // be covered by named-arg matches, otherwise fall back to positional.
  const namedArgs = {};
  const namedRe = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null|-?\d+(?:\.\d+)?)/g;
  let lastEnd = 0;
  let allConsumed = true;
  for (const m of trimmed.matchAll(namedRe)) {
    // Verify the gap between matches contains only commas/whitespace.
    if (m.index < lastEnd) { allConsumed = false; break; }
    const gap = trimmed.slice(lastEnd, m.index);
    if (!/^[\s,]*$/.test(gap)) { allConsumed = false; break; }
    namedArgs[m[1]] = parseLiteral(m[2]);
    lastEnd = m.index + m[0].length;
  }
  if (Object.keys(namedArgs).length > 0 && allConsumed
      && /^[\s,]*$/.test(trimmed.slice(lastEnd))) {
    return namedArgs;
  }

  // Positional form — match each literal in order.
  const positional = [];
  const litRe = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null|-?\d+(?:\.\d+)?)/g;
  for (const m of trimmed.matchAll(litRe)) {
    positional.push(parseLiteral(m[1]));
  }
  if (positional.length === 0) return null;
  return mapPositionalToSchema(positional, schema);
}

function parseLiteral(s) {
  if (s.startsWith('"') || s.startsWith("'")) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  if (s === 'true')  return true;
  if (s === 'false') return false;
  if (s === 'null')  return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function mapPositionalToSchema(positional, schema) {
  const paramNames = paramNamesFromSchema(schema);
  const args = {};
  for (let i = 0; i < positional.length && i < paramNames.length; i++) {
    args[paramNames[i]] = positional[i];
  }
  return args;
}

function paramNamesFromSchema(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const all = Object.keys(schema.properties ?? {});
  const order = [...required];
  for (const k of all) if (!order.includes(k)) order.push(k);
  return order;
}

function sameCall(a, b) {
  return a.id === b.id && JSON.stringify(a.args ?? {}) === JSON.stringify(b.args ?? {});
}

// ─── Natural-language pattern recovery (Dutch + English) ────────
//
// Last-resort fallback for models that "explain" tool intent in
// prose instead of emitting structured calls or JSON.  Narrow
// patterns to minimise false positives.  Only fires when the
// model uses unambiguously action-shaped language (e.g.
// "<item> is klaar", "verwijder <item>", "voeg <item> toe").
//
// Note: only fires when the descriptors list contains the tool
// id we'd produce.  So a household app with [addToList,
// removeFromList, showList] gets all three; an app without
// removeFromList won't accidentally have remove sentences fire.

const NL_PATTERNS = [
  // "<item> is klaar/gedaan/af/binnen/opgehaald" → removeFromList
  { regex: /(?:^|[\s.,;:!"'(])([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\d_-]*(?:[\s][a-zA-ZÀ-ÿ\d_-]+)?)\s+is\s+(?:klaar|gedaan|af|binnen|opgehaald|done|finished)\b/gi,
    toolId: 'removeFromList', argKey: 'match' },

  // "verwijder <item>" / "schrap <item>" → removeFromList
  { regex: /\b(?:verwijder|schrap)\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\d_-]*(?:[\s][a-zA-ZÀ-ÿ\d_-]+)?)\b/gi,
    toolId: 'removeFromList', argKey: 'match' },

  // "haal <item> van" → removeFromList
  { regex: /\bhaal\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\d_-]*(?:[\s][a-zA-ZÀ-ÿ\d_-]+)?)\s+(?:van|af)\b/gi,
    toolId: 'removeFromList', argKey: 'match' },
];

function parseNaturalLanguageCalls(text, descriptors, defaultListName) {
  const calls = [];
  const ids = new Set(descriptors.map((d) => d.id));
  const lower = text.toLowerCase();

  // Try to detect a list name mentioned in the text — gives the
  // recovered call a better chance of matching the actual list
  // (e.g. "appels van boodschappen" → list="boodschappen").
  let mentionedList = null;
  for (const d of descriptors) {
    // Look for tool-arg listName values we can guess at — but
    // descriptors only carry IDs, not values.  So we look for
    // common Dutch list words instead.
  }
  for (const candidate of ['boodschappen', 'klusjes', 'shopping', 'errands', 'books', 'gifts']) {
    if (lower.includes(candidate)) { mentionedList = candidate; break; }
  }
  const listName = mentionedList ?? defaultListName;

  for (const { regex, toolId, argKey } of NL_PATTERNS) {
    if (!ids.has(toolId)) continue;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const item = m[1].trim();
      // Reject obviously wrong matches (e.g. "I am ..." — pronouns).
      if (/^(de|het|een|i|ik|jij|hij|zij|we|wij|the|a|an)$/i.test(item)) continue;
      calls.push({
        id: toolId,
        args: { listName, [argKey]: item },
      });
    }
  }
  return calls;
}
