/**
 * A factory-built PolicyEngine must be ATTACHED to the agent — otherwise it is
 * a silent no-op that looks like enforcement.
 *
 * The bug (pre-fix): createSecureAgent built the PolicyEngine and exposed it as
 * `sa.policy`, and realAgent.js even pushed a revocation check into it afterwards —
 * but `sa.agent.policyEngine` stayed null (Agent's field was getter-only, set at
 * construction, and the PE is built afterwards). So `runGatedSkill`'s
 * `if (agent.policyEngine)` was always false: nothing was ever gated. The fix
 * adds an attach-once setter on Agent and calls it in the factory.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

describe('PolicyEngine attach (createSecureAgent)', () => {
  it('with policyEngine enabled, the engine is ATTACHED to the agent and enforces', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      trustRegistry: true,
      policyEngine:  true,
    });

    // sa.policy exists AND is the very engine runGatedSkill will consult.
    expect(sa.policy).toBeTruthy();
    expect(sa.agent.policyEngine).toBe(sa.policy); // ← the fix (was null before)

    // And it actually gates: a 'private' skill denies an unknown (tier-1) caller.
    sa.agent.register('secret', async () => [], { visibility: 'private' });
    await expect(
      sa.agent.policyEngine.checkInbound({
        peerPubKey: 'an-unknown-peer',
        skillId:    'secret',
        action:     'call',
        agentPubKey: sa.agent.pubKey,
      }),
    ).rejects.toThrow(/tier/i);

    await sa.shutdown();
  });

  it('without policyEngine there is no gate (the pre-fix default — now explicitly opt-in)', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.policy).toBeNull();
    expect(sa.agent.policyEngine).toBeNull();
    await sa.shutdown();
  });

  it('attach is set-once — a conflicting re-attach throws (enforcement can\'t be swapped out)', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      trustRegistry: true,
      policyEngine:  true,
    });
    expect(() => { sa.agent.policyEngine = { checkInbound: async () => ({ allowed: true }) }; })
      .toThrow(/already attached/);
    // Re-attaching the SAME engine is a harmless no-op.
    expect(() => { sa.agent.policyEngine = sa.policy; }).not.toThrow();
    await sa.shutdown();
  });
});
