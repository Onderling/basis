/**
 * appVersion — is the build this tab runs the one the site serves? (2026-09-19)
 *
 * An open tab never updates itself, and the host caches `index.html` heuristically: Frits' laptop ran a build from
 * before the fix that made his phone's messages visible, while the site served the fix — "my web tab isn't receiving
 * messages". The tab compares its baked tag with `version.json` (fetched fresh) at boot and whenever it regains
 * focus, and says so when they differ. Pure: the fetch and the clock are injected.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVersionWatch, updateAvailable } from '../../src/v2/appVersion.js';

describe('updateAvailable', () => {
  it('is true only when the served tag is known and differs from the running one', () => {
    expect(updateAvailable('v0.1.12-alpha', { tag: 'v0.1.13-alpha' })).toBe(true);
    expect(updateAvailable('v0.1.13-alpha', { tag: 'v0.1.13-alpha' })).toBe(false);
    expect(updateAvailable('v0.1.13-alpha', null)).toBe(false);
    expect(updateAvailable('v0.1.13-alpha', { tag: '' })).toBe(false);
    // a dev build (no baked tag) never nags
    expect(updateAvailable('', { tag: 'v0.1.13-alpha' })).toBe(false);
    expect(updateAvailable(undefined, { tag: 'v0.1.13-alpha' })).toBe(false);
  });
});

describe('createVersionWatch', () => {
  it('asks fresh (no-store), tells the listener once per newer tag, and again on a later check', async () => {
    const served = { tag: 'v0.1.13-alpha', sha: 'abc' };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => served }));
    const onUpdate = vi.fn();
    const w = createVersionWatch({ running: 'v0.1.12-alpha', versionUrl: '/basis/version.json', fetchImpl, onUpdate });
    expect(await w.check()).toEqual({ running: 'v0.1.12-alpha', served: 'v0.1.13-alpha', update: true });
    expect(fetchImpl).toHaveBeenCalledWith('/basis/version.json', expect.objectContaining({ cache: 'no-store' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ running: 'v0.1.12-alpha', served: 'v0.1.13-alpha' });
    await w.check();
    expect(onUpdate, 'the same newer tag is said once, not on every focus').toHaveBeenCalledTimes(1);
    served.tag = 'v0.1.14-alpha';
    await w.check();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
  it('a failed or malformed fetch is no update (offline is not "outdated")', async () => {
    const onUpdate = vi.fn();
    const w1 = createVersionWatch({ running: 'v1', versionUrl: '/v.json', fetchImpl: async () => { throw new Error('offline'); }, onUpdate });
    expect(await w1.check()).toEqual({ running: 'v1', served: null, update: false });
    const w2 = createVersionWatch({ running: 'v1', versionUrl: '/v.json', fetchImpl: async () => ({ ok: false }), onUpdate });
    expect((await w2.check()).update).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
