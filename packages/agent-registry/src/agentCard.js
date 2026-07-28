/**
 * projectAgentCard — project a registry entry to an A2A Agent Card.
 *
 * The registry list resource is the WRITE-truth for a user's agents;
 * the per-agent A2A Agent Card is the DERIVED read/interop view. This
 * projection builds the card from a (frozen, normalised) registry
 * entry — it does NOT reuse core's `AgentCardBuilder`, which builds
 * from a live in-process `Agent`, not a registry record.
 *
 * Card shape = the A2A standard fields + an `x-onderling` extension
 * block (ownership · grants · lifecycle). Skill descriptions are
 * strongly advised but optional per A2A — the registry doesn't carry
 * them yet, so the card is valid without.
 */
import { filterExposedSkills } from './skillExposure.js';


const CARD_VERSION = '1.0';

/**
 * Project a registry agent entry to a frozen A2A Agent Card: the standard card fields plus the
 * `x-onderling` extension block (ownership, grants, lifecycle status). Skill ids are the sorted,
 * de-duplicated union of grant skills and coarse capabilities. Throws INVALID_ARGUMENT when
 * `entry` / `entry.agentId` is missing.
 *
 * Skills the entry's `exposure` policy HIDES are left off the card — the card is what other people
 * read, so this is where "hide a skill" takes effect. It is a discovery filter and nothing more: the
 * grants that authorise a dispatch are unchanged and still listed, because a grant a reader holds is
 * theirs to know about. Omitting a skill does not stop anyone who knows its id from calling it — the
 * token check at dispatch does that (→ src/skillExposure.js).
 *
 * @param {object} entry            — a registry agent entry (v2 shape)
 * @param {object} [opts]
 * @param {string} [opts.owner]     — owner webid/key; defaults to entry.webid
 * @param {string} [opts.circleId]  — project the card AS SEEN IN this circle (applies that circle's
 *                                    narrowing on top of the agent-wide policy); omitted → agent-wide
 * @returns {object} frozen A2A agent card
 */
export function projectAgentCard(entry, { owner, circleId = null } = {}) {
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

  // Skill ids = dedup union of grant skills + coarse capabilities, sorted — minus whatever this
  // agent's exposure policy hides (agent-wide, plus this circle's own narrowing).
  const skillIds = filterExposedSkills({
    skills: [...new Set([
      ...grants.map(g => g?.skill).filter(s => typeof s === 'string' && s.length > 0),
      ...capabilities.filter(c => typeof c === 'string' && c.length > 0),
    ])].sort(),
    exposure: entry.exposure,
    circleId,
  });

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
    'x-onderling': extensionBlock,
  });
}
