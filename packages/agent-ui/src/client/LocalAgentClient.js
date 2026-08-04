/**
 * ⚠ DELETION CANDIDATE / demote-to-fixture (decided: mark, don't delete). Only test importers remain; the
 * production half of the pair (`mountLocalUi`) lives on in the bin/ entrypoints.
 * LocalAgentClient — speaks A2A's wire shape to a `mountLocalUi`-served
 * agent (or to any A2A endpoint, really — the client doesn't care).
 *
 * Replaces the legacy `AgentUiClient`, which used a bespoke
 * `POST /api/skills/:id` shape that no other tooling can read.  A2A is
 * the standard agent-to-agent shape across the SDK; the UI process
 * speaks the same protocol as a peer.
 *
 * Three operations:
 *   - invoke(skillId, parts)        → POST /tasks/send, await JSON result
 *   - subscribe(skillId, parts, h)  → POST /tasks/sendSubscribe, SSE stream
 *   - discoverSkills()              → GET /.well-known/agent.json
 *
 * `parts` are A2A Parts. The simplest case: pass `[{ kind: 'data', data: {...} }]`
 * (the client doesn't import Parts from core to stay browser-bundle-cheap).
 * Apps composing this client can wrap their JSON args via `core.Parts.wrap`
 * if convenient.
 */

const newId = () => {
  // Browser-friendly id; no need for crypto-grade randomness on the client.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export class LocalAgentClient {
  #baseUrl;
  #fetchFn;
  #eventSourceFactory;
  #authHeader;

  /**
   * @param {object} args
   * @param {string} args.baseUrl
   * @param {(input, init?) => Promise<Response>} [args.fetchFn]
   * @param {(url: string, opts?: object) => EventSource} [args.eventSourceFactory]
   * @param {() => Promise<Record<string, string>|null>} [args.authHeader]
   *   Returns extra headers (e.g. `{Authorization: 'Bearer ...'}`) or null.
   */
  constructor({ baseUrl, fetchFn, eventSourceFactory, authHeader } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl) {
      throw new TypeError('LocalAgentClient: baseUrl required');
    }
    this.#baseUrl   = baseUrl.replace(/\/$/, '');
    this.#fetchFn   = fetchFn ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.#fetchFn !== 'function') {
      throw new TypeError('LocalAgentClient: fetch unavailable; pass fetchFn');
    }
    this.#eventSourceFactory = eventSourceFactory
      ?? ((url, opts) => new globalThis.EventSource(url, opts));
    this.#authHeader = typeof authHeader === 'function' ? authHeader : null;
  }

  /**
   * Invoke an agent skill via `POST /tasks/send` and await its result.
   *
   * @param {string} skillId
   * @param {Array<object>} [parts]   A2A Parts array; default `[]`.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=30000]
   * @returns {Promise<{ parts: Array<object>, status: string, raw: object }>}
   *   `parts` are the artifact parts from the response; `status` is
   *   the task-final status from the JSON; `raw` is the full response
   *   body for callers that need fields beyond parts.
   */
  async invoke(skillId, parts = [], opts = {}) {
    if (typeof skillId !== 'string' || !skillId) {
      throw new TypeError('LocalAgentClient.invoke: skillId required');
    }
    const { timeoutMs = 30_000 } = opts;
    const headers = await this.#buildHeaders();

    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), timeoutMs);

    let res;
    try {
      res = await this.#fetchFn(`${this.#baseUrl}/tasks/send`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:      newId(),
          skillId,
          message: { role: 'user', parts },
        }),
        signal:  ctrl.signal,
      });
    } catch (err) {
      clearTimeout(t);
      throw Object.assign(new Error(`LocalAgentClient: ${err?.message ?? err}`), {
        code: 'NETWORK_ERROR',
        cause: err,
      });
    }
    clearTimeout(t);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`LocalAgentClient: ${res.status} ${text.slice(0, 200)}`), {
        code:   'HTTP_ERROR',
        status: res.status,
      });
    }

    const body = await res.json();
    if (body.status === 'failed') {
      const msg = body.error?.message ?? body.error ?? 'Remote skill failed';
      throw Object.assign(new Error(`LocalAgentClient: ${msg}`), {
        code:   'SKILL_FAILED',
        raw:    body,
      });
    }

    const partsOut = body.artifacts?.[0]?.parts
                  ?? body.result?.parts
                  ?? body.parts
                  ?? [];
    return { parts: partsOut, status: body.status ?? 'completed', raw: body };
  }

  /**
   * Subscribe to a streaming skill via SSE (`POST /tasks/sendSubscribe`).
   *
   * @param {string} skillId
   * @param {Array<object>} [parts]
   * @param {(event: object) => void} handler
   * @param {object} [opts]
   * @returns {() => void}   close-fn
   */
  subscribe(skillId, parts, handler, opts) {
    if (typeof skillId !== 'string' || !skillId) {
      throw new TypeError('LocalAgentClient.subscribe: skillId required');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('LocalAgentClient.subscribe: handler required');
    }
    const url = `${this.#baseUrl}/tasks/sendSubscribe`
              + `?skillId=${encodeURIComponent(skillId)}`
              + `&parts=${encodeURIComponent(JSON.stringify(parts ?? []))}`;
    const es = this.#eventSourceFactory(url, opts);
    es.onmessage = (msg) => {
      try { handler(JSON.parse(msg.data)); }
      catch { handler({ raw: msg.data }); }
    };
    return () => { try { es.close(); } catch { /* ignore */ } };
  }

  /**
   * Discover the agent's published capability set.
   *
   * @returns {Promise<object>}   the agent card JSON.
   */
  async discoverSkills() {
    const headers = await this.#buildHeaders();
    const res = await this.#fetchFn(`${this.#baseUrl}/.well-known/agent.json`, { headers });
    if (!res.ok) {
      throw Object.assign(new Error(`LocalAgentClient: discover ${res.status}`), {
        code:   'HTTP_ERROR',
        status: res.status,
      });
    }
    return res.json();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async #buildHeaders() {
    if (!this.#authHeader) return {};
    const h = await this.#authHeader();
    return h ?? {};
  }
}
