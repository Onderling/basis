/**
 * An add-a-device offer names the GENERAL persona's circles in the clear (a persona's ride sealed, with its id). A device
 * that does not hold the general persona steps into none of them: not as its primary standing in (Werk walking into the
 * general persona's circles is the one thing a persona exists to keep apart), and no registry row is written for it —
 * refused like a persona the device does not run.
 */
import { describe, it, expect } from 'vitest';
import { consumeCircleEntry } from '../../src/v2/enrollOffer.js';

describe('a general-persona circle on a device without the general persona', () => {
  it('is refused — nothing written, nothing joined', async () => {
    const calls = [];
    const agent = {
      persona: (id) => (id === 'p-aaaaaaaaaaaa' ? { chatId: { pubKey: 'werk' } } : null),   // holds Werk only
      circleSelf: () => ({ sendAs: 'werk' }),
      circleAddressFor: () => 'addr',
      profileIdOf: () => 'default',
    };
    const callSkill = async (app, op, args) => { calls.push(`${app}.${op}`); return { ok: true }; };
    const row = await consumeCircleEntry({ agent, callSkill, sendPeerMessage: async () => ({}) }, { id: 'thuis', address: 'sib' });
    expect(row.ok).toBe(false);
    expect(row.error).toBe('general-not-held');
    expect(calls, 'no registry write, no join').toEqual([]);
  });

  it('a device that holds it still steps in (unchanged)', async () => {
    const calls = [];
    const agent = {
      persona: (id) => (id === 'default' ? { chatId: { pubKey: 'me' } } : null),
      circleSelf: () => ({ sendAs: null }),
      circleAddressFor: () => 'addr',
      profileIdOf: () => 'default',
    };
    const callSkill = async (app, op) => { calls.push(`${app}.${op}`); return { ok: true }; };
    await consumeCircleEntry({ agent, callSkill, sendPeerMessage: async () => ({}) }, { id: 'thuis', address: 'sib' });
    expect(calls).toContain('agents.setProfileCircleMembership');
  });
});
