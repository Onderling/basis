/**
 * capabilityGate — B ·: the DEFAULT-DENY authorization boundary at the dispatch waist.
 *
 * Today's per-circle app scoping (`policy.apps` → `scopeCatalogueToApps`) is INTERFACE-ONLY: it hides
 * ops from the LLM tool-list and slash-suggest, but nothing refuses an op that's invoked directly
 * (a gate rule, a stale button, a crafted message) — the leakage risk the B design flags.  This
 * module turns the same policy into a REAL boundary: a pure decision function the dispatcher calls
 * BEFORE `callSkill`, keyed on the **(verb × noun) capability** the op resolves to.
 *
 * drives the effective set from the existing per-circle app enablement (an enabled app
 * contributes all its capabilities); Slices 2–4 swap `effectiveCapabilities` for
 * `admin-template ∩ user-prefs` WITHOUT touching the gate or the wiring — the gate only ever sees a
 * set of allowed capability keys. Migration default (ruling): an unconfigured circle
 * (`policy.apps == null`) enables everything (default-on), so existing circles are unaffected.
 *
 * Pure + host-injection-shaped, mirroring `circleEnforcement.js`: the caller passes the merged
 * manifest sources + the circle policy; nothing here reaches into the agent or storage.  Returns a
 * machine `code` (never a user-facing string — the shell maps it through `t()`), per the no-hardcoded
 * -strings invariant.
 */

import { canonicalAtom, opNouns, capabilityKey, effectiveCapabilityKeys } from '@onderling/app-manifest';

// Re-export the shared capability key so the gate + the freedom template agree by construction — ONE
// space-separated spelling, human-readable in the `policy.capabilities` template the wizard writes.
export { capabilityKey };

/**
 * The EFFECTIVE capability set for a circle.
 *   enabled-apps -> ALL their capabilities (app-level).
 *   ALSO narrowed by the admin freedom template (`policy.capabilities`) - a cap is
 *   authorised iff its app is enabled AND the template does not disable it. No template => default-on
 *   (identical to), so existing circles are unaffected.
 *
 * @param {Array<{manifest: object}>} sources  the merged manifest sources (as fed to mergeManifests)
 * @param {{ apps?: string[]|null, capabilities?: object }} [policy]  `apps==null` => every app enabled;
 *   `capabilities` = the freedom template `{ "<app> <atom> <noun>": { enabled?, ... } }`.
 * @returns {{ keys: Set<string>, enabledApps: Set<string>|null }}
 */
export function effectiveCapabilities(sources, policy = {}) {
  const appList = Array.isArray(policy?.apps) ? policy.apps : null;
  const enabledApps = appList ? new Set(appList) : null;
  // admin-template ∩ member opt-outs: `optOuts` are the current member's declined caps.
  const keys = effectiveCapabilityKeys(sources, { enabledApps, template: policy?.capabilities, optOuts: policy?.optOuts });
  return { keys, enabledApps };
}

/**
 * The concrete noun(s) a dispatch targets — arg-aware.  When the op names its noun via a type-enum
 * PARAM and `args` supplies it, that single value is the noun; else the op's declared nouns
 * (`appliesTo.type` / the enum's full `of`).  `'*'` (wildcard) is returned verbatim for the gate to
 * treat as "any".
 */
function concreteNouns(op, args) {
  for (const p of (Array.isArray(op?.params) ? op.params : [])) {
    if (p?.kind === 'enum' && Array.isArray(p.of) && args && p.of.includes(args[p.name])) {
      return [args[p.name]];
    }
  }
  const nouns = opNouns(op);
  return nouns.length ? nouns : [];
}

/**
 * Authorize a single dispatch.  DEFAULT-DENY: an op whose app is disabled, or whose resolved
 * capability isn't in the effective set, is refused.
 *
 * @param {object}  params
 * @param {object}  params.op          the manifest op declaration (has verb + appliesTo/params)
 * @param {string}  params.appOrigin   the op's owning app (threaded from the K0 de-shadow)
 * @param {object}  [params.args]      the dispatch args (used to resolve the concrete noun)
 * @param {{ keys: Set<string>, enabledApps: Set<string>|null }} effective  from effectiveCapabilities
 * @returns {{ allow: boolean, code?: string, capability?: string }}
 *   `code` is a machine token: 'app-disabled' | 'capability-denied'.  The shell renders it via t().
 */
export function checkCapability({ op, appOrigin, args, atom: atomIn, noun: nounIn } = {}, effective) {
  const keys = effective?.keys instanceof Set ? effective.keys : new Set();
  const enabledApps = effective?.enabledApps instanceof Set ? effective.enabledApps : null;

  // Missing appOrigin is a routing defect, not a capability — fail closed.
  if (typeof appOrigin !== 'string' || appOrigin === '') return { allow: false, code: 'app-disabled' };

  // App-level gate (matches today's policy.apps granularity).
  if (enabledApps && !enabledApps.has(appOrigin)) return { allow: false, code: 'app-disabled' };

  // §1b — a GENERIC capability (a declared noun with NO implementing op, served by the generic store
  // handler) has no `op` to read the verb/noun from; the caller passes `atom` + `noun` explicitly. Before
  // this, an op-less dispatch fell through the `!atom` guard below and was ALLOWED UNCONDITIONALLY (the gap
  // this closes): a generic capability must be authorised by its (atom × noun) key exactly like a bespoke op.
  // When `op` is present (every existing caller) behaviour is byte-identical.
  const atom = op ? canonicalAtom(op?.verb) : canonicalAtom(atomIn);
  // Domain verbs (help/sync/register/…) aren't capabilities — an enabled app may run them.
  if (!atom) return { allow: true };

  const nouns = op ? concreteNouns(op, args) : (nounIn ? [nounIn] : []);
  // An atom op that names no noun, or a wildcard op, is authorized at app level.
  if (nouns.length === 0 || nouns.includes('*')) return { allow: true };

  for (const noun of nouns) {
    if (keys.has(capabilityKey(appOrigin, atom, noun))) {
      return { allow: true, capability: capabilityKey(appOrigin, atom, noun) };
    }
  }
  return { allow: false, code: 'capability-denied' };
}
