/**
 * ⏸ PARKED for commercialisation (decided): built for a per-customer billing model that never shipped;
 * the portfolio's licensing ideas will want usage metering, so it waits rather than dies. NB the sibling
 * endpoint half WAS superseded (basis's circleLlmRoutes is the live route resolver) and its file is now
 * DELETED per "no duplicates": the one idea unique to it — customer→endpoint selection for per-customer
 * deployments — is part of THIS parked billing model and is re-derivable from git (`endpoints.js`) or
 * re-designed fresh when commercialisation lands. Nothing the live path needed was lost: circle routes
 * select by CIRCLE policy, not by customer, and never consumed it.
 * Per-customer usage metering for @onderling/llm-client.
 *
 * A plain, injectable seam — NO global state, NO persistence, NO DB.  A
 * consumer passes a `meter` callback (the "sink") when constructing an
 * `LlmClient` / `EmbeddingClient`; after each completed call the client
 * emits ONE `UsageEvent` to that sink attributed to a customer/tenant id.
 * When no sink is supplied, behaviour is byte-identical to before (the
 * clients simply skip the emit).  Aggregation / billing / scheduled roll-up
 * live elsewhere (per the org roadmap) — this module only produces events
 * and offers a tiny in-memory aggregator for tests.
 *
 * Token counting:
 *   - When the provider response exposes real counts we use them
 *     (`estimated: false`).  Two wire shapes are recognised:
 *       · OpenAI-compatible  `usage.{prompt_tokens, completion_tokens}`
 *       · Ollama native       `{prompt_eval_count, eval_count}`
 *   - Otherwise we fall back to a char/4 estimate (`estimated: true`) so a
 *     provider that hides usage still meters something usable.
 *
 * @typedef {object} UsageEvent
 * @property {string|null} customerId   tenant the usage is attributed to
 * @property {string|null} endpoint     endpoint name / base (label only)
 * @property {string|null} model        model id (label only)
 * @property {number} promptTokens      input tokens (real or estimated)
 * @property {number} completionTokens  output tokens (real or estimated)
 * @property {number} requests          request count for this event (1 per call)
 * @property {boolean} estimated        true when tokens are a char/4 estimate
 * @property {'completion'|'embedding'} kind
 *
 * @typedef {(evt: UsageEvent) => void} MeterSink
 */

/** rough token estimate: ~4 chars per token (English/Dutch prose + JSON). */
function estTokens(chars) {
  return Math.max(0, Math.ceil((chars || 0) / 4));
}

/**
 * Pull real token counts out of a provider's raw response, if present.
 * Recognises the OpenAI-compatible `usage` block and Ollama's native
 * `prompt_eval_count` / `eval_count`.  Returns null when neither is present
 * (caller then falls back to an estimate).
 *
 * @param {any} raw
 * @returns {{promptTokens:number, completionTokens:number} | null}
 */
export function extractTokenCounts(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const u = raw.usage;
  if (u && typeof u === 'object'
      && (u.prompt_tokens != null || u.completion_tokens != null)) {
    return {
      promptTokens:     Number(u.prompt_tokens)     || 0,
      completionTokens: Number(u.completion_tokens) || 0,
    };
  }

  if (raw.prompt_eval_count != null || raw.eval_count != null) {
    return {
      promptTokens:     Number(raw.prompt_eval_count) || 0,
      completionTokens: Number(raw.eval_count)        || 0,
    };
  }

  return null;
}

/**
 * Derive prompt/completion token counts for one completion.  Prefers real
 * counts from `result.raw`; otherwise estimates from the request + result
 * text.
 *
 * @param {import('./types.js').LlmRequest} req
 * @param {import('./types.js').LlmInvocationResult} result
 * @returns {{promptTokens:number, completionTokens:number, estimated:boolean}}
 */
export function usageForCompletion(req, result) {
  const real = extractTokenCounts(result?.raw);
  if (real) return { ...real, estimated: false };

  const promptChars =
    (req?.system?.length ?? 0) +
    (Array.isArray(req?.messages)
      ? req.messages.reduce((n, m) => n + (m?.content?.length ?? 0), 0)
      : 0);

  const replyChars = result?.replyText?.length ?? 0;
  const calls = Array.isArray(result?.toolCalls)
    ? result.toolCalls
    : (result?.toolCall ? [result.toolCall] : []);
  const toolChars = calls.reduce(
    (n, c) => n + JSON.stringify(c?.args ?? {}).length + (c?.id?.length ?? 0), 0);

  return {
    promptTokens:     estTokens(promptChars),
    completionTokens: estTokens(replyChars + toolChars),
    estimated:        true,
  };
}

/**
 * Estimate prompt tokens for an embedding call (embeddings endpoints rarely
 * return usage; we always estimate — completionTokens is 0 for embeddings).
 *
 * @param {string[]} texts
 * @returns {{promptTokens:number, completionTokens:number, estimated:boolean}}
 */
export function usageForEmbedding(texts) {
  const chars = (Array.isArray(texts) ? texts : [texts])
    .reduce((n, t) => n + (typeof t === 'string' ? t.length : String(t ?? '').length), 0);
  return { promptTokens: estTokens(chars), completionTokens: 0, estimated: true };
}

/**
 * In-memory usage aggregator — for tests and simple local roll-ups.  NOT a
 * store: no persistence, no eviction.  Its `.sink` is a `MeterSink` you pass
 * as the client's `meter`; totals accumulate per customerId, with a per
 * endpoint+model breakdown.
 *
 * @returns {{
 *   sink: MeterSink,
 *   get: (customerId?: string|null) => (object|null),
 *   snapshot: () => object[],
 *   total: () => object,
 *   reset: () => void,
 * }}
 */
export function createUsageAggregator() {
  /** @type {Map<string, any>} */
  const byCustomer = new Map();
  const keyOf = (c) => (c == null ? '(unknown)' : String(c));

  /** @type {MeterSink} */
  function sink(evt) {
    if (!evt || typeof evt !== 'object') return;
    const k = keyOf(evt.customerId);
    const cur = byCustomer.get(k) ?? {
      customerId:        evt.customerId ?? null,
      requests:          0,
      promptTokens:      0,
      completionTokens:  0,
      estimatedRequests: 0,
      byEndpoint:        {},
    };
    const reqs = evt.requests ?? 1;
    cur.requests         += reqs;
    cur.promptTokens     += evt.promptTokens ?? 0;
    cur.completionTokens += evt.completionTokens ?? 0;
    if (evt.estimated) cur.estimatedRequests += reqs;

    const ek = `${evt.endpoint ?? '?'}::${evt.model ?? '?'}`;
    const eb = cur.byEndpoint[ek] ?? {
      endpoint: evt.endpoint ?? null,
      model:    evt.model ?? null,
      requests: 0, promptTokens: 0, completionTokens: 0,
    };
    eb.requests         += reqs;
    eb.promptTokens     += evt.promptTokens ?? 0;
    eb.completionTokens += evt.completionTokens ?? 0;
    cur.byEndpoint[ek] = eb;

    byCustomer.set(k, cur);
  }

  return {
    sink,
    get:      (customerId) => byCustomer.get(keyOf(customerId)) ?? null,
    snapshot: () => Array.from(byCustomer.values()).map((v) => ({ ...v })),
    total() {
      let requests = 0, promptTokens = 0, completionTokens = 0;
      for (const v of byCustomer.values()) {
        requests += v.requests;
        promptTokens += v.promptTokens;
        completionTokens += v.completionTokens;
      }
      return { requests, promptTokens, completionTokens };
    },
    reset: () => byCustomer.clear(),
  };
}
