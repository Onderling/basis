/**
 * Privatemode provider — the confidential route, attested and encrypted by the vendor's SDK.
 *
 * Privatemode serves OpenAI-compatible chat completions inside a confidential VM. Its JS SDK
 * (`privatemode-ai`) verifies the deployment through remote attestation and encrypts every request
 * end-to-end on the caller's device, so no proxy stands between us and the enclave. This provider
 * is the Ollama provider (the OpenAI wire, tool-call recovery, timeouts) with its `fetch` swapped
 * for the SDK: one request shape, one parser, a different transport. Nothing about the SDK leaks
 * beyond this file.
 *
 * The key never lives in code: `PRIVATEMODE_API_KEY`, or the file `PRIVATEMODE_API_KEY_FILE`
 * (default `~/.privatemode-apikey`). A host may instead pass an `auth` provider (a rotating token
 * from a vending endpoint) — the shape for a semi-public route where no client holds the key.
 *
 * Node only today: the SDK's attestation code is a Wasm blob (28 MB), fine for a bot process,
 * not for a phone; a browser needs the SDK's explicit opt-in and a token-vending route first.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ollamaProvider } from './ollama.js';

export const PRIVATEMODE_ENDPOINT = 'https://api.privatemode.ai';
/**
 * Measured 2026-10-03 with the assistant eval (72 Dutch/English fixtures through the bot's own door, reasoning low):
 * glm-5.3 70/72, glm-5.3-flash 70/72, gpt-oss-120b 57/72 (it adds only the first of several items, answers English in
 * Dutch, and promised a reminder the bot cannot send). Kimi, the earlier default, was retired by Privatemode
 * (v1.58.0, 2026-10). So the default is glm-5.3, with glm-5.3-flash as the fallback (`assistant.fallbackModel`).
 */
export const PRIVATEMODE_DEFAULT_MODEL = 'glm-5.3';

/**
 * Privatemode has no unified reasoning switch — it is per model family (`chat_template_kwargs` for
 * Kimi and Gemma, `reasoning_effort` for gpt-oss and GLM). GLM's reasoning cannot be switched off: its
 * `reasoning_effort` takes low | high | max, and with nothing sent it reasons at max (Privatemode's models page,
 * 2026-10-03) — which is why GLM "returned nothing in 5.5 s" in September. A tool pick is a clear task:
 * reasoning off/low keeps latency and tokens down.
 * @param {string} model
 * @param {'off'|'low'|'on'} [thinking='off']
 */
export function reasoningBodyFor(model, thinking = 'off') {
  const m = String(model || '').toLowerCase();
  if (thinking === 'on') return null;
  if (/kimi/.test(m))   return { chat_template_kwargs: { thinking: false } };
  if (/gemma/.test(m))  return { chat_template_kwargs: { enable_thinking: false } };
  if (/gpt-oss/.test(m)) return { reasoning_effort: thinking === 'off' ? 'low' : thinking };
  if (/glm/.test(m))     return { reasoning_effort: 'low' };   // off and low are both its lowest
  return null;
}

/**
 * Read the key from the environment or the key file. Returns null when neither exists.
 * @param {{ env?: object, file?: string }} [a]
 */
export function readPrivatemodeKey({ env = process.env, file } = {}) {
  if (env.PRIVATEMODE_API_KEY) return String(env.PRIVATEMODE_API_KEY).trim();
  const f = file ?? env.PRIVATEMODE_API_KEY_FILE ?? path.join(homedir(), '.privatemode-apikey');
  try { const k = readFileSync(f, 'utf8').trim(); return k || null; } catch { return null; }
}

/**
 * A `fetch`-shaped door onto the SDK: the caller POSTs an OpenAI chat-completions body, the SDK
 * attests, encrypts, sends, decrypts; the caller gets a Response-like object back. Only chat
 * completions are served; anything else answers 404 in the same shape.
 *
 * @param {object} client   a `PrivatemodeAI` instance (or any object with `chat.completions.create`)
 * @param {{ extraBody?: object }} [a]  fields merged into every body (e.g. `{ reasoning_effort: 'low' }`)
 */
export function privatemodeFetch(client, { extraBody = null } = {}) {
  const respond = (status, payload) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: () => null },
    async json() { return payload; },
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload); },
  });
  return async function fetchLike(url, init = {}) {
    if (!/\/chat\/completions\/?$/.test(String(url))) return respond(404, { error: 'unsupported_endpoint' });
    let body;
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return respond(400, { error: 'bad_json' }); }
    const { stream: _stream, ...rest } = body;   // the provider never streams
    try {
      const result = await client.chat.completions.create({ ...rest, ...(extraBody ?? {}) }, init.signal ? { signal: init.signal } : undefined);
      return respond(200, result);
    } catch (err) {
      const status = Number(err?.status) || 502;
      return respond(status, String(err?.message ?? err));
    }
  };
}

/**
 * Build the provider.
 * @param {object} [a]
 * @param {string} [a.apiKey]         explicit key (else env/file via `readPrivatemodeKey`)
 * @param {Function} [a.auth]         SDK `auth` provider (rotating credential) — instead of a key
 * @param {string} [a.model]
 * @param {'off'|'low'|'on'} [a.thinking='off']  the model's reasoning: off (Kimi/Gemma switch, gpt-oss low), low, or on (model default)
 * @param {object} [a.client]         an injected SDK client (tests)
 * @param {object} [a.sdk]            an injected SDK module `{ PrivatemodeAI }` (tests / lazy load)
 * @param {number} [a.timeoutMs]
 * @param {object} [a.defaultOptions]
 * @returns {Promise<import('../types.js').LlmProvider>}
 */
export async function privatemodeProvider({ apiKey, auth, model = PRIVATEMODE_DEFAULT_MODEL, thinking = 'off', client = null, sdk = null, timeoutMs, defaultOptions } = {}) {
  let c = client;
  if (!c) {
    const key = apiKey ?? (auth ? null : readPrivatemodeKey());
    if (!key && !auth) {
      throw Object.assign(new Error('privatemode: no key — set PRIVATEMODE_API_KEY, or PRIVATEMODE_API_KEY_FILE, or ~/.privatemode-apikey'), { code: 'NO_KEY' });
    }
    const { PrivatemodeAI } = sdk ?? await import('privatemode-ai');
    c = new PrivatemodeAI(auth ? { auth } : { apiKey: key });
  }
  const extraBody = reasoningBodyFor(model, thinking);
  const base = ollamaProvider({
    baseUrl: PRIVATEMODE_ENDPOINT, model, timeoutMs, defaultOptions,
    fetchFn: privatemodeFetch(c, { extraBody }),
  });
  return {
    ...base,
    id: 'privatemode',
    requiresKey: true,
    endpoint: PRIVATEMODE_ENDPOINT,
    // The route PROMISES confidentiality — attested and end-to-end encrypted by the SDK itself (routeSafety).
    confidential: true,
    attested: true,
    /** The models the provider serves now (its own list) — what a box watches its model against. */
    async listModels() { const r = await c.models.list(); return (r?.data ?? []).map((m) => m?.id).filter(Boolean); },
  };
}
