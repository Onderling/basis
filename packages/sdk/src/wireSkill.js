/**
 * wireSkill — MANIFEST-driven skill-handler generator (the manifest-based
 * sibling of `connectSkill`).
 *
 * Where `connectSkill` adapts ONE plain function into a skill handler by
 * position (handler-based, manifest-agnostic), `wireSkill` GENERATES the
 * `defineSkill`-shaped handler from a `manifest.js` op DECLARATION — so the op
 * (`{ id, verb, params, visibility, … }`) stays the single contract and the
 * handler is derived from it, not hand-written.
 *
 *     import { wireSkill } from '@onderling/sdk';
 *
 *     const op = manifest.operations.find(o => o.id === 'addTask');
 *     const handler = wireSkill(
 *       (store, args, ctx) => store.add({ text: args.text }),   // core fn
 *       op,                                                       // manifest op
 *       { storeFor: (ctx) => storesByCircle.get(ctx.from) },      // scope store
 *     );
 *     agent.register(op.id, handler, { visibility: op.visibility });
 *
 * The generated handler, when core dispatches it with the rich skill context
 * `{ parts, from, envelope, agent, signal, … }`:
 *
 *   1. DECODES `ctx.parts` into friendly `args` (reusing connectSkill's
 *      `decodeArgs`): merged DataPart object, else a lone TextPart string
 *      coerced onto the op's first param, else `{}`.
 *   2. VALIDATES `args` against `op.params` — required-ness + per-`kind`
 *      type/enum checks. A validation failure throws (core turns it into the
 *      standard failed task-result, exactly like any other handler error).
 *   3. RESOLVES the scope store via `storeFor(ctx)` — multi-scope state lives
 *      OUTSIDE the single agent (invariant #6), keyed off the caller/context.
 *   4. Calls `coreFn(store, args, ctx)` and RETURNS its value unchanged — core's
 *      `Parts.wrap()` turns a string / object / Part[] / async-generator into
 *      the wire response (so a generator `coreFn` still streams).
 *
 * Now the uniform invocation route: household (via realAgent), tasks-v0, and
 * pinboard register their wire skills through this, and @onderling/app-scaffold
 * generates code that imports it. The projector story (renderChat / renderGate
 * / …) stays the manifest's job; this helper is only the "manifest op → skill
 * handler" generator.
 *
 * @param {(store: any, args: object, ctx: object) => any} coreFn
 *        The scope-bound core function. May be sync or async and may return a
 *        string / object / Part[] / async-generator / any (auto-wrapped/streamed
 *        by core).
 * @param {object} op
 *        A manifest Operation declaration: `{ id, verb?, params?, visibility?, … }`.
 * @param {object} deps
 * @param {(ctx: object) => any} deps.storeFor
 *        Resolves the scope store for this invocation from the skill context.
 * @returns {(ctx: object) => any} the `defineSkill`-shaped handler.
 */
// Reuse connectSkill's decoder so both helpers decode parts identically.
import { decodeArgs } from './connectSkill.js';

/**
 * Generate a `defineSkill`-shaped handler from a manifest op declaration. The handler decodes
 * `ctx.parts` into named args (connectSkill's `decodeArgs`; a lone TextPart binds to the op's first
 * param), validates them against `op.params` (required-ness + per-kind string/number/boolean/enum
 * checks; unknown kinds pass through), resolves the scope store via `storeFor(ctx)`, and returns
 * `coreFn(store, args, ctx)` unchanged. Validation failures throw.
 *
 * @param {(store: any, args: object, ctx: object) => any} coreFn — the scope-bound core function.
 * @param {object} op — a manifest Operation declaration `{ id, verb?, params?, visibility?, … }`.
 * @param {{ storeFor: (ctx: object) => any }} deps — `storeFor` resolves the store per invocation.
 * @returns {(ctx: object) => any} the handler to register under `op.id`.
 */
export function wireSkill(coreFn, op, { storeFor } = {}) {
  if (typeof coreFn !== 'function') {
    throw new Error('wireSkill: coreFn must be a function');
  }
  if (!op || typeof op !== 'object' || typeof op.id !== 'string' || op.id.length === 0) {
    throw new Error('wireSkill: manifestOp must be an object with a non-empty string `id`');
  }
  if (typeof storeFor !== 'function') {
    throw new Error(`wireSkill "${op.id}": storeFor must be a function`);
  }

  const params = Array.isArray(op.params) ? op.params : [];

  return function wiredHandler(ctx) {
    const args = _coerceArgs(decodeArgs(ctx), params);
    _validateArgs(args, params, op.id);
    const store = storeFor(ctx);
    return coreFn(store, args, ctx);
  };
}

/**
 * Coerce decoded parts into a named-args object.
 *  - object (merged DataPart) → used as-is
 *  - string (lone TextPart)   → assigned to the op's first param (if any)
 *  - raw Part[] / nothing     → `{}`
 */
function _coerceArgs(decoded, params) {
  if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) return decoded;
  if (typeof decoded === 'string' && params.length > 0) return { [params[0].name]: decoded };
  return {};
}

/** Validate `args` against the op's declared params (required + kind/enum). */
function _validateArgs(args, params, opId) {
  for (const p of params) {
    const val = args[p.name];

    if (val === undefined || val === null) {
      if (p.required) {
        throw new Error(`wireSkill "${opId}": missing required param "${p.name}"`);
      }
      continue;   // optional + absent → nothing to check
    }

    switch (p.kind) {
      case 'string':
        if (typeof val !== 'string') throw _kindErr(opId, p, 'string', val);
        break;
      case 'number':
        if (typeof val !== 'number' || Number.isNaN(val)) throw _kindErr(opId, p, 'number', val);
        break;
      case 'boolean':
        if (typeof val !== 'boolean') throw _kindErr(opId, p, 'boolean', val);
        break;
      case 'enum': {
        // Inline choice list only. `of: 'itemTypes'` needs the whole manifest
        // to resolve, which a single op doesn't carry — accept any string then.
        const choices = Array.isArray(p.of) ? p.of : null;
        if (choices) {
          if (!choices.includes(val)) {
            throw new Error(
              `wireSkill "${opId}": param "${p.name}" must be one of ${choices.join(', ')} — got ${JSON.stringify(val)}`,
            );
          }
        } else if (typeof val !== 'string') {
          throw _kindErr(opId, p, 'enum(string)', val);
        }
        break;
      }
      default:
        // Unknown kind → forward-additive: don't reject, let coreFn decide.
        break;
    }
  }
}

function _kindErr(opId, p, expected, val) {
  return new Error(
    `wireSkill "${opId}": param "${p.name}" must be a ${expected} — got ${typeof val}`,
  );
}
