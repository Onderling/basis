// Host-supplied LLM providers for the v2 circle bot — the composition seam `llmPicker` documents.
//
// Builds the `{local, cloud}` map that `selectLlmClient(policy, providers)` chooses from. Returns an
// EMPTY map when nothing is configured, so the circle LLM branch stays inert by default (the bot only
// acts once a route is deliberately set up — same posture as the feedback app's opt-in LLM route).
//
// Local route = an Ollama-compatible endpoint (`/v1/chat/completions`, the proxy + privatemode speak
// the same protocol, so the cloud/proxy route slots in here later via the same client).

import { LlmClient } from '@canopy/llm-client';
import { ollamaProvider } from '@canopy/llm-client/providers/ollama';

/**
 * @param {object} [cfg]
 * @param {string|null} [cfg.localBaseUrl]   browser-reachable local/proxy LLM base URL (don't ship keys)
 * @param {string} [cfg.model]               model id (defaults to the provider's default)
 * @param {(entry:object)=>void} [cfg.audit] optional audit hook (every invoke flows through it)
 * @returns {{local?: object, cloud?: object}}
 */
export function buildCircleLlmProviders({ localBaseUrl = null, model, audit, cloudBaseUrl = null, localModel, cloudModel } = {}) {
  const mk = (baseUrl, m) => new LlmClient({
    provider: ollamaProvider({ baseUrl: normalizeBase(baseUrl), ...(m ? { model: m } : {}) }),
    ...(typeof audit === 'function' ? { audit } : {}),
  });
  const providers = {};
  // local + cloud both speak the OpenAI-compatible `/v1/chat/completions` protocol (ollama, the
  // confidential proxy, OpenAI-compatible cloud), so the same client serves both — only the endpoint differs.
  if (localBaseUrl) providers.local = mk(localBaseUrl, localModel || model);
  if (cloudBaseUrl) providers.cloud = mk(cloudBaseUrl, cloudModel || model);
  return providers;
}

// The provider appends `/v1/chat/completions` itself, so it wants the HOST base. Accept either the
// host (`http://h:11434`) or an already-`/v1` route (the feedback-app convention) — strip a trailing
// `/v1` so both forms work without a double `/v1` 404.
export function normalizeBase(url) {
  return String(url).replace(/\/+$/, '').replace(/\/v1$/, '');
}
