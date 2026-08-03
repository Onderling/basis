// Reveals resolves THROUGH disclosure.js: showDisplayName ≡ the display-name
// attribute's `enabled` bit for that (group/peer) context. Round-trips the delegation.
import { describe, it, expect } from 'vitest';
import { isDisclosed } from '@onderling/agent-registry';
import { Reveals, REVEAL_DISPLAY_NAME_KEY, groupRevealContext, peerRevealContext } from '../src/Reveals.js';

const ANNE = 'https://id.inrupt.com/anne';
const GROUP = 'oosterpoort-skills';

describe('Reveals ↔ disclosure display-name bit', () => {
  it('setPeerReveal drives the displayName enabled bit on the underlying policy', () => {
    const r = new Reveals();
    r.setPeerReveal(ANNE, true);
    const policy = r.disclosurePolicy();
    // the round-trip: the decision boolean IS the attribute's enabled bit for the peer context.
    expect(isDisclosed(policy, peerRevealContext(ANNE), REVEAL_DISPLAY_NAME_KEY)).toBe(true);
    expect(r.decide({ peerWebid: ANNE }).showDisplayName).toBe(true);

    r.setPeerReveal(ANNE, false);
    expect(isDisclosed(r.disclosurePolicy(), peerRevealContext(ANNE), REVEAL_DISPLAY_NAME_KEY)).toBe(false);
    expect(r.decide({ peerWebid: ANNE }).showDisplayName).toBe(false);
  });

  it('setGroupReveal drives the displayName enabled bit on the group context', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    expect(isDisclosed(r.disclosurePolicy(), groupRevealContext(GROUP), REVEAL_DISPLAY_NAME_KEY)).toBe(true);
    expect(r.decide({ groupId: GROUP }).showDisplayName).toBe(true);
  });

  it('clearPeerReveal drops the peer context entry entirely (absent, not enabled:false)', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    r.setPeerReveal(ANNE, false);
    r.clearPeerReveal(ANNE);
    const policy = r.disclosurePolicy();
    expect(policy.perContext[peerRevealContext(ANNE)]).toBeUndefined();   // record gone
    // falls back to the group default via disclosure resolution
    expect(r.decide({ peerWebid: ANNE, groupId: GROUP })).toEqual({ showDisplayName: true, source: 'group' });
  });

  it('the snapshot is a copy — mutating it cannot corrupt the store', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    const snap = r.disclosurePolicy();
    snap.perContext[groupRevealContext(GROUP)][REVEAL_DISPLAY_NAME_KEY].enabled = false;
    expect(r.decide({ groupId: GROUP }).showDisplayName).toBe(true);      // store intact
  });
});
