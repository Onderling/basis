/**
 * Browser-safe shim for `node:crypto`.
 *
 * Aliased via vite.config.js → resolve.alias.  Static `import { createHash }
 * from 'node:crypto'` statements in @canopy/core (PodExporter, identity
 * serializers, reference-manifest), @canopy/sync-engine (hashNode, versions),
 * and @canopy/pseudo-pod (NodeFsBackend) all resolve here at build time.
 *
 * Those code paths are guarded — the browser bundle never actually calls
 * `createHash` because:
 *   - PodExporter is constructed only when a Node pod client is wired
 *   - hashNode is the DEFAULT hash adapter; browser callers inject `hashRN`
 *     (or the WebCrypto-backed adapter) via `opts.hash`
 *   - NodeFsBackend is a Node-only pseudo-pod backend (browser uses
 *     MemoryBackend / IndexedDBBackend)
 *
 * Each named export throws at runtime if reached — surfaces a wiring bug
 * instead of silently no-oping.  `randomUUID` + `subtle` delegate to
 * `globalThis.crypto` because those names DO have browser-native
 * equivalents and any caller landing here probably wanted that anyway.
 *
 * Replaces ~3 per-file `await import('node:crypto')` lazy-loads (which
 * worked but pessimised the bundle with one async boundary per call site).
 * See `apps/canopy-chat/docs/CHANGELOG-α.md` for the cleanup story.
 */

const browserStub = (name) => () => {
  throw new Error(
    `[node:crypto.${name}] called in the browser bundle — should be unreachable. ` +
    `Inject a browser-safe adapter via opts (e.g. opts.hash = hashRN) ` +
    `or check the runtime guard for the calling code.`,
  );
};

export const createHash  = browserStub('createHash');
export const createHmac  = browserStub('createHmac');
export const randomBytes = browserStub('randomBytes');
export const createCipheriv  = browserStub('createCipheriv');
export const createDecipheriv = browserStub('createDecipheriv');
export const pbkdf2       = browserStub('pbkdf2');
export const pbkdf2Sync   = browserStub('pbkdf2Sync');
export const scrypt       = browserStub('scrypt');
export const scryptSync   = browserStub('scryptSync');
export const generateKeyPair = browserStub('generateKeyPair');
export const generateKeyPairSync = browserStub('generateKeyPairSync');
export const sign         = browserStub('sign');
export const verify       = browserStub('verify');
// feedback-pipeline's project-seal (node-only envelope sealing) imports these. Reachable in the
// browser bundle only via the guarded feedback path (central-pod's `isSealed` is a pure format check
// that never calls crypto; real seal/open run server-side / in the dynamic pod path), so stubs keep
// the bundle building and surface a clear error if browser sealing is ever actually invoked.
export const createPublicKey  = browserStub('createPublicKey');
export const createPrivateKey = browserStub('createPrivateKey');
export const diffieHellman    = browserStub('diffieHellman');
export const hkdfSync         = browserStub('hkdfSync');
export const webcrypto    = globalThis.crypto ?? { subtle: undefined };

// Browser-native equivalents — delegate when available.
export const randomUUID = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('[node:crypto.randomUUID] no globalThis.crypto.randomUUID available');
};
export const subtle = globalThis.crypto?.subtle ?? browserStub('subtle');
export const getRandomValues = (buf) => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(buf);
  throw new Error('[node:crypto.getRandomValues] no globalThis.crypto.getRandomValues available');
};

export default {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  pbkdf2Sync,
  scrypt,
  scryptSync,
  generateKeyPair,
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  diffieHellman,
  hkdfSync,
  webcrypto,
  randomUUID,
  subtle,
  getRandomValues,
};
