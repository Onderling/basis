/**
 * The companion's identity keys are sealed on disk: its data directory is a volume the box backs up. A node needs a
 * passphrase (BASIS_VAULT_PASSPHRASE) and refuses to boot without one; an identity file left in the clear by a node made
 * before is sealed in place on the first boot that has one (the plaintext bytes overwritten, one log line, never the
 * key), and a second boot leaves it as it is.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentIdentity } from '@onderling/core';
import { VaultNodeFs } from '@onderling/vault';
import { openSealedIdentityVault } from '../src/identityVault.js';
import { startCompanionNode } from '../src/index.js';

const plaintextIdentity = async (file) => {
  const id = await AgentIdentity.generate(new VaultNodeFs(file));   // no passphrase: what a node before this wrote
  return id;
};

describe('the companion identity vault is sealed', () => {
  it('a plaintext identity file is sealed in place, the same identity restores, no key in the clear', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comp-id-'));
    const file = path.join(dir, 'host-identity.json');
    const before = await plaintextIdentity(file);
    const clear = JSON.parse(readFileSync(file, 'utf8')).entries;
    const lines = [];
    const vault = await openSealedIdentityVault(file, 'test-pass', { log: (l) => lines.push(l) });
    const raw = readFileSync(file, 'utf8');
    expect(JSON.parse(raw).salt, 'sealed').toBeTruthy();
    for (const v of Object.values(clear)) expect(raw).not.toContain(v);
    expect((await AgentIdentity.restore(vault)).pubKey).toBe(before.pubKey);
    expect(lines.length).toBe(1);
    for (const v of Object.values(clear)) expect(lines.join('')).not.toContain(v);
    expect(existsSync(`${file}.sealing`)).toBe(false);
  });

  it('a second boot does not re-seal', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comp-id-'));
    const file = path.join(dir, 'host-identity.json');
    await plaintextIdentity(file);
    await openSealedIdentityVault(file, 'test-pass', { log: () => {} });
    const once = readFileSync(file, 'utf8');
    const lines = [];
    await openSealedIdentityVault(file, 'test-pass', { log: (l) => lines.push(l) });
    expect(readFileSync(file, 'utf8')).toBe(once);
    expect(lines).toEqual([]);
  });

  it('a node without a passphrase refuses to boot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'comp-id-'));
    await expect(startCompanionNode({ configDir: dir })).rejects.toThrow(/vault passphrase/);
    expect(existsSync(path.join(dir, 'host-identity.json'))).toBe(false);
  });
});
