/**
 * KeychainVault — Vault backed by react-native-keychain.
 *
 * Uses iOS Secure Enclave / Android Keystore via react-native-keychain.
 * All values are stored as password entries under a service-prefixed key.
 *
 * Peer dependency: react-native-keychain
 */
import * as keychain from 'react-native-keychain';
import { Vault } from '@onderling/vault';

export class KeychainVault extends Vault {
  #service;

  /**
   * @param {object} [opts]
   * @param {string} [opts.service='onderling']  — keychain service namespace
   */
  constructor({ service = 'onderling' } = {}) {
    super();
    this.#service = service;
  }

  async get(key) {
    const result = await keychain.getInternetCredentials(`${this.#service}:${key}`);
    if (!result) return null;
    return result.password;
  }

  async set(key, value) {
    await keychain.setInternetCredentials(
      `${this.#service}:${key}`,
      key,          // username = key name (required by keychain API)
      String(value),
    );
  }

  async delete(key) {
    await keychain.resetInternetCredentials(`${this.#service}:${key}`);
  }

  async has(key) {
    const result = await keychain.getInternetCredentials(`${this.#service}:${key}`);
    return !!result;
  }

  async list() {
    // react-native-keychain does not expose a list operation.
    // We maintain a manifest entry that tracks known keys.
    const manifestRaw = await this.get('__manifest__');
    if (!manifestRaw) return [];
    try {
      return JSON.parse(manifestRaw);
    } catch {
      return [];
    }
  }

  // ── Override set/delete to maintain the manifest ─────────────────────────

  async set(key, value) {
    if (key !== '__manifest__') await this.#updateManifest(key, 'add');
    await keychain.setInternetCredentials(
      `${this.#service}:${key}`,
      key,
      String(value),
    );
  }

  async delete(key) {
    if (key !== '__manifest__') await this.#updateManifest(key, 'remove');
    await keychain.resetInternetCredentials(`${this.#service}:${key}`);
  }

  async #updateManifest(key, op) {
    const current = await this.list();
    const next = op === 'add'
      ? [...new Set([...current, key])]
      : current.filter(k => k !== key);
    // Use the keychain directly to avoid recursion.
    await keychain.setInternetCredentials(
      `${this.#service}:__manifest__`,
      '__manifest__',
      JSON.stringify(next),
    );
  }
}
