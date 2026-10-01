/**
 * Mock provider — deterministic LLM provider for tests.
 *
 * Two construction patterns:
 *
 *   1. Static script — emit a sequence of pre-canned responses.
 *
 *      const provider = mockProvider({
 *        responses: [
 *          { toolCall: {id: 'addItems', args: {...}}, classification: 'actionable' },
 *          { replyText: 'Hello!', classification: null },
 *        ],
 *      });
 *
 *   2. Function — derive each response from the request.
 *
 *      const provider = mockProvider({
 *        invoke: async (req) => {
 *          if (req.messages.at(-1).content === 'hi') {
 *            return { replyText: 'Hello!', classification: null, raw: {} };
 *          }
 *          return { replyText: 'unknown', classification: null, raw: {} };
 *        },
 *      });
 */

/**
 * @param {object} args
 * @param {Array<Partial<import('../types.js').LlmInvocationResult>>} [args.responses]
 *   Static-script mode: ordered list of responses.  Cycles back to
 *   the start when exhausted.
 * @param {(req: import('../types.js').LlmRequest) => Promise<import('../types.js').LlmInvocationResult>} [args.invoke]
 *   Function mode: full control.  Overrides `responses` if provided.
 * @param {Array<{when: string|RegExp} & Partial<import('../types.js').LlmInvocationResult>>} [args.script]
 *   Script mode: each entry answers the first request whose newest member message matches `when` (a string is
 *   contained, case aside; a RegExp is tested), once, in order — two entries for one line answer a read, then an act.
 *   A message no entry matches is answered with nothing (no tool, no words).
 * @param {(req: import('../types.js').LlmRequest) => void} [args.onRequest]  sees every request (the prompt, the tools)
 * @param {string} [args.id='mock']
 * @param {string} [args.model]     optional model label (read by usage metering)
 * @param {string} [args.endpoint]  optional endpoint label (read by usage metering)
 * @returns {import('../types.js').LlmProvider}
 */
export function mockProvider({ responses, invoke, script, onRequest, id = 'mock', model, endpoint } = {}) {
  const labels = {
    ...(model    !== undefined ? { model }    : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
  if (Array.isArray(script)) return scriptedProvider({ script, onRequest, id, labels });
  if (typeof invoke === 'function') {
    return { id, requiresKey: false, ...labels, invoke };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new TypeError('mockProvider: provide `responses[]` or `invoke()`');
  }
  let cursor = 0;
  return {
    id,
    requiresKey: false,
    ...labels,
    async invoke() {
      const r = responses[cursor % responses.length];
      cursor++;
      return {
        toolCall:       r.toolCall       ?? null,
        classification: r.classification ?? null,
        replyText:      r.replyText      ?? null,
        raw:            r.raw            ?? {},
        ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
      };
    },
  };
}

/** The newest member message's text (string content, or its text parts). */
function lastUserText(req) {
  const msgs = Array.isArray(req?.messages) ? req.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ');
  }
  return '';
}

function scriptedProvider({ script, onRequest, id, labels }) {
  const used = new Set();
  const matches = (when, text) => (when instanceof RegExp ? when.test(text) : text.toLowerCase().includes(String(when ?? '').toLowerCase()));
  return {
    id,
    requiresKey: false,
    ...labels,
    async invoke(req) {
      try { onRequest?.(req); } catch { /* a listener never changes the answer */ }
      const text = lastUserText(req);
      const i = script.findIndex((e, n) => !used.has(n) && matches(e.when, text));
      if (i < 0) return { toolCall: null, classification: null, replyText: null, raw: {} };
      used.add(i);
      const r = script[i];
      return {
        toolCall:       r.toolCall       ?? null,
        classification: r.classification ?? null,
        replyText:      r.replyText      ?? null,
        raw:            r.raw            ?? {},
        ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
      };
    },
  };
}
