/**
 * opAvailability — "may this op happen in THIS circle, for THIS person, right now?", asked once.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────────
 * Three separate gates already answered a slice of that question, each applied by whichever surface's
 * author knew about it:
 *
 *   the CATALOGUE      which apps this circle composes (`policy.apps` → `scopeCatalogueToApps`)
 *   `requires`         which features are switched on for it (`isFeatureEnabled`)
 *   the CAPABILITY     what this member may do (`buildCapabilityMatrix` → `affordanceTreatment`)
 *
 * Nothing composed them, so a surface applied the ones it happened to know. The composer's ATTACH menu
 * applied NONE: it was projected from the manifest at module load and offered every entry
 * unconditionally, while dispatch resolves through the per-circle catalogue. Tapping "Card" therefore
 * threw inside `resolveDispatch` and a person was told *"Ik kon daar geen actie van maken"* — the app
 * saying "I don't understand you" when the truth was "that isn't switched on here". One of those is
 * the person's fault and the other is the circle's configuration, and we blamed the person.
 *
 * `surfaceProbe` composed two of the three and was wrong for the same reason: a probe built to stop me
 * guessing had itself guessed.
 *
 * ── The three layers, because only ONE of them belongs here ──────────────────────────────────────────
 * Frits, 2026-08-28, on being told there were four gates: *"i thought that the manifests were playing a
 * role in this too"*. He was right, and looking again splits the question into three:
 *
 *   STRUCTURAL      does this op exist on this surface at all? — the MANIFEST (`surfaces.slash` /
 *                   `ui` / `attach`, `appliesTo`, `platforms`). Declared once, works, and the
 *                   projectors read it. NOT this module's business.
 *   CONTEXTUAL      given it exists here, may it happen now? — THIS MODULE.
 *   AUTHORISATION   may this CALLER invoke it? — `PolicyEngine` (a skill's `visibility` against a
 *                   remote peer's trust tier) and the CapabilityToken an A2A op carries. Deliberately
 *                   NOT folded in: "this circle does not do that" and "you may not ask me that" are
 *                   different refusals and deserve different sentences.
 *
 * So a projector asks the manifest whether the op appears on its surface, and then asks THIS whether it
 * may happen. The attach bug was not a missing gate; it was a whole layer skipped.
 *
 * `enabledWhen` (route × data-policy) is deliberately absent: it is declared on settings CONTROLS, not
 * on ops, and a control is not an op. Settings keeps it on top of this answer.
 *
 * ── Composes, does not replace ───────────────────────────────────────────────────────────────────────
 * Each gate keeps its own home, its own rules and its own tests — two live in packages, two in basis.
 * This calls them and merges the verdicts, so changing a gate changes the composite for free. A version
 * that re-derived their decisions would be a fourth source of truth, which is the disease.
 *
 * Precedence is DENY-WINS and hidden beats greyed (Frits, 2026-08-28: *"'deny wins' has been a good
 * default so far"*). Stated rather than inherited by accident, because the gates disagree about
 * defaults — an empty `policy.apps` means ALL, an absent `requires` means ALLOWED.
 */

import { affordanceTreatment, canonicalAtom } from '@onderling/app-manifest';
import { isFeatureEnabled } from './circlePolicy.js';

/** Why an op is not simply available. `null` when it is. */
export const UNAVAILABLE = Object.freeze({
  UNKNOWN:     'unknown-op',           // no manifest declares it — a typo, or an app that is not loaded
  NOT_COMPOSED:'app-not-composed',     // its app is not among the ones this circle uses
  FEATURE_OFF: 'feature-off',          // the circle has that feature switched off
  CAPABILITY:  'capability',           // this member may not do it here
});

/** The locale key a surface should say when it refuses. One per reason, so the app can be specific. */
export const UNAVAILABLE_KEYS = Object.freeze({
  [UNAVAILABLE.UNKNOWN]:      'circle.bot.unknown',
  [UNAVAILABLE.NOT_COMPOSED]: 'circle.op.not_in_this_circle',
  [UNAVAILABLE.FEATURE_OFF]:  'circle.op.feature_off',
  [UNAVAILABLE.CAPABILITY]:   'circle.op.not_yours',
});

const AVAILABLE = Object.freeze({ state: 'available', reason: null });

/**
 * The app id that is not an app: basis is the DEVICE, present wherever the person is. Named once here
 * because two places must agree about it — this rung and the composer's typed door, which reaches the
 * same conclusion by carrying the device's own commands alongside whatever the place offers.
 */
const DEVICE_ORIGIN = 'basis';

/**
 * @param {object} a
 * @param {{opsById?: Map<string, object>}|null} [a.catalogue]  the circle's RESOLVED dispatch catalogue —
 *   the same object `resolveDispatch` resolves against, so this cannot answer differently from a tap.
 * @param {Record<string, object>} [a.manifestsByOrigin]  `{appOrigin → manifest}`
 * @param {object|null} [a.policy]                        the circle policy (features)
 * @param {Array} [a.capabilityMatrix]                    the member's effective capabilities
 * @returns {{of: (opId: string) => {state: string, reason: string|null}, keyFor: (opId: string) => string|null}}
 */
export function makeOpAvailability({
  catalogue = null,
  manifestsByOrigin = {},
  policy = null,
  capabilityMatrix = [],
} = {}) {
  /** Find an op across the composed manifests, with the origin it came from. */
  const findOp = (opId) => {
    for (const [appOrigin, manifest] of Object.entries(manifestsByOrigin ?? {})) {
      const op = (manifest?.operations ?? []).find((o) => o?.id === opId);
      if (op) return { op, appOrigin };
    }
    return null;
  };

  const of = (opId) => {
    if (typeof opId !== 'string' || !opId) return { state: 'hidden', reason: UNAVAILABLE.UNKNOWN };
    const found = findOp(opId);
    if (!found) return { state: 'hidden', reason: UNAVAILABLE.UNKNOWN };
    const { op, appOrigin } = found;

    // 1 · Is its app composed into THIS circle? Asked against the catalogue a tap resolves against, so
    // an op the menu offers and dispatch cannot find is now impossible rather than merely unlikely.
    // A caller with no catalogue is not making a claim about composition, so this rung is skipped —
    // never silently answered "yes", which is how the attach menu came to offer dead entries.
    //
    // THE DEVICE IS NOT AN APP THE CIRCLE COMPOSES. basis's ops are this device's own — attach a
    // photo, put an appointment in the conversation, see who is blocked — and they are equally true in
    // every circle and in none. The circle catalogue deliberately excludes basis (so the bot's language
    // model cannot pick `/me` out of a hundred ops), and asking composition of a device op read that
    // scope as an answer to a question it was never asked: the + menu's card and appointment entries
    // came back NOT_COMPOSED and the menu, left with nothing usable, rendered nothing at all. The two
    // rungs below still apply — a device op can be switched off by a feature or refused by capability.
    const ops = catalogue?.opsById;
    if (appOrigin !== DEVICE_ORIGIN && ops && typeof ops.has === 'function' && !ops.has(opId)) {
      return { state: 'hidden', reason: UNAVAILABLE.NOT_COMPOSED };
    }

    // 2 · Is the feature it belongs to switched on? Absent `requires` means "always", which is the
    // default `actionAllowed` already uses — kept identical so the two cannot drift.
    if (Array.isArray(op.requires) && op.requires.length > 0
      && !op.requires.some((f) => isFeatureEnabled(policy, f))) {
      return { state: 'hidden', reason: UNAVAILABLE.FEATURE_OFF };
    }

    // 3 · May this member do it? The same call the inline buttons make, so a button and this answer
    // cannot disagree about the same person.
    const treatment = affordanceTreatment(capabilityMatrix, {
      app: appOrigin, atom: op.verb ? canonicalAtom(op.verb) : null, noun: null,
    });
    if (treatment === 'hide') return { state: 'hidden', reason: UNAVAILABLE.CAPABILITY };
    if (treatment === 'grey') return { state: 'greyed', reason: UNAVAILABLE.CAPABILITY };

    return AVAILABLE;
  };

  /** The locale key to SAY when an op is not available — the half that turns a refusal into a sentence. */
  const keyFor = (opId) => UNAVAILABLE_KEYS[of(opId).reason] ?? null;

  return { of, keyFor };
}

export default makeOpAvailability;
