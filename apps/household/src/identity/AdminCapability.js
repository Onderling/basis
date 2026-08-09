/**
 * AdminCapability — capability-token machinery for managing the
 * bot's pod.
 *
 * Every household admin (Track D `admin` role) holds a capability
 * token authorising their webid as a co-administrator of the
 * bot's pod: full read/write on the pod root, until expiry.  If
 * the bot misbehaves or the keypair is suspected compromised, any
 * human admin can revoke + re-issue without touching the bot's
 * keypair directly (Q-H2.6 lock follow-up, programmed against the
 * Hybrid Pod Notes' "capability tokens are the admin handle on
 * the bot's pod").
 *
 * Reuse-first: this is a thin wrapper over
 * `@onderling/core`'s `PodCapabilityToken`.  We don't fork the
 * primitive — the token is signed by the bot's `AgentIdentity`,
 * the subject is the admin's webid string, and the scope is full
 * pod-root admin (`pod.*:/`).
 *
 * ── Revocation model ──────────────────────────────────────────
 * `PodCapabilityToken` does NOT have an explicit revoke operation
 * — a token is valid until `expiresAt`, full stop.  Three
 * implications:
 *
 *   1. `mintAdminCap` issues a token with a finite TTL.  Pick a
 *      window short enough that "wait it out" is acceptable, but
 *      long enough not to be operational drudgery (default: 30
 *      days).
 *
 *   2. `rotateAdminCaps` issues NEW tokens for every current
 *      admin and relies on the prior tokens expiring on their
 *      own.  Until they expire, both old and new tokens are
 *      simultaneously valid.  This is acceptable because:
 *      - The rotated token covers the same admin webid → no
 *        privilege escalation.
 *      - The bot's pod is governed by webid-bound tokens; an old
 *        token only authorises the same admin who already holds
 *        the new one.
 *
 *   3. If we ever need true revocation (e.g. an admin leaves the
 *      household), we either:
 *      - Wait out the token's TTL, OR
 *      - Rotate the BOT's keypair: that invalidates all
 *        outstanding tokens (they were signed by the old key) and
 *        forces all admins to be re-issued.  A pod re-keying is
 *        the heavy hammer for "admin removed".
 */
import { PodCapabilityToken } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — default admin-capability TTL (scope:device, kind:internal).
/** Default TTL for an admin cap if the caller doesn't specify one. */
const DEFAULT_EXPIRES_IN_MS = param({ key: 'household.adminCapExpiresInMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 24 * 60 * 60 * 1000 }); // 30 days.

/** The single scope an admin cap grants: full pod-root authority. */
const ADMIN_SCOPES = ['pod.*:/'];

/**
 * Mint a fresh admin capability token for a household admin.
 *
 * The token is signed by the bot's identity (proving it comes
 * from the pod's root credential) and authorises `adminWebid` to
 * read / write / delete anywhere on the bot's pod for
 * `expiresInMs` milliseconds.
 *
 * @param {object} args
 * @param {string} args.adminWebid       — webid of the admin being granted access
 * @param {string} args.botPodRoot       — the bot's pod root URI (e.g. `https://…/bot/`)
 * @param {import('@onderling/core').AgentIdentity} args.botIdentity
 *   — the bot's AgentIdentity (signs the token).  Pass
 *     `botIdentity.agentIdentity` when working with the
 *     {@link BotIdentity} wrapper.
 * @param {number} [args.expiresInMs]    — token TTL in ms (default 30 days)
 * @returns {Promise<{ token: string, expiresAt: number }>}
 *   `token` is a JSON-serialised `PodCapabilityToken` (suitable
 *   for storing in a vault entry or transport over the wire).
 */
export async function mintAdminCap({
  adminWebid,
  botPodRoot,
  botIdentity,
  expiresInMs = DEFAULT_EXPIRES_IN_MS,
} = {}) {
  if (typeof adminWebid !== 'string' || adminWebid.length === 0) {
    throw new Error('mintAdminCap: adminWebid is required');
  }
  if (typeof botPodRoot !== 'string' || botPodRoot.length === 0) {
    throw new Error('mintAdminCap: botPodRoot is required');
  }
  if (!botIdentity || typeof botIdentity.sign !== 'function') {
    throw new Error('mintAdminCap: botIdentity (AgentIdentity) is required');
  }

  const cap = await PodCapabilityToken.issue(botIdentity, {
    subject:   adminWebid,
    pod:       botPodRoot,
    scopes:    ADMIN_SCOPES,
    expiresIn: expiresInMs,
  });

  return {
    token:     cap.toString(),
    expiresAt: cap.expiresAt,
  };
}

/**
 * Verify a capability token presented by an admin.
 *
 * Confirms that the token:
 *   1. Is well-formed and JSON-parseable.
 *   2. Was signed by `botPubkey` (the bot's pubkey — the pod's
 *      root credential).
 *   3. Names `botPodRoot` as its pod.
 *   4. Has not expired.
 *
 * Note: the public-key check happens implicitly in
 * `PodCapabilityToken.verify` (the embedded `issuer` is checked
 * against the signature).  We additionally compare `issuer` to
 * `botPubkey` to reject tokens signed by ANY old/rotated bot key
 * even if they otherwise verify.
 *
 * @param {object} args
 * @param {string} args.token        — JSON-serialised PodCapabilityToken
 * @param {string} args.botPodRoot   — the pod URI we're guarding
 * @param {string} args.botPubkey    — the bot's CURRENT pubkey (base64url)
 * @returns {Promise<{ webid: string, expiresAt: number } | null>}
 *   The admin's webid + expiry on success; `null` on any failure.
 */
// TODO(R2b): converge verifyAdminCap onto @onderling/pod-client's PodTokenVerifier
// (createPodTokenVerifier). That verifier is the general SUPERSET — it adds
// scope + revocation + an injectable issuer-trust seam on top of these exact
// checks (issuer===botPubkey maps to `isTrusted: (i) => i === botPubkey`,
// botPodRoot maps to `expectedPod`). Deferred here because verifyAdminCap has NO
// per-request `requiredScope` (it validates cap existence, not a specific op) and
// returns `{webid}` not `{subject}`; converging without a call-site that supplies
// a requiredScope would be a semantic mismatch / scope-creep. See invariant #3.
export async function verifyAdminCap({ token, botPodRoot, botPubkey } = {}) {
  if (typeof token      !== 'string') return null;
  if (typeof botPodRoot !== 'string') return null;
  if (typeof botPubkey  !== 'string') return null;

  let cap;
  try {
    cap = PodCapabilityToken.fromJSON(token);
  } catch {
    return null;
  }

  // Reject tokens signed by a different (e.g. rotated-out) bot key.
  if (cap.issuer !== botPubkey) return null;

  if (!PodCapabilityToken.verify(cap, botPodRoot)) return null;

  return {
    webid:     cap.subject,
    expiresAt: cap.expiresAt,
  };
}

/**
 * Mint NEW admin caps for every admin member of the household and
 * return the resulting set.
 *
 * Used when:
 *   - The bot's key is suspected compromised (after the bot's
 *     keypair has been rotated by the caller).
 *   - Periodically, to push expiry windows forward.
 *
 * Revocation of prior tokens is best-effort: the caller is
 * responsible for distributing the new tokens to the relevant
 * admins; the old tokens remain valid until their `expiresAt`
 * (see "Revocation model" at the top of this file).
 *
 * @param {object} args
 * @param {{ members: Array<{ webid: string, role: string }>, [k: string]: any }} args.household
 *   The household config (see {@link types.HouseholdConfig}).
 *   Members with role `'admin'` get a fresh cap; everyone else is
 *   skipped.
 * @param {import('./BotIdentity.js').BotIdentity} args.botIdentity
 *   The bot's identity — already loaded.  Used to derive
 *   `botPodRoot` and to sign the new tokens.
 * @param {number} [args.expiresInMs]
 *   TTL for the freshly-minted tokens.
 * @returns {Promise<Array<{ adminWebid: string, token: string, expiresAt: number }>>}
 *   One entry per admin member.  Order matches the household's
 *   member list (admins-only, others filtered out).
 */
export async function rotateAdminCaps({
  household,
  botIdentity,
  expiresInMs = DEFAULT_EXPIRES_IN_MS,
} = {}) {
  if (!household || !Array.isArray(household.members)) {
    throw new Error('rotateAdminCaps: household.members array is required');
  }
  if (!botIdentity || !botIdentity.agentIdentity) {
    throw new Error('rotateAdminCaps: botIdentity must be loaded BotIdentity');
  }
  if (!botIdentity.botPodRoot) {
    throw new Error('rotateAdminCaps: botIdentity.botPodRoot is required');
  }

  const admins = household.members.filter(m => m && m.role === 'admin');

  const out = [];
  for (const admin of admins) {
    const { token, expiresAt } = await mintAdminCap({
      adminWebid:   admin.webid,
      botPodRoot:   botIdentity.botPodRoot,
      botIdentity:  botIdentity.agentIdentity,
      expiresInMs,
    });
    out.push({ adminWebid: admin.webid, token, expiresAt });
  }
  return out;
}
