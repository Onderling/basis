/**
 * bootstrapIdentity — load-or-generate the agent identity at app start.
 *
 * Lifted from apps/pinboard-mobile/src/lib/identityBootstrap.js 2026-05-09
 * (Phase 41.0.b A3; Tasks-mobile is the second consumer).
 *
 * Pinboard hardcoded the keychain service namespace to `'pinboard'`; the
 * substrate factory takes it as an arg so each app's identity material
 * lives in its own keychain partition (`pinboard`, `tasks`, `folio`, …).
 *
 * The KeychainVault import is lazy — its module-load imports
 * `react-native-keychain` (a TS file), which vitest can't parse.
 * Tests inject a stub vault and never trigger the lazy path.
 */

import { AgentIdentity } from '@onderling/core';

/**
 * @param {object} args
 * @param {string} [args.keychainService]  Per-app keychain namespace.
 * @param {object} [args.vault]            Inject a vault for tests; bypasses vaultFactory.
 * @param {() => Promise<object>} [args.vaultFactory]
 *   When `vault` isn't passed, this builds one. Apps wire it to
 *   `() => new KeychainVault({service: keychainService})` lazily so
 *   the `react-native-keychain` import doesn't fire under vitest.
 * @returns {Promise<{ identity: object, isFresh: boolean, vault: object }>}
 */
export async function bootstrapIdentity({ keychainService, vault, vaultFactory } = {}) {
  const vlt = vault ?? (vaultFactory ? await vaultFactory() : null);
  if (!vlt) {
    throw new TypeError('bootstrapIdentity: vault or vaultFactory required');
  }

  // `AgentIdentity` keys the seed under `agent-privkey` in the vault.
  // `vault.get` returning a value means the keypair already exists.
  const raw = await vlt.get?.('agent-privkey');
  if (raw) {
    const identity = await AgentIdentity.restore(vlt);
    return { identity, isFresh: false, vault: vlt };
  }

  const identity = await AgentIdentity.generate(vlt);
  return { identity, isFresh: true, vault: vlt };
}

/**
 * Wipe the persisted identity. Used by sign-out + by the
 * mnemonic-restore flow before persisting the restored identity.
 *
 * @param {object} [args]
 * @param {object} [args.vault]
 * @param {() => Promise<object>} [args.vaultFactory]
 */
export async function clearIdentity({ vault, vaultFactory } = {}) {
  const vlt = vault ?? (vaultFactory ? await vaultFactory() : null);
  if (!vlt || typeof vlt.delete !== 'function') return;
  await Promise.all([
    vlt.delete('agent-privkey'),
    vlt.delete('agent-stableid'),
    vlt.delete('agent-deviceid'),
  ]).catch(() => { /* best-effort wipe */ });
}
