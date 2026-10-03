/**
 * The export key's set, unlock and lock — ONE implementation the box's `export-key.mjs` and the screen's ops both use,
 * over the box's own files (the key file, the unlocked file with its hour).
 */
import { describe, it, expect } from 'vitest';
import { createExportKeyFile } from '../src/v2/exportKeyFile.js';
import { EXPORT_KEY_FILE, UNLOCKED_KEY_FILE, unlockedSecret } from '../src/v2/householdExportShelf.js';
import { sealExport, openExport } from '../src/v2/householdExportSeal.js';

const fast = { m: 8, t: 1, p: 1 };   // fast argon2 for tests
function files() {
  const m = new Map();
  return { m, read: (n) => m.get(n) ?? null, write: (n, t) => { m.set(n, t); }, remove: (n) => { m.delete(n); } };
}

describe('the export key over the box\'s files', () => {
  it('set: too short is refused and writes nothing; a passphrase writes the key and closes an open one', async () => {
    const f = files();
    const k = createExportKeyFile({ files: f, argonOpts: fast });
    expect(await k.set('kort')).toEqual({ ok: false, reason: 'too-short' });
    expect(f.m.size).toBe(0);
    f.write(UNLOCKED_KEY_FILE, 'old');
    expect(await k.set('een lange passphrase')).toEqual({ ok: true, replaced: false });
    expect(JSON.parse(f.read(EXPORT_KEY_FILE)).publicKey).toBeTruthy();
    expect(f.read(UNLOCKED_KEY_FILE)).toBeNull();
    expect(k.exists()).toBe(true);
    expect((await k.set('nog een lange zin')).replaced).toBe(true);
  });

  it('unlock: no key → refused; a wrong passphrase → refused, still locked; the right one opens it for the hour', async () => {
    const f = files();
    let now = 1000;
    const k = createExportKeyFile({ files: f, argonOpts: fast, now: () => now });
    expect(await k.unlock('een lange passphrase')).toEqual({ ok: false, reason: 'no-key' });
    await k.set('een lange passphrase');
    expect(await k.unlock('niet de goede zin')).toEqual({ ok: false, reason: 'wrong-passphrase' });
    expect(f.read(UNLOCKED_KEY_FILE)).toBeNull();
    const r = await k.unlock('een lange passphrase');
    expect(r.ok).toBe(true);
    // the opened key opens a file sealed to it
    const sealed = sealExport({ exportedAt: 'x', things: [1] }, JSON.parse(f.read(EXPORT_KEY_FILE)));
    const secret = unlockedSecret(f.read(UNLOCKED_KEY_FILE), now);
    expect(openExport(sealed, secret)).toMatchObject({ things: [1] });
    k.lock();
    expect(f.read(UNLOCKED_KEY_FILE)).toBeNull();
  });
});
