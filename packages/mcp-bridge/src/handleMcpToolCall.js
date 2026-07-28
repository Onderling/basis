/**
 * handleMcpToolCall.js — INBOUND direction (MCP tools/call → gated dispatch).
 *
 * An inbound MCP `tools/call` (`{ name, arguments }`) is mapped to Onderling's
 * `{ opId: name, args }` and dispatched THROUGH the capability gate. It uses
 * the SAME gated path #63's remote-handler tier uses:
 *
 *   • `dispatchRemoteOp(agent, registry, name, parts, opts)` — when a
 *     `RemoteHandlerRegistry` is supplied, this routes over A2A via
 *     `agent.invoke` (kernel `callSkill`); the receiver's PolicyEngine gates
 *     the token. This is byte-for-byte the #63 path — we add nothing to the
 *     gate.
 *   • `agent.invoke(target, skillId, parts, opts)` — when a `target` address
 *     is supplied directly (no registry). Still `callSkill`, still gated.
 *
 * The gate is SACRED (CLAUDE.md — the waist): a missing / revoked / wrong-
 * scope / invalid capability token makes `agent.invoke` REJECT, and the
 * receiver's gate rejects BEFORE the skill handler runs — so a denied call is
 * never executed. We catch that rejection and surface it as an MCP
 * `{ isError: true }` result. An unknown tool (not bound in the registry, or
 * not declared by an optional `manifest`) returns an MCP error WITHOUT
 * dispatching at all. We never call a handler directly and never bypass the
 * gate.
 */

import { dispatchRemoteOp, NOT_REMOTE } from '@onderling/secure-agent';
import { partsFromArguments, mcpResult, mcpError } from './mcpShapes.js';
import { manifestHasOp } from './internal/manifestHasOp.js';

/**
 * Handle an inbound MCP tool-call by dispatching it through the gate.
 *
 * @param {import('@onderling/core').Agent} agent   — the dispatching agent (holds the capability tokens)
 * @param {{ name: string, arguments?: object }} toolCall — MCP tools/call params
 * @param {object} [opts]
 * @param {import('@onderling/secure-agent').RemoteHandlerRegistry} [opts.registry]
 *        — op→remote-handler map; when present, dispatch goes via dispatchRemoteOp
 * @param {string} [opts.target]   — target agent address (used when no registry)
 * @param {string} [opts.skillId]  — skill id override (defaults to the tool name)
 * @param {import('@onderling/app-manifest').Manifest} [opts.manifest]
 *        — when present, the tool name MUST be a declared op or it's rejected as unknown
 * @param {...*} [opts.rest]        — forwarded to dispatchRemoteOp / agent.invoke (timeout, ttl, …)
 * @returns {Promise<object>} an MCP tool-result or an MCP `{ isError:true }` error
 */
export async function handleMcpToolCall(agent, toolCall, opts = {}) {
  const name = toolCall?.name;
  if (typeof name !== 'string' || !name) {
    return mcpError('MCP tools/call: `name` (non-empty string) is required', { code: 'invalid_request' });
  }

  const { registry, target, skillId, manifest, ...invokeOpts } = opts;

  // Unknown-tool guard (when the caller pins a manifest): a call for an op the
  // manifest doesn't declare is rejected WITHOUT dispatch.
  if (manifest && !manifestHasOp(manifest, name)) {
    return mcpError(`Unknown tool: ${name}`, { code: 'unknown_tool' });
  }

  const parts = partsFromArguments(toolCall?.arguments);

  try {
    let out;
    if (registry) {
      // Same gated path as #63 remote dispatch.
      out = await dispatchRemoteOp(agent, registry, name, parts, invokeOpts);
      if (out === NOT_REMOTE) {
        // Not bound to any handler → unknown tool, and crucially NOT dispatched.
        return mcpError(`Unknown tool: ${name}`, { code: 'unknown_tool' });
      }
    } else {
      if (typeof target !== 'string' || !target) {
        return mcpError(
          'MCP tools/call: opts.registry or opts.target (agent address) is required',
          { code: 'misconfigured' },
        );
      }
      out = await agent.invoke(target, skillId ?? name, parts, invokeOpts);
    }
    return mcpResult(out);
  } catch (err) {
    // Gate DENY (missing / revoked / invalid / wrong-scope token) or skill
    // failure. The gate rejects before the handler runs, so a denied call is
    // never executed — the denial surfaces as an MCP error, never a silent run.
    return mcpError(err?.message ?? String(err), { code: 'denied_or_failed' });
  }
}
