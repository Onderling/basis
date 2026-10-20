// Turn a member's saved endpoint config (userLlmDefault) into the live `{ llmProviders, embedProviders,
// mode }` the circle bot consumes — falling back to the deployment's build-time env config when the
// member hasn't set their own. Shared web + mobile so both build the runtime identically.
//
// The confidential-route guard (@onderling/llm-client/routeSafety) runs on BOTH the LLM and the embedder
// URL: embeddings send raw circle text too, so a "confidential" preset (Privatemode) pointed at a
// non-loopback host with no attestation is refused. A plain 'openai-compatible' route is the member's
// explicit non-confidential opt-in and is not gated. Pre-flight a config with `validateUserLlmConfig`
// to surface the guard message in the settings UI before persisting.

import { buildCircleLlmProviders } from './circleLlmProviders.js';
import { buildCircleEmbedProviders } from './circleEmbedProviders.js';
import { CIRCLE_LLM_ROUTE_PRESETS } from './circleLlmRoutes.js';
import { assertConfidentialRouteSafe } from '@onderling/llm-client/routeSafety';
import { resolveCircleLlm } from './llmPicker.js';

/** The provider-map key (`local`|`cloud`) a posture mode resolves to. resolveCircleLlm reads these. */
function keyForMode(mode) { return mode === 'local' ? 'local' : 'cloud'; }

/** Posture mode for a user config — derived from its preset. */
export function modeForUserCfg(cfg) {
  if (!cfg || cfg.preset === 'off' || !cfg.preset) return 'off';
  return CIRCLE_LLM_ROUTE_PRESETS[cfg.preset]?.mode ?? 'off';
}

/**
 * Validate a user LLM/embed config against the confidential-route guard.
 * @returns {string|null} a human message when a route is unsafe, else null (safe).
 */
export function validateUserLlmConfig(cfg) {
  if (!cfg || cfg.preset === 'off' || !cfg.preset) return null;
  const confidential = cfg.preset === 'confidential-proxy';
  for (const [label, url] of [['LLM', cfg.llmBaseUrl], ['embedder', cfg.embedBaseUrl]]) {
    if (!url) continue;
    try {
      assertConfidentialRouteSafe({ confidential, baseUrl: url, attestation: cfg.attestation, label: `${label} route` });
    } catch (err) { return err?.message || `${label} route is not allowed`; }
  }
  return null;
}

/**
 * Build the runtime providers from a member config, with env fallback.
 * @param {object} userCfg  normalized userLlmDefault value
 * @param {{ env?: {mode?:string, llmBaseUrl?:string, llmModel?:string, llmApiKey?:string,
 *           embedBaseUrl?:string, embedModel?:string, embedApiKey?:string, timeoutMs?:number} }} [opts]
 * @returns {{ llmProviders: object, embedProviders: object, mode: string, confidential: boolean }}
 *   `confidential` is true only when the route ACTUALLY in effect is the 'confidential-proxy' preset
 *   (Privatemode/TEE) — the signal the honest help wording (helpLlmLabelKeys) reads. A plain local /
 *   OpenAI-compatible route, or the env fallback (unless the deployment flags env.confidential), is false.
 * @throws  the guard error when a confidential route is unsafe (validate first to avoid surprises)
 */
export function buildUserLlmRuntime(userCfg, { env = {} } = {}) {
  const useUser = userCfg && userCfg.preset && userCfg.preset !== 'off';
  const confidential = useUser && userCfg.preset === 'confidential-proxy';
  // A user route is only "in effect" when it actually carries a URL. Picking a preset but leaving the
  // address blank must NOT kill the assistant — it falls back to the deployment env default (else the bot
  // silently drops to "basic mode"). User URL wins; otherwise env; else off.
  const hasUserLlm   = !!(useUser && userCfg.llmBaseUrl);
  const hasUserEmbed = !!(useUser && userCfg.embedBaseUrl);
  const mode = hasUserLlm ? modeForUserCfg(userCfg) : (env.llmBaseUrl ? 'local' : 'off');

  // ── LLM ────────────────────────────────────────────────────────────────────
  let llmProviders = {};
  if (hasUserLlm) {
    assertConfidentialRouteSafe({ confidential, baseUrl: userCfg.llmBaseUrl, attestation: userCfg.attestation, label: 'LLM route' });
    const k = keyForMode(mode);
    llmProviders = buildCircleLlmProviders({
      [`${k}BaseUrl`]: userCfg.llmBaseUrl,
      [`${k}Model`]:   userCfg.llmModel || undefined,
      apiKey:          userCfg.apiKey || null,
      timeoutMs:       env.timeoutMs,
    });
  } else if (env.llmBaseUrl) {
    llmProviders = buildCircleLlmProviders({ localBaseUrl: env.llmBaseUrl, model: env.llmModel, apiKey: env.llmApiKey, timeoutMs: env.timeoutMs });
  }

  // ── Embeddings (raw text too → same guard) ──────────────────────────────────
  let embedProviders = {};
  if (hasUserEmbed) {
    assertConfidentialRouteSafe({ confidential, baseUrl: userCfg.embedBaseUrl, attestation: userCfg.attestation, label: 'embedder route' });
    const k = keyForMode(mode);
    embedProviders = buildCircleEmbedProviders({
      [`${k}BaseUrl`]: userCfg.embedBaseUrl,
      [`${k}Model`]:   userCfg.embedModel || undefined,
      apiKey:          userCfg.apiKey || null,
    });
  } else if (env.embedBaseUrl) {
    embedProviders = buildCircleEmbedProviders({ localBaseUrl: env.embedBaseUrl, model: env.embedModel, apiKey: env.embedApiKey });
  }

  // The confidentiality of the route actually in effect: the user's confidential preset when their URL is
  // live, otherwise the deployment env's own declaration (default false — a bare local base URL is plain).
  const effectiveConfidential = hasUserLlm ? confidential : !!env.confidential;
  return { llmProviders, embedProviders, mode, confidential: effectiveConfidential };
}

/**
 * Rebuild providers from `userCfg` and apply them IN PLACE into the live `llmProviders`/`embedProviders`
 * objects the bot already holds by reference (so a settings change takes effect without a reload).
 * @returns {{ ok: true, mode: string, confidential: boolean } | { ok: false, error: string }}
 */
export function applyUserLlmRuntime({ userCfg, env, llmProviders, embedProviders }) {
  let runtime;
  try { runtime = buildUserLlmRuntime(userCfg, { env }); }
  catch (err) { return { ok: false, error: err?.message || 'invalid LLM route' }; }
  if (llmProviders) { for (const k of Object.keys(llmProviders)) delete llmProviders[k]; Object.assign(llmProviders, runtime.llmProviders); }
  if (embedProviders) { for (const k of Object.keys(embedProviders)) delete embedProviders[k]; Object.assign(embedProviders, runtime.embedProviders); }
  return { ok: true, mode: runtime.mode, confidential: runtime.confidential };
}

/**
 * The person's OWN model — the route they set in their settings (its address, its key, its budget) — for something
 * that is theirs alone (no circle). The deployment's fallback route is not theirs, so it never counts here: no route
 * set → null, and whatever asks reads without a model.
 * @param {{userCfg: object|null, providers: {local?: object, cloud?: object}}} a   the saved setting · the live providers built from it
 * @returns {object|null}   the LlmClient, or null
 */
export function ownModelClient({ userCfg, providers } = {}) {
  if (!userCfg || !userCfg.llmBaseUrl || modeForUserCfg(userCfg) === 'off') return null;
  return resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, userDefault: { mode: modeForUserCfg(userCfg) }, providers }) ?? null;
}

/**
 * `ownModelClient` straight from the saved setting, for a shell that holds the setting but not the live providers
 * (they are built here from it alone — the deployment's route is never consulted). Null on no route or a refused one.
 * @param {object|null} userCfg
 * @returns {object|null}
 */
export function ownModelOf(userCfg) {
  try { return ownModelClient({ userCfg, providers: buildUserLlmRuntime(userCfg, { env: {} }).llmProviders }); } catch { return null; }
}

