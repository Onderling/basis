/**
 * basis v2 — offering 4-axis model + match list (shared).
 *
 * An offering is a structured object across four axes: how openly it
 * is shared (`openness`), whether the offer is fixed or up for negotiation
 * (`posture`), its lifecycle (`status`), and how far it reaches (`radius`).
 * This module is the pure model: enum tables, a default offering, normalisation
 * (coerce a stored partial onto valid enum values), and deep-merge for edits
 * — mirroring circlePolicy's normalize/merge exactly. It also normalises an
 * INJECTED match list into tagged rows (human / agent / via-hop) — no
 * fetching or discovery here; the host supplies the matches. Local discovery
 * (mDNS/BLE "who's here") is intentionally NOT part of this slice.
 */

export const OFFERING_AXES = {
  openness: ['private', 'circle', 'contacts', 'public'],
  posture:  ['always', 'negotiable'],
  status:   ['active', 'paused', 'archived'],
  radius:   ['home', 'street', 'neighbourhood', 'city'],
};

export const DEFAULT_OFFERING = {
  name:     '',
  openness: 'private',
  posture:  'always',
  status:   'active',
  radius:   'home',
};

/** Coerce any stored partial into a complete, valid offering (invalid axis values fall back to defaults; `name` kept). */
export function normalizeOffering(raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const pickEnum = (axis) =>
    OFFERING_AXES[axis].includes(s[axis]) ? s[axis] : DEFAULT_OFFERING[axis];
  return {
    name:     typeof s.name === 'string' ? s.name : DEFAULT_OFFERING.name,
    openness: pickEnum('openness'),
    posture:  pickEnum('posture'),
    status:   pickEnum('status'),
    radius:   pickEnum('radius'),
  };
}

/** Deep-merge an edit `patch` onto `base`, then normalise. */
export function mergeOffering(base, patch = {}) {
  return normalizeOffering({ ...normalizeOffering(base), ...patch });
}

/**
 * The circle's "offering-matching is ON here" signal (offering→property fold-in,
 * NOTE-skills-properties-audit). Today the only per-circle offering
 * policy is this board-8 record: matching is ON when it is shared beyond
 * `private` and still `active`. The default record (openness 'private') reads
 * as OFF, so an unconfigured circle never triggers the join-time share default.
 */
export function offeringsMatchingEnabled(raw) {
  const s = normalizeOffering(raw);
  return s.openness !== 'private' && s.status === 'active';
}

export const MATCH_SOURCES = ['human', 'agent', 'via-hop'];

/**
 * Normalise an INJECTED match list into `{ id, label, source, offering }` rows (source coerced into MATCH_SOURCES,
 * default 'human'; `offering` = the matched offering's text, only when the match names one).
 */
export function buildOfferingMatches({ matches = [] } = {}) {
  const list = Array.isArray(matches) ? matches : [];
  return list
    .filter((m) => m && typeof m === 'object')
    .map((m, i) => ({
      id:     typeof m.id === 'string' && m.id ? m.id : `match-${i}`,
      label:  typeof m.label === 'string' ? m.label : '',
      source: MATCH_SOURCES.includes(m.source) ? m.source : 'human',
      ...(typeof m.offering === 'string' && m.offering ? { offering: m.offering } : {}),
    }));
}
