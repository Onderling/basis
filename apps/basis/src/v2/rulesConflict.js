/**
 * basis v2 — rules-doc conflict detection + resolution
 * (Plan γ.4, Phase 9 sync-engine absorption).
 *
 * Thin instantiation of the shared flat-doc conflict layer
 * (`makeKringFlatDocConflict` in `kringKindFactory.js`) — the same shape
 * as `policyConflict.js`.  Rules are a FLAT keyed JSON blob (purpose /
 * admins / agreements / conflict / admission / leaving / responsibility)
 * with NO `blocks` array, so every divergence surfaces as a meta-conflict
 * (`blockConflicts` always empty) and the output mirrors γ.3's
 * `detectRecipeConflicts`, keeping the shared resolver UI reusable as-is.
 *
 * Because rules are flat, resolution uses a shallow spread of the incoming
 * (`deepIncoming: false`) — the cheaper equivalent of policy's deep clone.
 * Missing decisions default to 'theirs' (incoming wins): the doc was
 * authored deliberately by the other admin.  (Recipes use the opposite
 * default, 'yours', because blocks carry richer local editing state — that
 * genuinely-different regime stays in `recipeConflict.js`.)
 *
 * Purity: no I/O, no Date.now, no Math.random.
 */

import { makeKringFlatDocConflict } from './kringKindFactory.js';

const { detect: detectRulesConflicts, apply: applyRulesResolution } =
  makeKringFlatDocConflict({ deepIncoming: false });

export { detectRulesConflicts, applyRulesResolution };
export { decisionsForMerges } from './kringKindFactory.js';
