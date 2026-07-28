/**
 * manifestToMcpTools.js — EXPORT direction (Onderling skills → MCP tools).
 *
 * A PURE projector (no I/O): it turns an app `manifest.js` into an MCP
 * `tools/list` result. Each declared op becomes one MCP tool:
 *
 *   op.id                     → tool.name
 *   op.surfaces.chat.hint     → tool.description   (falls back to verb+noun)
 *   op.params                 → tool.inputSchema   (JSON Schema)
 *
 * The inputSchema is derived structurally by reusing `@onderling/app-manifest`'s
 * `paramsToJsonSchema` — the SAME projector that already feeds the LLM tool
 * catalogue — so the MCP surface and the chat/LLM surface stay one source of
 * truth (CLAUDE.md invariant #4: the manifest is the contract for surfaces).
 *
 * Fidelity is best-effort structural:
 *   • An op with NO declared `params` → a permissive `{ type:'object',
 *     additionalProperties:true }` schema (noted in the description).
 *   • If `paramsToJsonSchema` cannot model a param kind, the tool falls back
 *     to the permissive schema rather than failing the whole projection.
 * Rich validation (coercion, formats) stays where it already lives in
 * basis's form layer; MCP clients get a structural contract only.
 */

import { paramsToJsonSchema } from '@onderling/app-manifest';

const PERMISSIVE_SCHEMA = { type: 'object', additionalProperties: true };

/**
 * Project a manifest into an MCP `tools/list` result.
 *
 * @param {import('@onderling/app-manifest').Manifest} manifest
 * @returns {{ tools: Array<{ name: string, description: string, inputSchema: object }> }}
 */
export function manifestToMcpTools(manifest) {
  const ops = Array.isArray(manifest?.operations) ? manifest.operations : [];
  const tools = ops
    .filter((op) => typeof op?.id === 'string' && op.id)
    .map((op) => toolForOp(op, manifest));
  return { tools };
}

function toolForOp(op, manifest) {
  return {
    name:        op.id,
    description: describe(op),
    inputSchema: inputSchemaFor(op, manifest),
  };
}

function inputSchemaFor(op, manifest) {
  const params = Array.isArray(op?.params) ? op.params : null;
  if (!params || params.length === 0) return { ...PERMISSIVE_SCHEMA };
  try {
    return paramsToJsonSchema(params, { manifest });
  } catch {
    // Best-effort: an exotic param kind must not break the whole projection.
    return { ...PERMISSIVE_SCHEMA };
  }
}

function describe(op) {
  const hint = op?.surfaces?.chat?.hint ?? op?.description;
  if (typeof hint === 'string' && hint) {
    return hasParams(op) ? hint : `${hint} (no declared params — accepts any object).`;
  }
  const verb = op?.verb ?? 'op';
  const noun = op?.appliesTo?.type;
  return noun ? `${verb} ${noun}` : String(op?.id ?? 'operation');
}

function hasParams(op) {
  return Array.isArray(op?.params) && op.params.length > 0;
}
