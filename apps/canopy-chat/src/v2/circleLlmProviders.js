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
export function buildCircleLlmProviders({ localBaseUrl = null, model, audit } = {}) {
  const providers = {};
  if (localBaseUrl) {
    providers.local = new LlmClient({
      provider: ollamaProvider({ baseUrl: localBaseUrl, ...(model ? { model } : {}) }),
      ...(typeof audit === 'function' ? { audit } : {}),
    });
  }
  return providers;
}
