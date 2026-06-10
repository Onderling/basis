// circleLlmRoutes.js — per-circle LLM route config: a small set of STARTER PRESETS a deployment picks
// from (local / confidential-proxy / cloud + endpoint), turned into the `{local, cloud}` providers map
// that `resolveCircleLlm` chooses from (per the circle's `llmTool` policy). The presets pair with the
// posture menukaart: a household circle on P2 typically uses 'local-ollama' or 'confidential-proxy'.

import { buildCircleLlmProviders } from './circleLlmProviders.js';

/** @typedef {{ label:string, mode:'off'|'local'|'cloud', baseUrl:string|null, model?:string, needsEndpoint?:boolean }} RoutePreset */

/** Named starter presets. `needsEndpoint` ones expect the deployment to supply `baseUrl` (don't ship keys). */
export const CIRCLE_LLM_ROUTE_PRESETS = Object.freeze({
  'off':                { label: 'Off (no assistant)',               mode: 'off',   baseUrl: null },
  'local-ollama':       { label: 'Local (Ollama)',                   mode: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct' },
  'confidential-proxy': { label: 'Confidential proxy (Privatemode)', mode: 'cloud', baseUrl: null, model: undefined, needsEndpoint: true },
  'openai-compatible':  { label: 'Cloud (OpenAI-compatible)',        mode: 'cloud', baseUrl: null, model: undefined, needsEndpoint: true },
});

/** Resolve a preset name (+ optional `{baseUrl, model}` overrides) → a concrete route config. */
export function resolveRoutePreset(name, overrides = {}) {
  const base = CIRCLE_LLM_ROUTE_PRESETS[name] || CIRCLE_LLM_ROUTE_PRESETS.off;
  return { ...base, ...overrides, preset: name in CIRCLE_LLM_ROUTE_PRESETS ? name : 'off' };
}

/**
 * Build the `{local, cloud}` providers map from one or more route configs (preset-resolved). A config
 * without an endpoint, or `mode:'off'`, contributes nothing — so an unconfigured route stays inert.
 * @param {Array<{mode?:string, baseUrl?:string|null, model?:string}>|object} routes
 */
export function buildProvidersFromRoutes(routes = []) {
  const list = Array.isArray(routes) ? routes : [routes];
  const cfg = {};
  for (const r of list) {
    if (!r || !r.baseUrl || r.mode === 'off') continue;
    if (r.mode === 'local') { cfg.localBaseUrl = r.baseUrl; cfg.localModel = r.model; }
    else if (r.mode === 'cloud') { cfg.cloudBaseUrl = r.baseUrl; cfg.cloudModel = r.model; }
  }
  return buildCircleLlmProviders(cfg);
}
