/**
 * THE BRIDGE — a declared op, invoked by another agent, reaching the waist.
 *
 * This is the seam the whole remote-surface arc was about, and it is deliberately NOT a new mechanism:
 * the caller uses `agent.invoke`, the receiver gates with `PolicyEngine.checkInbound`, the authority is a
 * `CapabilityToken`. The only thing that changed is that a manifest op is now a registered kernel skill,
 * so that path can finally arrive somewhere.
 *
 * What each assertion is really about:
 *   - token-less → refused. Reaching an agent is not authority to act as it.
 *   - granted    → the WAIST runs. Not "the skill resolved" — the actual parameter changes value, which is
 *                  the difference between a door that opens and a door that opens onto something.
 *   - wrong op   → refused. A token names one op; scoping is the token's, not a filter's.
 *   - withheld   → refused even WITH a token for it, because `policy: 'never'` short-circuits first.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, CapabilityToken, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { memoryDataSource } from '@onderling/item-store';
import { paramsManifest } from '../src/v2/paramsManifest.js';
import { householdManifest } from '../../household/manifest.js';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

/** Boot an owner exposing its declared ops, plus a caller agent on the same bus. */
async function ownerAndCaller() {
  const A = await createRealHouseholdAgent({
    seedHousehold: false,
    settingsDataSource: memoryDataSource(),
    a2aManifests: [paramsManifest, householdManifest],
  });
  const owner = A.sa.agent;
  // The caller is any identity the owner trusts enough to talk to; its AUTHORITY is the token, not the tier.
  const caller = await AgentIdentity.generate(new VaultMemory());
  await A.sa.trust?.setTier?.(caller.pubKey, 'authenticated');
  return { A, owner, caller };
}

/** Mint a grant for one op, exactly as a connection grant does. */
const grantFor = async (owner, caller, skill) =>
  (await CapabilityToken.issue(owner.identity, {
    subject: caller.pubKey, agentId: owner.address, skill, expiresIn: 60_000,
  })).toJSON();

describe('the A2A bridge — a peer invokes a declared op through the waist', () => {
  it('refuses a token-less call: reaching the agent is not authority to act as it', async () => {
    const { owner, caller } = await ownerAndCaller();
    await expect(
      owner.policyEngine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'params.set-param' }),
      'a token-less caller reached a declared op',
    ).rejects.toMatchObject({ code: 'NO_TOKEN' });
  }, 120_000);

  it('admits a granted call AND the waist actually runs — the value changes', async () => {
    const { A, owner, caller } = await ownerAndCaller();
    const token = await grantFor(owner, caller, 'params.set-param');
    await A.sa.trust?.setTier?.(owner.identity.pubKey, 'trusted');   // the token's issuer must be trusted

    await expect(owner.policyEngine.checkInbound({
      peerPubKey: caller.pubKey, skillId: 'params.set-param', token,
    })).resolves.toMatchObject({ allowed: true });

    // Past the gate, the registered handler is the waist. THIS is the bridge: not that dispatch resolved,
    // but that the op did what it says.
    const skill = owner.skills.get('params.set-param');
    expect(skill, 'the declared op was never registered as a kernel skill').toBeTruthy();
    await skill.handler({ parts: [DataPart({ key: 'display.theme', value: 'dark' })] });
    expect(A.getParamValue('display.theme'), 'the gate opened but the waist never ran').toBe('dark');
  }, 120_000);

  it('a token for ONE op does not admit another — scoping is the token’s job', async () => {
    const { A, owner, caller } = await ownerAndCaller();
    const token = await grantFor(owner, caller, 'params.set-param');
    await A.sa.trust?.setTier?.(owner.identity.pubKey, 'trusted');
    await expect(
      owner.policyEngine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'params.get-param', token }),
      'a token minted for set-param admitted get-param',
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  }, 120_000);

  it('a withheld op is refused even holding a token for it — `never` beats any grant', async () => {
    const { A, owner, caller } = await ownerAndCaller();
    const token = await grantFor(owner, caller, 'household.revealOwnerPhrase');
    await A.sa.trust?.setTier?.(owner.identity.pubKey, 'trusted');
    await expect(
      owner.policyEngine.checkInbound({
        peerPubKey: caller.pubKey, skillId: 'household.revealOwnerPhrase', token,
      }),
      'a recovery phrase was delegable to a peer holding a grant',
    ).rejects.toMatchObject({ code: 'POLICY_NEVER' });
  }, 120_000);
});
