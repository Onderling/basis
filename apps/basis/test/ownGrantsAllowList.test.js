/**
 * The allow-list for an agent's own surface tokens fails CLOSED: asked before the agent's own key is known (the ref is
 * set a few lines after the engine is built), it refuses any token — it cannot tell an own token from another's.
 */
import { describe, it, expect } from 'vitest';
import { ownGrantsAllowList } from '../src/v2/surfaceGrants.js';

const lane = { activeEntryOf: (id) => (id === 'T1' ? { viewPubKey: 'VIEW' } : null) };

describe('ownGrantsAllowList', () => {
  it('before the own key is set: refused, whoever issued it', async () => {
    const allowed = ownGrantsAllowList(() => null, () => lane);
    expect(await allowed({ id: 'T1', issuer: 'OWN', subject: 'VIEW' })).toBe(false);
    expect(await allowed({ id: 'X', issuer: 'SOMEONE', subject: 'VIEW' })).toBe(false);
  });
  it('with the own key: an own token only while active for the same subject; another issuer as before', async () => {
    const allowed = ownGrantsAllowList(() => 'OWN', () => lane);
    expect(await allowed({ id: 'T1', issuer: 'OWN', subject: 'VIEW' })).toBe(true);
    expect(await allowed({ id: 'T1', issuer: 'OWN', subject: 'THIEF' })).toBe(false);
    expect(await allowed({ id: 'T9', issuer: 'OWN', subject: 'VIEW' })).toBe(false);
    expect(await allowed({ id: 'X', issuer: 'SOMEONE', subject: 'VIEW' })).toBe(true);
  });
});
