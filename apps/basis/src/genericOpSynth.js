/**
 * genericOpSynth — synthesize SYNTHETIC catalogue ops for a manifest's GENERIC (op-less) capabilities
 * (PLAN-capability-arc 1b).
 *
 * "Declare a noun → get CRUD free": a manifest can declare a noun with CRUD atoms and NO implementing op
 * (e.g. household's `note: { atoms:['add','list','get','remove'] }`). `capabilitiesOf(manifest)` returns
 * those as `{ noun, atom, opId:null, source:'declared' }`. This helper turns each such op-less capability
 * into a SYNTHETIC op whose id encodes `(app, atom, noun)` via the shared codec (`encodeGenericOpId`), so
 * the EXISTING projectors (`renderSlash`, `buildToolDescriptors`) and the op-keyed gate all work unchanged:
 *
 *   - `verb` + `appliesTo.type` — so the gate authorises it by `(atom × noun)` with no gate change.
 *   - `surfaces.slash.match`     — so `renderSlash` matches `<atom> <text>` and binds the positional.
 *   - `surfaces.chat.hint` + `params` — so `buildToolDescriptors` mints an LLM tool for it.
 *   - `__generic: { app, atom, noun }` — a fast, decode-free marker for the dispatch waist.
 *
 * The synthetic op-id (`__generic__:<app>:<atom>:<noun>`) is decoded on the DISPATCH side by the same codec
 * (`decodeGenericOpId`) to route to the generic store-backed handler (`createGenericAtomHandlers`). Pure.
 *
 * ── body binding (MVP judgement call) ──────────────────────────────────────────────────────────────────
 * The slash positional maps to the noun's main arg, chosen by atom family (a single free-text param — the
 * §1b MVP; a future refinement could read the noun's declared content field):
 *   - CONTENT atoms (add / create / update) → the free text is the item CONTENT → arg `body`
 *     (matches household's `note` content field; generic across nouns for the MVP).
 *   - REFERENCE atoms (get / remove / delete) → the free text is the item ID → arg `id`
 *     (the generic handlers' `get`/`remove` require `args.id`).
 *   - COLLECTION atoms (list) → no positional (body kind `none`).
 */

import { capabilitiesOf, encodeGenericOpId } from '@onderling/app-manifest';

/** Atoms whose slash positional is the item ID (bound to `id`); everything else binds to `body`. */
const REFERENCE_ATOMS = new Set(['get', 'remove', 'delete']);

/**
 * The `surfaces.slash.match` body-binding + LLM `params` for an atom.
 * @param {string} atom  canonical atom verb
 * @returns {{ match: object, params: Array<object> }}
 */
function bindingForAtom(atom) {
  if (atom === 'list') {
    // Collection read — no positional argument.
    return { match: { verbs: [atom], body: 'none' }, params: [] };
  }
  const arg = REFERENCE_ATOMS.has(atom) ? 'id' : 'body';   // CONTENT_ATOMS + fallback → `body`
  return {
    match:  { verbs: [atom], body: 'text-only', arg },
    params: [{ name: arg, kind: 'string', required: true }],
  };
}

/**
 * Synthesize the SYNTHETIC ops for a manifest's op-less (generic) capabilities.
 *
 * @param {object} manifest  a validated app manifest
 * @returns {Array<object>}  synthetic op objects (empty when the manifest has no op-less capabilities)
 */
export function synthesizeGenericOps(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const app = manifest.app;
  if (typeof app !== 'string' || !app) return [];

  const out = [];
  for (const cap of capabilitiesOf(manifest)) {
    if (cap.opId) continue;   // a bespoke op implements it → not generic (never shadow a real op)
    const { atom, noun } = cap;
    if (!atom || !noun) continue;

    const { match, params } = bindingForAtom(atom);
    out.push({
      id:        encodeGenericOpId(app, atom, noun),
      verb:      atom,
      appliesTo: { type: noun },
      params,
      // Decode-free marker for the dispatch waist (equivalent to decodeGenericOpId(id)).
      __generic: { app, atom, noun },
      surfaces: {
        slash: { command: `/${atom}-${noun}`, match },
        // LLM-facing tool description (like DEFAULT_INTERPRET_SYSTEM — internal, not shown to the member).
        chat:  { hint: `${atom} a ${noun}` },
      },
    });
  }
  return out;
}
