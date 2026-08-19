/**
 * Stoop V1 — Phase 19 closed-beta hardening smoke.
 *
 * One end-to-end pass through the circle-deployable flow that the
 * runbook (`CLOSED-BETA-RUNBOOK.md`) tells facilitators to verify
 * before bringing a real circle online:
 *
 *   1. Member redeems via the gated path (privacy + rules).
 *   2. One-shot recovery-phrase reveal works once, then locks.
 *   3. Encrypted backup produces a non-empty blob.
 *   4. Posting an `ask` is captured by metrics.
 *   5. `getMetrics` skill exposes the snapshot.
 *
 * This is intentionally a *single* passing scenario — not a matrix.
 * The matrix lives in phase17 / phase18 / phase14.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import { decryptBackup }            from '../src/lib/encryptedBackup.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

describe('Stoop V1 Phase 19 — closed-beta smoke', () => {
  it('runbook flow: gate → mnemonic → backup → post → metrics', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: tx,
      offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
      members:    [{ webid: ANNE }],
    });
    await bundle.offeringMatch.start();

    // 1. Gated redeem accepts both flags.
    const gate = await callSkill(bundle.agent, 'redeemInviteWithGate', {
      invite: { groupId: 'oosterpoort' },
      privacyAccepted: true,
      rulesAccepted:   true,
    });
    expect(gate.ok).toBe(true);

    // 2. Recovery phrase: shown once, then locked.
    const m1 = await callSkill(bundle.agent, 'getMnemonicOnce');
    expect(typeof m1.mnemonic).toBe('string');
    expect(m1.shown).toBe(false);
    const m2 = await callSkill(bundle.agent, 'getMnemonicOnce');
    expect(m2.shown).toBe(true);
    expect(m2.mnemonic).toBeNull();

    // 3. Encrypted backup → round-trip with the same passphrase decodes.
    const back = await callSkill(bundle.agent, 'encryptedBackup', { passphrase: 'correct horse battery staple' });
    expect(back.blob).toBeTruthy();
    const decoded = await decryptBackup({ blob: back.blob, passphrase: 'correct horse battery staple' });
    expect(decoded.webid).toBe(ANNE);

    // 4. Post an ask.
    const post = await callSkill(bundle.agent, 'postRequest', {
      text: 'paint the fence', intent: 'ask', expectClaims: 0, timeoutMs: 1,
    });
    expect(post.requestId).toBeTruthy();

    // 5. Metrics snapshot reflects the actions just taken.
    // Phase 52.7.2 cut-over: `intent: 'ask'` → kind: 'borrow' →
    // metric tag 'post-borrow'.
    const m = await callSkill(bundle.agent, 'getMetrics');
    expect(m.snapshot['post-borrow']?.count).toBe(1);
    expect(m.snapshot['backup-created']?.count).toBe(1);
    expect(typeof m.capturedAt).toBe('number');
  });
});
