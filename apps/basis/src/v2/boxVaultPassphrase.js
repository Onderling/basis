/**
 * WHERE THE BOX'S VAULT PASSPHRASE COMES FROM — its environment (the box's `.env`, `BOX_VAULT_PASSPHRASE`, handed in as
 * `BASIS_VAULT_PASSPHRASE`), never a file in the data directory. That directory is a volume the box backs up off the
 * device; a snapshot that holds the sealed stores AND the key that opens them opens everything.
 *
 * A box made before kept the passphrase in `vault.passphrase` in the data directory. The installer moves it into `.env`
 * (re-run, idempotent); until it has, the runner still boots on the file and says once per boot what the operator owes.
 * Given the environment, a file that equals it is deleted; one that differs is two passphrases, and the runner refuses
 * rather than choose. Neither is a box nobody configured: refused too — no passphrase is ever generated here.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const FILE = 'vault.passphrase';

/**
 * @param {{env: object, dataDir: string, log?: (line: string) => void}} a
 * @returns {string}  the passphrase (throws when the box is misconfigured)
 */
export function resolveVaultPassphrase({ env, dataDir, log = () => {} }) {
  const f = path.join(dataDir, FILE);
  const fromFile = existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
  const fromEnv = typeof env?.BASIS_VAULT_PASSPHRASE === 'string' && env.BASIS_VAULT_PASSPHRASE ? env.BASIS_VAULT_PASSPHRASE : null;
  if (fromEnv) {
    if (fromFile != null && fromFile !== fromEnv) {
      throw new Error(`two vault passphrases: the environment's and ${f} differ — keep the one the vault was made with (re-run install.sh) and remove the other`);
    }
    if (fromFile != null) {
      unlinkSync(f);
      log(`[vault] the passphrase comes from the environment now; removed the copy in the data directory (${FILE})`);
    }
    return fromEnv;
  }
  if (fromFile) {
    log(`[vault] the passphrase is still in the data directory (${FILE}), which the box backs up: re-run install.sh to move it into the box's .env`);
    return fromFile;
  }
  throw new Error('no vault passphrase: set BASIS_VAULT_PASSPHRASE (on a box: BOX_VAULT_PASSPHRASE in its .env, written by install.sh) — this box is misconfigured');
}
