// Host-supplied LLM providers for the v2 circle bot — the composition seam `llmPicker` documents.
//
// Builds the `{local, cloud}` map that `selectLlmClient(policy, providers)` chooses from. Returns an
// EMPTY map when nothing is configured, so the circle LLM branch stays inert by default (the bot only
// acts once a route is deliberately set up — same posture as the feedback app's opt-in LLM route).
//
// Local route = an Ollama-compatible endpoint (`/v1/chat/completions`, the proxy + privatemode speak
// the same protocol, so the cloud/proxy route slots in here later via the same client).

import { LlmClient } from '@onderling/llm-client';
import { ollamaProvider } from '@onderling/llm-client/providers/ollama';
import { reasoningBodyFor } from '@onderling/llm-client/providers/reasoning';
import { hmacBase64Url } from '@onderling/core';

/**
 * @param {object} [cfg]
 * @param {string|null} [cfg.localBaseUrl]   browser-reachable local/proxy LLM base URL (don't ship keys)
 * @param {string} [cfg.model]               model id (defaults to the provider's default)
 * @param {(entry:object)=>void} [cfg.audit] optional audit hook (every invoke flows through it)
 * @param {string|null} [cfg.apiKey]         Bearer key for the local/proxy route (Privatemode project key)
 * @param {string|null} [cfg.cloudApiKey]    Bearer key for the cloud route (falls back to apiKey)
 * @param {string|null} [a.cacheSecret]  a device's prompt-cache secret: each request then carries its conversation's salt
 * @returns {{local?: object, cloud?: object}}
 */
export function buildCircleLlmProviders({ localBaseUrl = null, model, audit, cloudBaseUrl = null, localModel, cloudModel, apiKey = null, cloudApiKey = null, timeoutMs, cacheSecret = null } = {}) {
  // `timeoutMs` overrides the provider's 12s default — too short for a local model's
  // first (cold-load) call (qwen2.5:7b can take 30–60s warming up), which otherwise
  // aborts mid-flight and the bot drops to "basic mode". Pass-through; the app sets a
  // generous default + an env override.
  const mk = (baseUrl, m, key) => new LlmClient({
    provider: ollamaProvider({ baseUrl: normalizeBase(baseUrl), ...(m ? { model: m } : {}), ...(key ? { apiKey: key } : {}), ...(timeoutMs != null ? { timeoutMs } : {}),
      // per request: the model family's low-reasoning switch (GLM with nothing sent reasons at max), and with a cache
      // secret the conversation's prompt-cache salt: Privatemode caches per KEY without one, so two people behind one
      // key would share a cache (the box's rule, `cacheSaltFor`; same bytes, `hmacBase64Url`)
      ...((reasoningBodyFor(m) || cacheSecret) ? { bodyFor: ({ cacheKey } = {}) => ({
        ...(reasoningBodyFor(m) ?? {}),
        ...(cacheSecret ? { cache_salt: hmacBase64Url(cacheSecret, `prompt-cache:${cacheKey ?? ''}`) } : {}),
      }) } : {}) }),
    ...(typeof audit === 'function' ? { audit } : {}),
  });
  const providers = {};
  // local + cloud both speak the OpenAI-compatible `/v1/chat/completions` protocol (ollama, the
  // confidential proxy, OpenAI-compatible cloud), so the same client serves both — only the endpoint
  // (+ the Bearer key, e.g. the Privatemode project key) differs.
  if (localBaseUrl) providers.local = mk(localBaseUrl, localModel || model, apiKey);
  if (cloudBaseUrl) providers.cloud = mk(cloudBaseUrl, cloudModel || model, cloudApiKey || apiKey);
  return providers;
}

// The provider appends `/v1/chat/completions` itself, so it wants the HOST base. Accept either the
// host (`http://h:11434`) or an already-`/v1` route (the feedback-app convention) — strip a trailing
// `/v1` so both forms work without a double `/v1` 404.
export function normalizeBase(url) {
  return String(url).replace(/\/+$/, '').replace(/\/v1$/, '');
}
