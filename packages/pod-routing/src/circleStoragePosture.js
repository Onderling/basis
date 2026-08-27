/**
 * circleStoragePosture — the ONE vocabulary for "where does this circle's content live".
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * The same closed set was written three times, in two different languages, and the two languages
 * disagreed:
 *
 *   stoop + tasks-v0   `no-pod | centralised | decentralised | hybrid`
 *   basis              `none   | shared      | personal       | hybrid`
 *
 * They cut the space identically — verified 2026-08-27 against both implementations, term by term —
 * and nothing ever implemented `decentralised` differently from `personal`: its only distinct
 * behaviour is `podRouting.setAnchor(podRoot)`, which is precisely "each member's own pod". So this
 * was never two designs, only two names, and the cost was real: a circle-mode journey set one field
 * while the provisioner gated on the other, and a whole storage mode read as unestablishable through
 * three attempts before anyone looked at the words.
 *
 * This package is the honest home. All three apps already depend on it; `setAnchor` — the one
 * behaviour that distinguished a posture — lives here; and `configResource`'s persisted
 * `circlePolicies: { policy, groupPodUri? }` shape already carried the value while typing it as a
 * bare `string`, which is the third place the vocabulary was implied and never named.
 *
 * ── Why these words won ──────────────────────────────────────────────────────────────────────────
 * Decided 2026-08-27 (Frits: *"that looks great and much clearer than what we had so far"*).
 * `centralised` describes a CENTRAL SERVER, which is exactly what Onderling is not — a circle pod is
 * shared BETWEEN its members, central to nothing. `shared` and `personal` answer the question a
 * member would actually ask: whose pod is holding this? The basis set was also already the canonical
 * one in code, and the only one with a table turning it into behaviour.
 *
 * ── The two axes, kept distinct ──────────────────────────────────────────────────────────────────
 * A posture answers two questions at once, and conflating them is what made the old names confusing:
 *
 *   is there a pod at all?     `none` says no; the other three say yes.
 *   does content still FAN?    `shared` and `hybrid` fan; `personal` does not — members read the pod
 *                              on their own schedule, so there is no relay traffic and therefore no
 *                              relay-visible trace of who is talking to whom.
 *
 * `personal` is a real posture and not a synonym for `none` (Frits, 2026-08-27, correcting an earlier
 * proposal of mine that would have collapsed it). Whether it SHIPS in v1, and whether its name should
 * say "does not fan" rather than "whose pod", is an open sitting — see the roadmap. The vocabulary is
 * unaffected either way: the value exists and means what it has always meant.
 */

/**
 * The postures, with the one rule that actually differs between them.
 *
 * `needsGroupPodUri` is the whole of what the old vocabulary's validation encoded: a circle-shared
 * pod has to say WHICH pod, and a per-member pod does not because each member resolves their own.
 *
 * @type {Readonly<Record<'none'|'shared'|'personal'|'hybrid', {hasPod: boolean, needsGroupPodUri: boolean}>>}
 */
export const CIRCLE_STORAGE_POSTURES = Object.freeze({
  /** No pod. The envelope carries the data; storage is the device's own. */
  none:     { hasPod: false, needsGroupPodUri: false },
  /** ONE pod the circle shares. Content is written there and a pointer is fanned. */
  shared:   { hasPod: true,  needsGroupPodUri: true  },
  /** Each member's OWN pod, and nothing is fanned — members read on their own schedule. */
  personal: { hasPod: true,  needsGroupPodUri: false },
  /** Pod backing AND fanning — the pointer travels and the pod holds the content. */
  hybrid:   { hasPod: true,  needsGroupPodUri: true  },
});
// Frozen in a second pass rather than inline: the duplicate-vocabulary guard reads a table's keys by
// scanning the literal, and a nested `Object.freeze(` inside it defeats that scan — so the one table
// this file exists to make unique would have been invisible to the guard protecting its uniqueness.
for (const row of Object.values(CIRCLE_STORAGE_POSTURES)) Object.freeze(row);

/** The posture names, declaration order — for enums, pickers and validation lists. */
export const CIRCLE_STORAGE_POSTURE_NAMES = Object.freeze(Object.keys(CIRCLE_STORAGE_POSTURES));

/** The posture a circle has when nobody has said otherwise. Never assume a pod exists. */
export const DEFAULT_CIRCLE_STORAGE_POSTURE = 'none';

/** @returns {boolean} whether `value` is one of the postures. */
export function isCircleStoragePosture(value) {
  return typeof value === 'string' && Object.hasOwn(CIRCLE_STORAGE_POSTURES, value);
}

/**
 * Coerce anything to a posture. An unknown or missing value resolves to `none` — the safest answer
 * when the posture is unknown is that there is no pod, because assuming one means writing content
 * somewhere nobody agreed to.
 *
 * @param {*} value
 * @returns {'none'|'shared'|'personal'|'hybrid'}
 */
export function normaliseCircleStoragePosture(value) {
  return isCircleStoragePosture(value) ? value : DEFAULT_CIRCLE_STORAGE_POSTURE;
}

/** @returns {boolean} whether this posture requires a `groupPodUri` alongside it. */
export function posturePodUriRequired(value) {
  return CIRCLE_STORAGE_POSTURES[normaliseCircleStoragePosture(value)].needsGroupPodUri;
}
