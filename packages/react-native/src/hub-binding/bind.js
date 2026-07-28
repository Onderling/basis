/**
 * `bind({nativeModule, intentAction, hubVersion, clientVersions, manifest})`
 *   — bind to the Hub service + return an `IHubBinding`.
 *
 * Flow:
 *   1. nativeModule.bindService(...) → bindingId.
 *      The native side calls `Context.bindService` + waits for
 *      `onServiceConnected`.
 *   2. nativeModule.getSupportedVersions(bindingId) →
 *      array of Hub-supported AIDL versions.
 *   3. `negotiateVersion` picks the best compatible version.
 *   4. nativeModule.callMethod(bindingId, 'registerBundle', {manifestJson})
 *      → sessionId.
 *   5. Construct + return the `IHubBinding`.
 *
 * On `onServiceDisconnected` (native-side event), the binding is
 * automatically marked closed. Callers re-bind by calling `bind()`
 * again.
 *
 * Standardisation Phase 51.8.1 + 51.9.2.
 */

import { IHubBinding }       from './IHubBinding.js';
import { negotiateVersion }  from './versionNegotiation.js';

const DEFAULT_INTENT_ACTION = 'org.onderling.hub.BIND';
const DEFAULT_CLIENT_VERSIONS = [1];

/**
 * @param {object} args
 * @param {object}    args.nativeModule       — required
 * @param {object}    args.manifest           — { bundleId, displayName, supportedTypes }
 * @param {string}    [args.intentAction]
 * @param {number[]}  [args.clientVersions=[1]]
 * @returns {Promise<IHubBinding>}
 */
export async function bind({
  nativeModule,
  manifest,
  intentAction   = DEFAULT_INTENT_ACTION,
  clientVersions = DEFAULT_CLIENT_VERSIONS,
} = {}) {
  if (!nativeModule || typeof nativeModule.bindService !== 'function') {
    throw Object.assign(
      new Error('bind: nativeModule.bindService is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!manifest || typeof manifest !== 'object') {
    throw Object.assign(
      new Error('bind: manifest is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof manifest.bundleId !== 'string' || manifest.bundleId.length === 0) {
    throw Object.assign(
      new Error('bind: manifest.bundleId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // 1. Native bind.
  const bindingId = await nativeModule.bindService({
    intentAction,
    hubVersion: Math.max(...clientVersions),    // hint to the native side
  });
  if (typeof bindingId !== 'string' || bindingId.length === 0) {
    throw Object.assign(
      new Error('bind: native bindService did not return a bindingId'),
      { code: 'BIND_FAILED' },
    );
  }

  // 2. Hub version discovery.
  let hubVersions;
  try {
    hubVersions = typeof nativeModule.getSupportedVersions === 'function'
      ? await nativeModule.getSupportedVersions(bindingId)
      : [await nativeModule.callMethod(bindingId, 'getSupportedVersion', {})];
  } catch (err) {
    await _safeUnbind(nativeModule, bindingId);
    throw Object.assign(
      new Error('bind: failed to read Hub-supported versions'),
      { code: 'VERSION_PROBE_FAILED', cause: err },
    );
  }
  if (typeof hubVersions === 'number') hubVersions = [hubVersions];
  if (!Array.isArray(hubVersions) || hubVersions.length === 0) {
    await _safeUnbind(nativeModule, bindingId);
    throw Object.assign(
      new Error('bind: Hub reported no supported versions'),
      { code: 'NO_HUB_VERSIONS' },
    );
  }

  // 3. Version negotiation.
  let negotiated;
  try {
    negotiated = negotiateVersion({ clientVersions, hubVersions });
  } catch (err) {
    await _safeUnbind(nativeModule, bindingId);
    throw err;
  }

  // 4. Register the bundle.
  let sessionId;
  try {
    sessionId = await nativeModule.callMethod(bindingId, 'registerBundle', {
      manifestJson: JSON.stringify({
        bundleId:       manifest.bundleId,
        displayName:    manifest.displayName ?? manifest.bundleId,
        supportedTypes: Array.isArray(manifest.supportedTypes) ? manifest.supportedTypes : [],
      }),
    });
  } catch (err) {
    await _safeUnbind(nativeModule, bindingId);
    throw Object.assign(
      new Error('bind: registerBundle failed'),
      { code: 'REGISTER_FAILED', cause: err },
    );
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    await _safeUnbind(nativeModule, bindingId);
    throw Object.assign(
      new Error('bind: registerBundle did not return a sessionId'),
      { code: 'REGISTER_FAILED' },
    );
  }

  // 5. Construct the binding.
  return new IHubBinding({
    nativeModule,
    bindingId,
    sessionId,
    version: negotiated,
  });
}

async function _safeUnbind(nativeModule, bindingId) {
  if (typeof nativeModule.unbindService === 'function') {
    try { await nativeModule.unbindService(bindingId); }
    catch { /* swallow */ }
  }
}

export { DEFAULT_INTENT_ACTION, DEFAULT_CLIENT_VERSIONS };
