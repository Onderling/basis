/**
 * The box's vault passphrase comes from its environment (the box's .env), never from a file in the data directory: that
 * directory is a volume the box backs up off the device, and a snapshot holding both the sealed stores and the key that
 * opens them opens everything. The four cases, and the runner itself refusing to boot without one.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveVaultPassphrase } from '../src/v2/boxVaultPassphrase.js';

const dirWith = (content) => {
  const d = mkdtempSync(path.join(tmpdir(), 'vault-pass-'));
  if (content != null) writeFileSync(path.join(d, 'vault.passphrase'), content);
  return d;
};
const quiet = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

describe('the vault passphrase comes from the environment', () => {
  it('env set, no file: the env, and nothing is written to the data directory', () => {
    const d = dirWith(null); const { log } = quiet();
    expect(resolveVaultPassphrase({ env: { BASIS_VAULT_PASSPHRASE: 'p-env' }, dataDir: d, log })).toBe('p-env');
    expect(existsSync(path.join(d, 'vault.passphrase'))).toBe(false);
  });
  it('env set and a file that equals it: the file is deleted, one line says so', () => {
    const d = dirWith('p-env\n'); const { log, lines } = quiet();
    expect(resolveVaultPassphrase({ env: { BASIS_VAULT_PASSPHRASE: 'p-env' }, dataDir: d, log })).toBe('p-env');
    expect(existsSync(path.join(d, 'vault.passphrase'))).toBe(false);
    expect(lines.length).toBe(1);
    expect(lines.join('')).not.toContain('p-env');
  });
  it('env set and a file that DIFFERS: refused, both left as they are', () => {
    const d = dirWith('p-old');
    expect(() => resolveVaultPassphrase({ env: { BASIS_VAULT_PASSPHRASE: 'p-env' }, dataDir: d, log: () => {} })).toThrow(/two vault passphrases/);
    expect(readFileSync(path.join(d, 'vault.passphrase'), 'utf8')).toBe('p-old');
  });
  it('no env but a file: the file, and a line telling the operator to re-run install.sh', () => {
    const d = dirWith('p-old\n'); const { log, lines } = quiet();
    expect(resolveVaultPassphrase({ env: {}, dataDir: d, log })).toBe('p-old');
    expect(lines.join(' ')).toMatch(/install\.sh/);
    expect(lines.join('')).not.toContain('p-old');
  });
  it('neither: refused (a box without a passphrase is misconfigured), and no file is made', () => {
    const d = dirWith(null);
    expect(() => resolveVaultPassphrase({ env: {}, dataDir: d, log: () => {} })).toThrow(/no vault passphrase/);
    expect(existsSync(path.join(d, 'vault.passphrase'))).toBe(false);
  });
  it('the runner itself refuses to boot with neither, and writes no passphrase file', () => {
    const d = dirWith(null);
    const runner = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [runner, '--data-dir', d], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: d } });
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/no vault passphrase/);
    expect(existsSync(path.join(d, 'vault.passphrase'))).toBe(false);
  }, 90_000);
});
