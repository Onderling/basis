/**
 * basis — N2: per-option "consequences" registry.
 *
 * Many choice forms (the create wizard's policy axes, circle settings,
 * personal overrides, hop settings, skill creation) present radio
 * options whose effect isn't obvious.  Frits 2026-06-02: each option
 * should carry an ⓘ revealing *"Gevolgen als je dit kiest: …"*.
 *
 * This module is the pure, RN-free mapping from a `(group, optionId)`
 * pair to a locale key.  The render layer (web `appendRadioField`,
 * mobile `_kit.RadioGroup`) looks it up and shows the ⓘ only when a key
 * exists — options without a registered consequence render unchanged.
 *
 * Keys resolve to `consequence.<group>.<optionId>` in the locale bundle.
 * To light up an option, register it here AND add its locale entry.
 */

/**
 * Registered `(group → Set<optionId>)`.  A group is a stable form-axis
 * name the call-site passes; option ids match the radio option ids.
 * @type {Record<string, ReadonlyArray<string>>}
 */
export const CONSEQUENCE_OPTIONS = Object.freeze({
  // create wizard — governance / rules / tech axes
  accessPolicy:   ['invite-only', 'request', 'open'],
  leavePolicy:    ['anyone', 'notify-first'],
  conflictPolicy: ['admin-decides', 'mediation', 'vote'],
  storagePolicy:  ['no-pod', 'decentralised', 'centralised'],
  // create wizard — N1 kind picker + neighbourhood size
  kind:           ['household', 'neighbourhood', 'friends', 'team'],
  size:           ['small', 'large'],
  // N2.b — skill axes (create-wizard skills step + skill editor)
  openness:       ['private', 'circle', 'contacts', 'public'],
  posture:        ['always', 'negotiable'],
  status:         ['active', 'paused', 'archived'],
  radius:         ['home', 'street', 'neighbourhood', 'city'],
});

/**
 * @param {string} group
 * @param {string} optionId
 * @returns {boolean} true when this option has a registered consequence
 */
export function hasConsequence(group, optionId) {
  const opts = CONSEQUENCE_OPTIONS[group];
  return Array.isArray(opts) && opts.includes(optionId);
}

/**
 * @param {string} group
 * @param {string} optionId
 * @returns {string|null} the locale key, or null when none is registered
 */
export function consequenceKeyFor(group, optionId) {
  return hasConsequence(group, optionId) ? `consequence.${group}.${optionId}` : null;
}

/**
 * N2 (mobile) — return a copy of `options` with a localised `consequence`
 * string attached to each option that has a registered consequence.  The
 * RN `_kit.RadioGroup` renders the ⓘ from `option.consequence` (the kit
 * never calls `t()` itself — callers pass localised strings).
 *
 * @param {string} group
 * @param {Array<{id: string, label: string}>} options
 * @param {(key: string) => string} t
 * @returns {Array<{id: string, label: string, consequence?: string}>}
 */
export function attachConsequences(group, options, t) {
  if (!Array.isArray(options) || typeof t !== 'function') return options ?? [];
  return options.map((o) => {
    const key = consequenceKeyFor(group, o?.id);
    return key ? { ...o, consequence: t(key) } : o;
  });
}
