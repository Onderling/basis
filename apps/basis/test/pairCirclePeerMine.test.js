/**
 * Pairing a device into a circle from a scanned code names the circle — and it must be one of MINE. Without the check
 * any string would do, and `ensureCircleMirror` would make a mirror (and fan its items) for a circle this person is
 * not in. Refused before anything is made; a circle I am in pairs as before.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const PEER = 'peer-address-0123456789abcdef0123456789abcdef';

describe('pairCirclePeer — only into a circle of mine', () => {
  it('a circle I am not in: refused, nothing made; one I made: paired', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    await a.callSkill('pinboard', 'createGroupV2', { groupId: 'thuis', name: 'Thuis', rules: { text: 't' } });
    const no = await a.callSkill('household', 'pairCirclePeer', { circle: 'iemand-anders', addr: PEER });
    expect(no, JSON.stringify(no)).toMatchObject({ ok: false, outcome: 'not-my-circle' });
    const mine = ((await a.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
    expect(mine).not.toContain('iemand-anders');
    const yes = await a.callSkill('household', 'pairCirclePeer', { circle: 'thuis', addr: PEER });
    expect(yes, JSON.stringify(yes)).toMatchObject({ ok: true, outcome: 'paired', circle: 'thuis' });
  });
});
