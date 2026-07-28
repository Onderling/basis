/**
 * mcpShapes.js — the small set of Model Context Protocol wire shapes this
 * bridge models as plain objects.
 *
 * Per the repo's INJECTED/hermetic convention (like `@onderling/blob-gateway`,
 * `@onderling/confidential-llm`, and the `NetworkTransport`), we do NOT pull in a
 * real `@modelcontextprotocol/*` SDK. MCP messages are just JSON-RPC-ish
 * objects, so we shape them ourselves:
 *
 *   • tools/list result  → `{ tools: [{ name, description, inputSchema }] }`
 *   • tools/call params  → `{ name, arguments }`
 *   • tool result        → `{ content: [{ type:'text', text }], structuredContent? }`
 *   • tool error         → `{ isError: true, content: [{ type:'text', text }] }`
 *
 * These are the 2025-era MCP tool shapes. Fidelity is best-effort structural
 * (see `manifestToMcpTools` for the inputSchema derivation caveats); the real
 * SDK's richer result variants (image/audio/resource content, annotations)
 * are DEFERRED along with the real transport.
 */

import { TextPart, DataPart } from '@onderling/core';

/**
 * Map an inbound MCP tool-call `arguments` object into Onderling `Part[]`.
 *
 * MCP passes a JSON object of named arguments; the gated skill reads them via
 * `Parts.data(ctx.parts)`. A plain object → one `DataPart`; a bare string →
 * a `TextPart` (some tools take a single positional string); anything else →
 * no parts.
 *
 * @param {unknown} args
 * @returns {import('@onderling/core').Part[]}
 */
export function partsFromArguments(args) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return [DataPart(args)];
  }
  if (typeof args === 'string') {
    return [TextPart(args)];
  }
  return [];
}

/**
 * Build an MCP tool-result (`{ content: [...] }`) from a skill's `Part[]`.
 *
 * TextPart → `{ type:'text', text }`. DataPart → `{ type:'text', text: JSON }`
 * and is ALSO merged into a top-level `structuredContent` object (the MCP
 * structured-result surface — best-effort). Other part kinds are serialised
 * as JSON text so nothing is silently dropped.
 *
 * @param {import('@onderling/core').Part[]} parts
 * @returns {{ content: Array<{type:'text', text:string}>, structuredContent?: object }}
 */
export function mcpResult(parts) {
  const list    = Array.isArray(parts) ? parts : [];
  const content = [];
  const data    = {};
  let hasData   = false;

  for (const p of list) {
    if (p?.type === 'TextPart') {
      content.push({ type: 'text', text: p.text ?? '' });
    } else if (p?.type === 'DataPart') {
      content.push({ type: 'text', text: safeJson(p.data) });
      if (p.data && typeof p.data === 'object') { Object.assign(data, p.data); hasData = true; }
    } else if (p?.type) {
      content.push({ type: 'text', text: safeJson(p) });
    }
  }

  if (content.length === 0) content.push({ type: 'text', text: '' });

  const out = { content };
  if (hasData) out.structuredContent = data;
  return out;
}

/**
 * Build an MCP tool-ERROR result. The gate denying a call, an unknown tool,
 * or a skill failure all surface here — NEVER as a silent success.
 *
 * `isError: true` is the MCP convention for a tool-level failure (as opposed
 * to a protocol-level JSON-RPC error). We attach a coarse `_meta.code` so
 * callers/tests can distinguish deny vs unknown-tool vs misconfiguration.
 *
 * @param {string} message
 * @param {{ code?: string }} [opts]
 * @returns {{ isError: true, content: Array<{type:'text', text:string}>, _meta?: {code:string} }}
 */
export function mcpError(message, { code } = {}) {
  return {
    isError: true,
    content: [{ type: 'text', text: String(message ?? 'error') }],
    ...(code ? { _meta: { code } } : {}),
  };
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}
