/**
 * projectAgentCard — project a registry entry to an A2A Agent Card.
 *
 * The registry list resource is the WRITE-truth for a user's agents;
 * the per-agent A2A Agent Card is the DERIVED read/interop view. This
 * projection builds the card from a (frozen, normalised) registry
 * entry — it does NOT reuse core's `AgentCardBuilder`, which builds
 * from a live in-process `Agent`, not a registry record.
 *
 * Card shape = the A2A standard fields + an `x-canopy` extension
 * block (ownership · grants · lifecycle). Skill descriptions are
 * strongly advised but optional per A2A — the registry doesn't carry
 * them yet, so the card is valid without.
 */

const CARD_VERSION = '1.0';

/**
 * Project a registry agent entry to a frozen A2A Agent Card: the standard card fields plus the
 * `x-canopy` extension block (ownership, grants, lifecycle status). Skill ids are the sorted,
 * de-duplicated union of grant skills and coarse capabilities. Throws INVALID_ARGUMENT when
 * `entry` / `entry.agentId` is missing.
 *
 * @param {object} entry            — a registry agent entry (v2 shape)
 * @param {object} [opts]
 * @param {string} [opts.owner]     — owner webid/key; defaults to entry.webid
 * @returns {object} frozen A2A agent card
 */
export function projectAgentCard(entry, { owner } = {}) {
  if (!entry || typeof entry !== 'object') {
    throw Object.assign(
      new Error('projectAgentCard: entry is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof entry.agentId !== 'string' || entry.agentId.length === 0) {
    throw Object.assign(
      new Error('projectAgentCard: entry.agentId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const grants       = Array.isArray(entry.grants)       ? entry.grants       : [];
  const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : [];

  // Skill ids = dedup union of grant skills + coarse capabilities, sorted.
  const skillIds = [...new Set([
    ...grants.map(g => g?.skill).filter(s => typeof s === 'string' && s.length > 0),
    ...capabilities.filter(c => typeof c === 'string' && c.length > 0),
  ])].sort();

  const extensionBlock = Object.freeze({
    id:       entry.agentId,
    pubKey:   entry.pubKey ?? null,
    owner:    owner ?? entry.webid ?? null,
    role:     entry.role ?? null,
    deviceId: entry.deviceId ?? null,
    grants:   Object.freeze(grants.map(g => Object.freeze({
      tokenId:    g?.tokenId    ?? null,
      skill:      g?.skill      ?? null,
      capability: g?.capability ?? null,
      expiresAt:  g?.expiresAt  ?? null,
    }))),
    status:   entry.revokedAt ? 'revoked' : 'active',
    lastSeen: entry.signedAt ?? null,
    created:  entry.signedAt ?? null,
  });

  return Object.freeze({
    name:    entry.name ?? entry.agentId,
    url:     entry.agentUri ?? null,
    version: CARD_VERSION,
    capabilities: Object.freeze({
      streaming:              false,
      pushNotifications:      false,
      stateTransitionHistory: false,
    }),
    skills: Object.freeze(skillIds.map(id => Object.freeze({ id }))),
    authentication: Object.freeze({
      schemes: Object.freeze(['Bearer']),
    }),
    // Naming migration 2026-07-29 — written under BOTH keys for one window (x-onderling going
    // forward; x-canopy keeps older readers + the public feedback repo working). Readers prefer new.
    'x-onderling': extensionBlock,
    'x-canopy':    extensionBlock,
  });
}
