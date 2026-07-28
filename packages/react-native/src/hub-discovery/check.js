/**
 * `check()` — detect whether the Hub-Android is installed.
 *
 * Calls the Android `PackageManager.queryIntentServices` query for
 * the Hub's well-known intent action (`org.onderling.hub.BIND`). The
 * native module bridge owns the actual Java/Kotlin call; this module
 * normalises the result + caches it.
 *
 * Standardisation Phase 51.6.2.
 *
 * @typedef {object} HubInstallCheck
 * @property {boolean} hubInstalled
 * @property {number}  [hubVersion]      — declared major version (1, 2, …)
 * @property {string}  [packageName]     — Android package name when installed
 * @property {string}  [serviceName]     — fully-qualified service class name
 * @property {string}  [checkedAt]       — ISO timestamp of this check
 */

const DEFAULT_INTENT_ACTION = 'org.onderling.hub.BIND';

/**
 * @param {object} args
 * @param {object} args.nativeModule        — { queryHubService(intentAction) → Promise<rawResult> }
 * @param {object} args.cache               — { getCached / setCached / invalidate }
 * @param {string} [args.intentAction]      — override the default Hub intent action
 * @param {() => string} [args.now]
 * @returns {Promise<HubInstallCheck>}
 */
export async function check({
  nativeModule,
  cache,
  intentAction = DEFAULT_INTENT_ACTION,
  now          = () => new Date().toISOString(),
} = {}) {
  if (!nativeModule || typeof nativeModule.queryHubService !== 'function') {
    throw Object.assign(
      new Error('hub-discovery.check: nativeModule.queryHubService is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!cache || typeof cache.getCached !== 'function') {
    throw Object.assign(
      new Error('hub-discovery.check: cache is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const cached = cache.getCached();
  if (cached) return cached;

  let raw;
  try {
    raw = await nativeModule.queryHubService(intentAction);
  } catch (err) {
    // Native bridge errors → treat as "not installed" but DON'T cache the
    // negative result; transient bridge failures shouldn't latch.
    const result = Object.freeze({
      hubInstalled: false,
      checkedAt:    now(),
      error:        err?.message ?? String(err),
    });
    return result;
  }

  const result = _normalise(raw, now());
  cache.setCached(result);
  return result;
}

function _normalise(raw, checkedAt) {
  if (!raw || typeof raw !== 'object' || !raw.hubInstalled) {
    return Object.freeze({ hubInstalled: false, checkedAt });
  }
  return Object.freeze({
    hubInstalled: true,
    checkedAt,
    ...(typeof raw.hubVersion === 'number' ? { hubVersion: raw.hubVersion } : {}),
    ...(typeof raw.packageName === 'string' ? { packageName: raw.packageName } : {}),
    ...(typeof raw.serviceName === 'string' ? { serviceName: raw.serviceName } : {}),
    ...(Array.isArray(raw.supportedVersions) ? { supportedVersions: [...raw.supportedVersions] } : {}),
  });
}

export { DEFAULT_INTENT_ACTION };
