/**
 * @onderling/secure-agent — public entry.
 *
 * Safety-by-default agent factory.  See createSecureAgent.js for
 * the full design + opt list.
 *
 * Convention (after this lands, codified in
 * Project Files/conventions/architectural-layering.md):
 *   New apps composing a real network transport MUST use this
 *   factory.  Per-opt opt-outs require a grep-able
 *   `// SECURITY: opted out — <reason>` comment.
 */

export { createSecureAgent } from './createSecureAgent.js';
export { createSecureMeshAgent } from './createSecureMeshAgent.js';   // T5.3 — the unified secure-mesh factory
export { makeBrowserVault, restoreOrGenerate } from './vault.js';

// mute / block
export { loadMuteSet, MuteSet } from './mute.js';

// signed WebID claim
export {
  signClaim,
  verifyClaim,
  serializeClaim,
  parseClaim,
  CLAIM_VERSION,
  DEFAULT_TTL_MS as DEFAULT_CLAIM_TTL_MS,
} from './claim.js';

// WebAuthn / passkey helpers
export {
  registerPasskey,
  unlockWithPasskey,
  webauthnAvailable,
  PASSKEY_ERRORS,
} from './passkey.js';

// peer identity resolver

// signed activity / audit log
export { loadAuditLog, AuditLog, AUDIT_VERSION } from './auditLog.js';

// rate limiter
export {
  createRateLimiter, RateLimiter, RATE_LIMIT_DEFAULTS,
} from './rateLimit.js';

// Perfect Forward Secrecy (partial Double-Ratchet)
export {
  loadPFSChain, PFSChain,
  PFS_VERSION, DEFAULT_MAX_SKIP,
} from './pfs.js';

// B #63 Tier-2 — remote-handler dispatch tier + revocable ocap + live registration.
// Composes the kernel's callSkill (agent.invoke) + PolicyEngine + CapabilityToken
// + TokenRegistry to resolve an op to an external agent and gate it with a grant.
export {
  RemoteHandlerRegistry,
  dispatchRemoteOp,
  grantRemoteCapability,
  enableIssuerRevocation,
  NOT_REMOTE,
} from './remoteHandlers.js';

// re-export the substrate primitives the factory wires
export {
  TrustRegistry,
  TIER_LEVEL,
  CapabilityToken,
  PolicyEngine,
  ROLES,
  roleRank,
  isKnownRole,
  registerCustomRole,
  unregisterCustomRole,
  canPromote,
  listKnownRoles,
  offeringMatches,
  skillAttenuates,
  GroupManager,
  A2ATLSLayer,
  A2AAuth,
} from '@onderling/core';
export { migrateVaultToPod } from '@onderling/pod-client';
