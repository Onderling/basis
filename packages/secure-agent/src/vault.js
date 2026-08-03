/**
 * @onderling/secure-agent — vault helpers.
 *
 * Lifted from basis's `apps/basis/src/web/realAgent.js`
 * (v0.7.P3a).  Promoted to substrate so the factory + any other
 * app can reuse the same persistence pattern.
 *
 * Layer: substrate.  Platform: neutral (uses globalThis for the
 * browser-detection check; tests inject VaultMemory directly).
 */

import {
  VaultMemory,
  VaultLocalStorage,
  VaultIndexedDB,
} from '@onderling/vault';
import { AgentIdentity } from '@onderling/core';

/**
 * Pick the right vault for the runtime + options:
 *
 *   passphrase + IndexedDB  →  VaultIndexedDB (AES-GCM encrypted)        ← S3 secure
 *   no-passphrase + localStorage →  VaultLocalStorage (plaintext)          ← S0 default
 *   otherwise (Node / tests / SSR)  →  VaultMemory (transient)             ← fallback
 *
 * Caller can always pass an explicit `vault` to createSecureAgent
 * to bypass this picker entirely (e.g. tests inject VaultMemory).
 *
 * @param {string|object} [arg='sa-id:']    Backwards-compat: a string is treated as `prefix`.
 *                                          Or an object: { prefix, passphrase }.
 * @returns {Vault}
 */
export function makeBrowserVault(arg = 'sa-id:') {
  // Accept legacy string form OR options object.
  const opts = (typeof arg === 'string') ? { prefix: arg } : (arg ?? {});
  const prefix     = opts.prefix     ?? 'sa-id:';
  const passphrase = opts.passphrase ?? null;

  // passphrase-wrapped vault.  IndexedDB is the only browser
  // backend the @onderling/vault family supports encryption for.
  if (passphrase) {
    if (typeof globalThis.indexedDB !== 'undefined') {
      try {
        return new VaultIndexedDB({
          dbName:        prefix,
          storeName:     'vault',
          encryptionKey: passphrase,
        });
      } catch {
        // Fall through; surface a clear warning below.
      }
    }
    if (typeof console !== 'undefined') {
      console.warn(
        '[secure-agent] passphrase opt set but IndexedDB unavailable; ' +
        'vault stays unencrypted.  (Provide your own VaultIndexedDB ' +
        'or VaultNodeFs via opts.vault to enforce encryption here.)',
      );
    }
  }

  // default browser path: plaintext localStorage.
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      return new VaultLocalStorage({ prefix });
    } catch {
      // Storage may be disabled / over quota; fall through to in-memory.
    }
  }
  return new VaultMemory();
}

/**
 * Restore an AgentIdentity from the vault; generate a fresh one
 * if none persisted.  Same key persists across reloads via the
 * vault's `agent-privkey` slot.
 *
 * @param {Vault} vault
 * @returns {Promise<AgentIdentity>}
 */
export async function restoreOrGenerate(vault) {
  try {
    if (await vault.has('agent-privkey')) {
      return await AgentIdentity.restore(vault);
    }
  } catch {
    // Corrupt or unreadable entry → generate fresh (next slice
    // could surface a clearer warning + recovery flow).
  }
  return AgentIdentity.generate(vault);
}
