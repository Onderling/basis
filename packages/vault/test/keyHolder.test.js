/**
 * ONE KEY FOR EVERY SEALED VAULT, SWITCHED BY A CEREMONY.
 *
 * A revoke, a re-key or a self-enroll reseals every sealed backing under a new key. A VaultEncrypted built before it with
 * the key's BYTES keeps reading with the old key, so everything read after the reseal in the same session fails. A
 * vault built with a key HOLDER reads the key at each call; the ceremony switches it inside `rotate`, which no read or
 * write crosses: one already running finishes first, one that arrives waits, and both see a whole state.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { VaultMemory, VaultEncrypted, resealVault, createKeyHolder } from '../index.js';

const key = () => nacl.randomBytes(32);

describe('a key holder for the sealed vaults', () => {
  it('a vault built before a rotation reads and writes after it', async () => {
    const backing = new VaultMemory();
    const k1 = key(); const k2 = key();
    const holder = createKeyHolder(k1);
    const vault = new VaultEncrypted({ backing, key: holder });
    await vault.set('trust:a', 'private');
    await holder.rotate(async () => { await resealVault({ backing, oldKey: k1, newKey: k2 }); return k2; });
    expect(await vault.get('trust:a')).toBe('private');
    await vault.set('trust:b', 'authenticated');
    expect(await new VaultEncrypted({ backing, key: k2 }).get('trust:b')).toBe('authenticated');
  });

  it('a write that arrives during the rotation waits, and lands under the new key', async () => {
    const backing = new VaultMemory();
    const k1 = key(); const k2 = key();
    const holder = createKeyHolder(k1);
    const vault = new VaultEncrypted({ backing, key: holder });
    let release;
    const gate = new Promise((r) => { release = r; });
    const rotating = holder.rotate(async () => { await gate; await resealVault({ backing, oldKey: k1, newKey: k2 }); return k2; });
    const writing = vault.set('trust:c', 'private');
    await new Promise((r) => setTimeout(r, 5));
    expect(await backing.get('trust:c')).toBeNull();   // nothing written while the rotation runs
    release();
    await rotating; await writing;
    expect(await new VaultEncrypted({ backing, key: k2 }).get('trust:c')).toBe('private');
    expect(await vault.get('trust:c')).toBe('private');
  });

  it('a rotation waits for a read already running', async () => {
    const backing = new VaultMemory();
    const k1 = key(); const k2 = key();
    const holder = createKeyHolder(k1);
    const order = [];
    const slow = holder.use(async (k) => { await new Promise((r) => setTimeout(r, 10)); order.push(k === k1 ? 'read-old' : 'read-new'); });
    const rot = holder.rotate(async () => { order.push('rotate'); return k2; });
    await Promise.all([slow, rot]);
    expect(order).toEqual(['read-old', 'rotate']);
    expect(holder.current()).toBe(k2);
    void backing;
  });

  it('a rotation that fails keeps the key in force', async () => {
    const k1 = key();
    const holder = createKeyHolder(k1);
    await expect(holder.rotate(async () => { throw new Error('the key door did not take it'); })).rejects.toThrow(/key door/);
    expect(holder.current()).toBe(k1);
    expect(await holder.use(async (k) => k)).toBe(k1);
  });

  it('a rotation may answer the old key (a rollback): the key in force is what it returns', async () => {
    const k1 = key();
    const holder = createKeyHolder(k1);
    await holder.rotate(async (old) => old);
    expect(holder.current()).toBe(k1);
  });

  it('bytes still work as before (a constant key)', async () => {
    const backing = new VaultMemory();
    const k1 = key();
    const vault = new VaultEncrypted({ backing, key: k1 });
    await vault.set('x', 'y');
    expect(await vault.get('x')).toBe('y');
  });
});
