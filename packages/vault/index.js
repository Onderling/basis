/**
 * @onderling/vault — agent identity + token storage.
 *
 * Vault family:
 *   - Vault              — abstract base class (subclass to provide a
 *                          custom backend; defines the `get / set /
 *                          delete / list` contract).
 *   - VaultMemory        — in-memory implementation. Tests, RAM-only
 *                          agents, default fallback.
 *   - VaultLocalStorage  — browser LocalStorage backend.
 *   - VaultIndexedDB     — browser IndexedDB backend (larger; async).
 *   - VaultNodeFs        — Node filesystem backend.
 *
 * Plus the OAuth-token helper:
 *   - OAuthVault         — typed wrapper over a Vault for OAuth
 *                          access/refresh tokens.
 *   - makeAuthorizedFetch — fetch wrapper that pulls tokens from an
 *                          OAuthVault.
 *
 * Extracted from `@onderling/core/identity` 2026-05-11 (standardisation
 * Phase 50.1.A — see Project Files/SDK/core-v2-coding-plan-2026-05-11.md).
 * `@onderling/core` keeps a deprecation re-export through one minor
 * release; new code should import from `@onderling/vault` directly.
 */

export { Vault }                from './src/Vault.js';
export {
  VaultEncrypted,
  migrateVaultToEncrypted,
  resealVault,
  VAULT_ENC_SENTINEL_KEY,
  VAULT_ENC_VERSION,
} from './src/VaultEncrypted.js';
export {
  RootKeyStore,
  RootKeyStoreMemory,
  RootKeyStoreVault,
  ROOT_SEED_VAULT_KEY,
  assertSeed,
  seedToString,
  seedFromString,
} from './src/RootKeyStore.js';
export { RootKeyStoreWebCrypto } from './src/RootKeyStoreWebCrypto.js';
export { VaultMemory }          from './src/VaultMemory.js';
export { VaultLocalStorage }    from './src/VaultLocalStorage.js';
export { VaultIndexedDB }       from './src/VaultIndexedDB.js';
export { VaultNodeFs }          from './src/VaultNodeFs.js';
export {
  OAuthVault,
  makeAuthorizedFetch,
} from './src/OAuthVault.js';
