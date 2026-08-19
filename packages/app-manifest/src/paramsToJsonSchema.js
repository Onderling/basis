/**
 * params[] → plain JSON Schema object.  Output shape matches what the
 * current household `V0_TOOL_CATALOGUE` feeds the LLM — no `$schema`, no
 * draft pragma — so 's byte-equivalence gate can diff cleanly.
 *
 * Properties + required preserve param declaration order (determinism;
 * cf. internal/order.js).
 *
 * @param {Array<import('./schema.js').Param>} params
 * @param {{ manifest?: import('./schema.js').Manifest }} [opts]
 *   `manifest` is consulted only when a param has `kind:'enum' of:'itemTypes'`
 *   to resolve the enum values against `manifest.itemTypes`.
 * @returns {{ type: 'object', properties: object, required: string[] }}
 */
export function paramsToJsonSchema(params, opts = {}) {
  const list       = Array.isArray(params) ? params : [];
  const properties = {};
  const required   = [];

  for (const p of list) {
    properties[p.name] = paramToProperty(p, opts.manifest);
    if (p.required) required.push(p.name);
  }

  // Omit `required` when empty — matches what hand-written JSON-Schema-based
  // tool catalogues do (e.g. household's `V0_TOOL_CATALOGUE.help`) and keeps
  // byte-equivalence on the gate.
  const out = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  return out;
}

function paramToProperty(p, manifest) {
  // F-SP1-c (locked 2026-05-19): inline JSON Schema fragment is spread AFTER
  // `type` so the per-kind type stays first (matches V0_TOOL_CATALOGUE key order)
  // and any keywords the per-kind switch doesn't model (minLength, pattern,
  // maxLength, …) ride through.
  const extra = (p?.schema && typeof p.schema === 'object') ? p.schema : null;
  switch (p?.kind) {
    case 'string':  return extra ? { type: 'string',  ...extra } : { type: 'string'  };
    case 'number':  return extra ? { type: 'number',  ...extra } : { type: 'number'  };
    case 'boolean': return extra ? { type: 'boolean', ...extra } : { type: 'boolean' };
    case 'enum': {
      const values = resolveEnum(p.of, manifest);
      return extra
        ? { type: 'string', enum: values, ...extra }
        : { type: 'string', enum: values };
    }
    // v0.3.2 + v0.4 — date / webid surface in JSON Schema as strings
    // with format hints.  Real validation happens in basis's
    // buildFormSpec.validateAndCoerce (per-kind parser).
    case 'date':    return extra ? { type: 'string', format: 'date',  ...extra } : { type: 'string', format: 'date'  };
    case 'webid':   return extra ? { type: 'string', format: 'uri',   ...extra } : { type: 'string', format: 'uri'   };
    // file / image surface as objects with a contentType field;
    // adapters interpret the upload UI.  No real consumer yet; minimal
    // shape so the schema doesn't reject them.
    case 'file':    return extra ? { type: 'object', ...extra } : { type: 'object' };
    case 'image':   return extra ? { type: 'object', ...extra } : { type: 'object' };
    // flows-substrate kinds: 'secret' is a string the runner never persists (shells mask it —
    // the writeOnly hint is the JSON-schema spelling of that); 'object' is a structured argument.
    case 'secret':  return extra ? { type: 'string', writeOnly: true, ...extra } : { type: 'string', writeOnly: true };
    case 'object':  return extra ? { type: 'object', ...extra } : { type: 'object' };
    default:
      throw new Error(
        `paramsToJsonSchema: unknown kind "${p?.kind}" for param "${p?.name}"`,
      );
  }
}

function resolveEnum(of, manifest) {
  if (Array.isArray(of)) return [...of];
  if (of === 'itemTypes') {
    if (!manifest || !Array.isArray(manifest.itemTypes)) {
      throw new Error(
        "paramsToJsonSchema: param.of='itemTypes' requires opts.manifest with itemTypes",
      );
    }
    return [...manifest.itemTypes];
  }
  throw new Error(
    `paramsToJsonSchema: unsupported 'of' value: ${JSON.stringify(of)}`,
  );
}
