/**
 * bind() — service-bind flow with a mocked native bridge.
 */

import { describe, it, expect } from 'vitest';
import { bind } from '../../src/hub-binding/bind.js';

/**
 * Mock native bridge. Configurable per-test:
 *   - hubVersions:    what getSupportedVersions returns
 *   - bindFails:      throw on bindService
 *   - registerFails:  throw on registerBundle
 *   - methodResults:  override per-method results
 */
function nativeMock({
  hubVersions = [1],
  bindFails = false,
  registerFails = false,
  methodResults = {},
} = {}) {
  const calls = [];
  const bindings = new Map();
  let nextBindingId = 1;
  return {
    calls,
    bindings,
    async bindService(args) {
      calls.push({ name: 'bindService', args });
      if (bindFails) throw new Error('bind refused');
      const id = `binding-${nextBindingId++}`;
      bindings.set(id, { connected: true });
      return id;
    },
    async getSupportedVersions(bindingId) {
      calls.push({ name: 'getSupportedVersions', bindingId });
      return hubVersions;
    },
    async callMethod(bindingId, methodName, args) {
      calls.push({ name: 'callMethod', bindingId, methodName, args });
      if (methodName === 'registerBundle' && registerFails) {
        throw new Error('hub refused bundle');
      }
      if (methodName === 'registerBundle') return 'session-1';
      return methodResults[methodName] ?? null;
    },
    async unbindService(bindingId) {
      calls.push({ name: 'unbindService', bindingId });
      bindings.delete(bindingId);
    },
  };
}

const MANIFEST = {
  bundleId:       'tasks-bundle',
  displayName:    'Tasks',
  supportedTypes: ['task'],
};

describe('bind — input validation', () => {
  it('rejects missing nativeModule', async () => {
    await expect(bind({ manifest: MANIFEST }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing manifest', async () => {
    await expect(bind({ nativeModule: nativeMock() }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing manifest.bundleId', async () => {
    await expect(bind({ nativeModule: nativeMock(), manifest: {} }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('bind — happy path', () => {
  it('binds + negotiates + registers + returns IHubBinding', async () => {
    const native = nativeMock({ hubVersions: [1, 2] });
    const binding = await bind({
      nativeModule:   native,
      manifest:       MANIFEST,
      clientVersions: [1, 2],
    });
    expect(binding.bindingId).toBe('binding-1');
    expect(binding.sessionId).toBe('session-1');
    expect(binding.version).toBe(2);
    expect(binding.isClosed).toBe(false);

    // Call order: bindService → getSupportedVersions → callMethod(registerBundle)
    const names = native.calls.map(c => c.name + (c.methodName ? `:${c.methodName}` : ''));
    expect(names).toEqual([
      'bindService',
      'getSupportedVersions',
      'callMethod:registerBundle',
    ]);

    // manifestJson is the wire-shape passed to registerBundle.
    const registerCall = native.calls.find(c => c.methodName === 'registerBundle');
    const parsed = JSON.parse(registerCall.args.manifestJson);
    expect(parsed).toMatchObject({
      bundleId:       'tasks-bundle',
      displayName:    'Tasks',
      supportedTypes: ['task'],
    });
  });

  it('V1-only Hub negotiates down to V1', async () => {
    const native = nativeMock({ hubVersions: [1] });
    const binding = await bind({
      nativeModule:   native,
      manifest:       MANIFEST,
      clientVersions: [1, 2],
    });
    expect(binding.version).toBe(1);
  });

  it('intentAction defaults to org.onderling.hub.BIND', async () => {
    const native = nativeMock();
    await bind({ nativeModule: native, manifest: MANIFEST });
    expect(native.calls[0].args.intentAction).toBe('org.onderling.hub.BIND');
  });
});

describe('bind — failure paths unbind cleanly', () => {
  it('bindService failure throws + no leaked binding', async () => {
    const native = nativeMock({ bindFails: true });
    await expect(bind({ nativeModule: native, manifest: MANIFEST }))
      .rejects.toThrow(/bind refused/);
    // No unbindService call necessary — bind itself failed.
    expect(native.bindings.size).toBe(0);
  });

  it('version mismatch unbinds before throwing', async () => {
    const native = nativeMock({ hubVersions: [3] });
    await expect(bind({
      nativeModule:   native,
      manifest:       MANIFEST,
      clientVersions: [1, 2],
    })).rejects.toMatchObject({ code: 'NO_COMPATIBLE_VERSION' });
    expect(native.calls.some(c => c.name === 'unbindService')).toBe(true);
    expect(native.bindings.size).toBe(0);
  });

  it('registerBundle failure unbinds', async () => {
    const native = nativeMock({ registerFails: true });
    await expect(bind({ nativeModule: native, manifest: MANIFEST }))
      .rejects.toMatchObject({ code: 'REGISTER_FAILED' });
    expect(native.bindings.size).toBe(0);
  });

  it('version-probe failure unbinds', async () => {
    const native = {
      async bindService() { return 'binding-x'; },
      async getSupportedVersions() { throw new Error('binder dropped'); },
      async unbindService() {},
    };
    await expect(bind({ nativeModule: native, manifest: MANIFEST }))
      .rejects.toMatchObject({ code: 'VERSION_PROBE_FAILED' });
  });
});
