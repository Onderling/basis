/**
 * onboardScanRouting — verifies that classified-QR results navigate
 * to the right downstream screen with the right params.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeForKind } from '../src/lib/onboardScanRouting.js';
import { ROUTES }       from '../src/navigation.js';

function makeNav() {
  return { navigate: vi.fn() };
}

describe('routeForKind', () => {
  it('invite → OnboardJoin with the invite payload', () => {
    const nav = makeNav();
    const res = routeForKind(nav, {
      kind: 'invite',
      payload: { groupId: 'g1', code: 'P3LK9-X4QM7', expiresAt: 123 },
    });
    expect(res).toBe(ROUTES.OnboardJoin);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.OnboardJoin, expect.objectContaining({
      invite: { groupId: 'g1', code: 'P3LK9-X4QM7', expiresAt: 123 },
    }));
  });

  it('contact → Shell/Contacts with pendingContact', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'contact', payload: 'onderling-contact://x' });
    expect(r).toBe(ROUTES.Shell);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.Shell, expect.objectContaining({
      screen: ROUTES.Contacts,
      params: expect.objectContaining({ pendingContact: 'onderling-contact://x' }),
    }));
  });

  it('recovery → OnboardRestore with prefilledMnemonic (joined)', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'recovery', payload: ['a', 'b', 'c'] });
    expect(r).toBe(ROUTES.OnboardRestore);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.OnboardRestore, expect.objectContaining({
      prefilledMnemonic: 'a b c',
    }));
  });

  it('unknown → null + no navigation', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'unknown' });
    expect(r).toBeNull();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('passes routeParams through', () => {
    const nav = makeNav();
    routeForKind(nav, { kind: 'invite', payload: { groupId: 'g', code: 'C', expiresAt: 1 } }, { from: 'deeplink' });
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.OnboardJoin, expect.objectContaining({
      from: 'deeplink',
      invite: { groupId: 'g', code: 'C', expiresAt: 1 },
    }));
  });

  it('null nav returns null', () => {
    expect(routeForKind(null, { kind: 'invite' })).toBeNull();
    expect(routeForKind({}, { kind: 'invite' })).toBeNull();
  });

  it('handles null classified', () => {
    expect(routeForKind(makeNav(), null)).toBeNull();
    expect(routeForKind(makeNav(), undefined)).toBeNull();
  });
});
