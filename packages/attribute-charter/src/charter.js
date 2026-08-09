/**
 * The charter — a project lead declares ONCE, at project creation, which few
 * coarse attributes may be requested. It is:
 *   - CAPPED   (≤ CHARTER_MAX_ATTRIBUTES, each coarse) → the joint value space
 *              stays small, so attributes can't become a re-identification key.
 *   - IMMUTABLE per project version — to request more, start a new charter
 *     version; the traceability budget can never grow under people who already
 *     contributed. A new version = a new `charterHash`.
 *
 * Each released contribution carries the `charterHash` in effect, so there is
 * tamper-evident proof of which charter a participant agreed to — and that it
 * never silently changed. Signing (project pubkey) is applied at integration
 * (it needs the project's key); this module produces the canonical content +
 * its hash. See plans/NOTE-requested-attributes-charter.md §1, §5.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { isVocabKey } from './vocabulary.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/params';
// Parameter register (#36) — CHARTER_MAX_ATTRIBUTES is a PRIVACY cap (agent-scoped): kind:internal is
// load-bearing — a user must not be able to raise it to disclose more attributes than the charter allows.

// Proposed cap (adjustable per real cohort sizes — see the spec's open details).
/** Maximum number of (coarse) attributes one charter may request — keeps the joint value space small. */
export const CHARTER_MAX_ATTRIBUTES = param({ key: 'charter.maxAttributes', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.INTERNAL, default: 3 });

/**
 * Build a canonical, validated charter.
 * @param {{projectId: string, version?: number, attributes: Array<{key: string, purpose: string}>}} input
 * @returns {{projectId: string, version: number, attributes: Array<{key: string, purpose: string}>}}
 */
export function createCharter({ projectId, version = 1, attributes } = {}) {
  if (typeof projectId !== 'string' || !projectId) {
    throw new TypeError('createCharter: projectId required');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError('createCharter: version must be a positive integer');
  }
  if (!Array.isArray(attributes) || attributes.length === 0) {
    throw new TypeError('createCharter: at least one requested attribute required');
  }
  if (attributes.length > CHARTER_MAX_ATTRIBUTES) {
    throw new RangeError(`createCharter: at most ${CHARTER_MAX_ATTRIBUTES} attributes (got ${attributes.length})`);
  }
  const seen = new Set();
  const normalised = attributes.map((a) => {
    if (!a || !isVocabKey(a.key)) {
      throw new RangeError(`createCharter: unknown attribute key ${JSON.stringify(a?.key)} (not in the coarse vocabulary)`);
    }
    if (seen.has(a.key)) throw new RangeError(`createCharter: duplicate attribute key ${a.key}`);
    seen.add(a.key);
    if (typeof a.purpose !== 'string' || !a.purpose.trim()) {
      throw new TypeError(`createCharter: attribute ${a.key} needs a non-empty "why we ask" purpose`);
    }
    return { key: a.key, purpose: a.purpose.trim() };
  });
  // Canonical key order so the same charter always hashes identically.
  normalised.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return { projectId, version, attributes: normalised };
}

/** Recursively key-sorted JSON — the canonical form the hash is taken over. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => { acc[k] = canonicalize(value[k]); return acc; }, {});
  }
  return value;
}

/**
 * Deterministic content hash of a charter (projectId + version + attributes).
 * A signature (project pubkey) signs THIS value at integration; contributions
 * carry it so the agreed charter is provable + tamper-evident.
 * @param {object} charter  a charter (from createCharter, or the same shape)
 * @returns {string} lowercase hex sha-256
 */
export function charterHash(charter) {
  const content = canonicalize({
    projectId: charter.projectId,
    version: charter.version,
    attributes: charter.attributes,
  });
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(content))));
}

/** The set of attribute keys a charter requests. */
export function charterKeys(charter) {
  return (charter?.attributes ?? []).map((a) => a.key);
}
