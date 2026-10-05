/**
 * LlmClient — provider-agnostic OpenAI-style tool-calling client.
 *
 * Ported from apps/household/src/llm/LlmClient.js into the substrate
 * package (per L1j sketch: split out from L1c so multiple consumers
 * can share the LLM access — H2 chat, future H4/H7 NL search).
 *
 * Apps construct an LlmClient with a provider plugin; the client
 * routes invoke() through the provider and runs the audit hook.
 *
 * Usage:
 *
 *   import { LlmClient } from '@onderling/llm-client';
 *   import { ollamaProvider } from '@onderling/llm-client/providers/ollama';
 *
 *   const llm = new LlmClient({
 *     provider: ollamaProvider({ baseUrl, model: 'qwen2.5:7b-instruct' }),
 *     audit:    (entry) => botPod.appendAudit(entry),
 *   });
 *   const result = await llm.invoke({ system, messages, tools });
 *
 * Per-customer usage metering (optional, injected seam — see metering.js):
 *
 *   const llm = new LlmClient({
 *     provider, meter: usageSink, customerId: 'acme', endpoint: 'enclave',
 *   });
 *   // …or attribute per call (a shared multi-tenant client):
 *   await llm.invoke(req, { customerId: 'acme' });
 *
 * When no `meter` is supplied the client behaves byte-identically to before.
 */
import { usageForCompletion } from './metering.js';
import { log } from '@onderling/logger';

export class LlmClient {
  /** @type {import('./types.js').LlmProvider} */ #provider;
  /** @type {(entry: import('./types.js').AuditEntry) => Promise<void>|void} */ #audit;
  /** @type {import('./metering.js').MeterSink|null} */ #meter;
  #customerId; #endpoint; #model;

  /**
   * @param {object} args
   * @param {import('./types.js').LlmProvider} args.provider
   * @param {(entry: import('./types.js').AuditEntry) => Promise<void>|void} [args.audit]
   * @param {import('./metering.js').MeterSink} [args.meter]
   *   Usage sink; called once per successful invoke with a `UsageEvent`.
   *   Omit for the exact prior behaviour (no metering).
   * @param {string} [args.customerId]  default tenant attribution (per-call overridable)
   * @param {string} [args.endpoint]    endpoint label for events (defaults to provider.endpoint)
   * @param {string} [args.model]       model label for events (defaults to provider.model)
   */
  constructor({ provider, audit, meter, customerId, endpoint, model } = {}) {
    if (!provider || typeof provider.invoke !== 'function') {
      throw new TypeError('LlmClient: provider with invoke() required');
    }
    this.#provider   = provider;
    this.#audit      = typeof audit === 'function' ? audit : () => {};
    this.#meter      = typeof meter === 'function' ? meter : null;
    this.#customerId = customerId ?? null;
    this.#endpoint   = endpoint ?? provider.endpoint ?? null;
    this.#model      = model ?? provider.model ?? null;
  }

  /**
   * @param {import('./types.js').LlmRequest} req
   * @param {{customerId?: string, endpoint?: string, model?: string}} [ctx]
   *   Per-call metering attribution; overrides the construction-time defaults.
   * @returns {Promise<import('./types.js').LlmInvocationResult>}
   */
  async invoke(req, ctx = {}) {
    const ts = Date.now();
    // PII-SAFE: model/endpoint/provider are stable route labels (not content);
    // msgs/tools are COUNTS. No prompt text is ever logged.
    log.info('llm', 'llm.request', {
      provider: this.#provider.id,
      ...(this.#model ? { model: this.#model } : {}),
      ...(this.#endpoint ? { endpoint: this.#endpoint } : {}),
      msgs:  Array.isArray(req?.messages) ? req.messages.length : 0,
      tools: Array.isArray(req?.tools) ? req.tools.length : 0,
    });
    let result;
    try {
      result = await this.#provider.invoke(req);
    } catch (err) {
      // PII-SAFE: error NAME + provider label + duration only — never the prompt.
      log.error('llm', 'llm.error', {
        provider: this.#provider.id,
        err: err?.name ?? 'Error',
        ms: Date.now() - ts,
      });
      try {
        await this.#audit({
          ts, kind: 'llm.invoke.error', providerId: this.#provider.id,
          input:  { system: req.system, messages: req.messages },
          output: { error: err?.message ?? String(err) },
        });
      } catch { /* audit failures must never crash the agent */ }
      throw err;
    }
    try {
      await this.#audit({
        ts, kind: 'llm.invoke.ok', providerId: this.#provider.id,
        input:  { system: req.system, messages: req.messages },
        output: result,
      });
    } catch { /* same */ }
    // PII-SAFE: duration + COUNTS only (token counts, reply char count, #tool
    // calls). replyChars is a length, never the reply text itself.
    let tok = null;
    try { tok = usageForCompletion(req, result); } catch { /* logging must never crash */ }
    log.info('llm', 'llm.response', {
      provider: this.#provider.id,
      ms: Date.now() - ts,
      replyChars: typeof result?.replyText === 'string' ? result.replyText.length : 0,
      toolCalls: Array.isArray(result?.toolCalls)
        ? result.toolCalls.length
        : (result?.toolCall ? 1 : 0),
      ...(tok ? { promptTokens: tok.promptTokens, cachedPromptTokens: tok.cachedPromptTokens, completionTokens: tok.completionTokens, estimated: tok.estimated } : {}),
    });
    if (this.#meter) {
      try {
        const usage = usageForCompletion(req, result);
        this.#meter({
          customerId:       ctx.customerId ?? this.#customerId,
          endpoint:         ctx.endpoint   ?? this.#endpoint,
          model:            ctx.model      ?? this.#model,
          promptTokens:     usage.promptTokens,
          cachedPromptTokens: usage.cachedPromptTokens ?? 0,
          completionTokens: usage.completionTokens,
          requests:         1,
          // whose call (the request's cacheKey, a person's thread) — a host counts each person's own use
          subject:          req?.cacheKey ?? null,
          estimated:        usage.estimated,
          kind:             'completion',
        });
      } catch { /* metering must never crash the agent */ }
    }
    return result;
  }

  get providerId()  { return this.#provider.id; }
  get requiresKey() { return Boolean(this.#provider.requiresKey); }
}
