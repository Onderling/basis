/**
 * The companion's identity vault, sealed on disk. Its data directory is a volume the box backs up off the device, so the
 * keys in it are sealed under the box's vault passphrase (BASIS_VAULT_PASSPHRASE, from the box's .env). A node made before
 * kept them in the clear: the first boot with a passphrase seals that file in place — the sealed copy written beside it,
 * the plaintext bytes overwritten (the volume may be a plain filesystem, where an unlink leaves them on disk), then the
 * sealed copy moved over it. One log line; never a key. A sealed file is opened as it is.
 */
import { existsSync, readFileSync, statSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { VaultNodeFs } from '@onderling/vault';

/**
 * @param {string} file        the identity file
 * @param {string} passphrase  the box's vault passphrase
 * @param {{log?: (line: string) => void}} [o]
 * @returns {Promise<VaultNodeFs>}
 */
export async function openSealedIdentityVault(file, passphrase, { log = () => {} } = {}) {
  if (typeof passphrase !== 'string' || !passphrase) throw new Error('companion-node: a vault passphrase is required');
  if (existsSync(file)) {
    let raw = null;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = null; }
    const entries = raw && typeof raw.entries === 'object' ? raw.entries : null;
    if (raw && !raw.salt && entries && Object.keys(entries).length > 0) {
      const tmp = `${file}.sealing`;
      const sealed = new VaultNodeFs(tmp, passphrase);
      for (const [k, v] of Object.entries(entries)) await sealed.set(k, String(v));
      const size = statSync(file).size;
      const fd = openSync(file, 'r+');
      try { writeSync(fd, Buffer.alloc(size, 0), 0, size, 0); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, file);
      log('[companion] sealed the identity vault that sat in the clear (host-identity.json)');
    }
  }
  return new VaultNodeFs(file, passphrase);
}
