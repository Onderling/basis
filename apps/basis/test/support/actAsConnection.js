/**
 * actAsConnection — what a granted connection actually does, for tests.
 *
 * There used to be a bespoke client and a bespoke door for this. Both are gone: a connection now acts
 * the way any agent acts on another, so this helper walks the REAL path rather than a stand-in —
 * `PolicyEngine.checkInbound` with the presented token, then the kernel skill `renderA2A` registered.
 *
 * It returns the refusal CODE rather than throwing, because most of these walks are about which refusal
 * happens: `NO_TOKEN` (nothing presented) · `INVALID_TOKEN` (expired, revoked, wrong subject, wrong op)
 * · `POLICY_NEVER` (withheld outright) · `NOT_FOUND` (no such op). A test that only knew "it threw"
 * could not tell a revoked grant from a typo.
 */
import { DataPart } from '@onderling/core';

/**
 * @param {object} agent   the owner's handle from `createRealHouseholdAgent`
 * @param {object} a
 * @param {string} a.callerPubKey  the connection's identity (the token subject)
 * @param {string} a.opId          `app.opId`, e.g. 'params.set-param'
 * @param {object} [a.args]
 * @param {object} [a.token]       the CapabilityToken JSON the grant handed over
 * @returns {Promise<{ok:true, result:*}|{ok:false, code:string}>}
 */
export async function actAsConnection(agent, { callerPubKey, opId, args = {}, token = null }) {
  const owner = agent.sa.agent;
  try {
    await owner.policyEngine.checkInbound({ peerPubKey: callerPubKey, skillId: opId, token });
  } catch (e) {
    return { ok: false, code: e?.code ?? 'DENIED' };
  }
  const skill = owner.skills.get(opId);
  if (!skill) return { ok: false, code: 'NOT_FOUND' };
  return { ok: true, result: await skill.handler({ parts: [DataPart(args)], from: callerPubKey }) };
}

/**
 * The two trust facts a grant needs to be verifiable, seeded the way a real pairing does: the caller is
 * a known peer, and the token's ISSUER — this device — is trusted, or its own tokens fail verification.
 */
export async function trustForGrant(agent, callerPubKey) {
  await agent.sa.trust?.setTier?.(callerPubKey, 'authenticated');
  await agent.sa.trust?.setTier?.(agent.sa.agent.identity.pubKey, 'trusted');
}
