/**
 * basis v2 — circle-policy conflict detection + resolution
 * (Plan γ.4, Phase 9 sync-engine absorption).
 *
 * Thin instantiation of the shared flat-doc conflict layer
 * (`makeCircleFlatDocConflict` in `circleKindFactory.js`) — the same shape
 * as `rulesConflict.js`.  The policy has no `blocks` array, so every
 * divergence surfaces as a meta-conflict (`blockConflicts` always empty)
 * and the output mirrors γ.3's `detectRecipeConflicts`, keeping the shared
 * resolver UI reusable as-is (just a different `title`).
 *
 * The ONLY behavioural difference from rules: the policy nests objects
 * (`push:{...}`, `features:{...}`, `flowThrough:{...}`), so its resolution
 * DEEP-clones the incoming before overlaying picks (`deepIncoming: true`)
 * — that's why conflict paths can be dotted (`'push.onMention'`) and the
 * merge must not mutate the caller's nested incoming objects.  Missing
 * decisions default to 'theirs' (incoming wins), same as rules.
 *
 * Purity: no I/O, no Date.now, no Math.random.
 */

import { makeCircleFlatDocConflict } from './circleKindFactory.js';

const { detect: detectPolicyConflicts, apply: applyPolicyResolution } =
  makeCircleFlatDocConflict({ deepIncoming: true });

export { detectPolicyConflicts, applyPolicyResolution };
