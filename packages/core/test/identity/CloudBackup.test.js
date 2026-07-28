/**
 * CloudBackup.test.js — Track C / C1 unit tests.
 *
 * Covers the locked Q-C.1 / Q-C.2 / Q-C.5 surface:
 *   - round-trip: upload → restore returns identical bootstrap secret + hints
 *   - wrong passphrase rejected with typed error
 *   - tampered envelope rejected with typed error
 *   - missing blob rejected with typed error
 *   - includeFullPod carries opaque archive bytes through
 *   - exists() before/after upload
 *   - deleteRemote() removes the blob
 *
 * Argon2id at production cost (m=64MB, t=3, p=1) is deliberately slow.
 * Tests pass `argonOpts: { m: 1024, t: 1, p: 1 }` (a CloudBackup-internal
 * test-only override) to keep the suite fast.  Do not mirror this in
 * production callers.
 */
import { describe, it, expect } from 'vitest';

import { Bootstrap }                  from '../../src/identity/Bootstrap.js';
import { CloudBackup }                from '../../src/identity/CloudBackup.js';
import { MemoryAdapter, CloudAdapter } from '../../src/identity/CloudAdapter.js';

const FAST_ARGON = { m: 1024, t: 1, p: 1 };

const arrEq = (a, b) =>
  a instanceof Uint8Array
  && b instanceof Uint8Array
  && a.length === b.length
  && a.every((byte, i) => byte === b[i]);

const sampleHints = () => ([
  {
    method:         'bip39-seed-paper',
    hint:           'In the lockbox at home, top-left envelope',
    setupAt:        '2026-04-28T10:30:00Z',
    lastVerifiedAt: '2026-04-28T10:30:00Z',
  },
  {
    method:     'cloud-backup-dropbox',
    identifier: 'onderling-backup',
    setupAt:    '2026-04-28T10:35:00Z',
  },
]);

describe('CloudAdapter / MemoryAdapter', () => {
  it('CloudAdapter base methods all throw not-implemented', async () => {
    const a = new CloudAdapter();
    await expect(a.put('r', new Uint8Array())).rejects.toThrow(/not implemented/);
    await expect(a.get('r')).rejects.toThrow(/not implemented/);
    await expect(a.delete('r')).rejects.toThrow(/not implemented/);
    await expect(a.list()).rejects.toThrow(/not implemented/);
  });

  it('MemoryAdapter round-trips arbitrary bytes', async () => {
    const a = new MemoryAdapter();
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    await a.put('foo', payload);
    expect(await a.get('foo')).toEqual(payload);
    expect(await a.list()).toEqual(['foo']);
    await a.delete('foo');
    expect(await a.get('foo')).toBeNull();
  });

  it('MemoryAdapter validates inputs', async () => {
    const a = new MemoryAdapter();
    await expect(a.put('', new Uint8Array())).rejects.toThrow();
    await expect(a.put('k', /** @type {any} */ ('not bytes'))).rejects.toThrow();
  });
});

describe('CloudBackup — constructor', () => {
  it('rejects missing/invalid adapter', () => {
    expect(() => new CloudBackup({ adapter: null })).toThrow(/adapter/);
    expect(() => new CloudBackup({ adapter: {} })).toThrow(/adapter/);
  });

  it('rejects empty ref', () => {
    expect(() => new CloudBackup({ adapter: new MemoryAdapter(), ref: '' })).toThrow(/ref/);
  });

  it('exposes the configured ref', () => {
    const cb = new CloudBackup({ adapter: new MemoryAdapter(), ref: 'foo.enc' });
    expect(cb.ref).toBe('foo.enc');
  });

  it('defaults to onderling-cloud-backup.enc', () => {
    const cb = new CloudBackup({ adapter: new MemoryAdapter() });
    expect(cb.ref).toBe('onderling-cloud-backup.enc');
  });
});

describe('CloudBackup — upload + restore round-trip', () => {
  it('round-trips bootstrap secret and hints', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    const hints  = sampleHints();
    const passphrase = 'correct horse battery staple';

    await cb.upload({ bootstrap, passphrase, hints });

    // Fresh CloudBackup instance against the same adapter — proves we don't
    // rely on in-memory state.
    const cb2 = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const restored = await cb2.restore({ passphrase });

    expect(restored.bootstrap).toBeInstanceOf(Bootstrap);
    expect(arrEq(restored.bootstrap.secret, bootstrap.secret)).toBe(true);
    expect(restored.hints).toEqual(hints);
    expect(restored.fullPodArchive).toBeUndefined();
  });

  it('upload overwrites the previous blob at the same ref', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap: b1 } = Bootstrap.create();
    const { bootstrap: b2 } = Bootstrap.create();
    const passphrase = 'pw';

    await cb.upload({ bootstrap: b1, passphrase });
    await cb.upload({ bootstrap: b2, passphrase });

    const restored = await cb.restore({ passphrase });
    expect(arrEq(restored.bootstrap.secret, b2.secret)).toBe(true);
    expect(arrEq(restored.bootstrap.secret, b1.secret)).toBe(false);
  });

  it('hints default to an empty array when omitted', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    const passphrase = 'pw';

    await cb.upload({ bootstrap, passphrase });
    const restored = await cb.restore({ passphrase });
    expect(restored.hints).toEqual([]);
  });
});

describe('CloudBackup — error paths', () => {
  it('wrong passphrase throws CLOUD_BACKUP_DECRYPT_FAILED', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    await cb.upload({ bootstrap, passphrase: 'right' });

    await expect(cb.restore({ passphrase: 'wrong' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_DECRYPT_FAILED' });
  });

  it('tampered ciphertext throws CLOUD_BACKUP_DECRYPT_FAILED', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    await cb.upload({ bootstrap, passphrase: 'pw' });

    // Mutate the stored envelope: flip a byte inside the base64-encoded
    // ciphertext string.
    const stored = await adapter.get('onderling-cloud-backup.enc');
    const env    = JSON.parse(new TextDecoder().decode(stored));
    // Flip a character near the end of the ct string (still base64-valid).
    const ctChars = env.ct.split('');
    const i = ctChars.length - 5;
    ctChars[i] = ctChars[i] === 'A' ? 'B' : 'A';
    env.ct = ctChars.join('');
    await adapter.put(
      'onderling-cloud-backup.enc',
      new TextEncoder().encode(JSON.stringify(env)),
    );

    await expect(cb.restore({ passphrase: 'pw' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_DECRYPT_FAILED' });
  });

  it('missing blob throws CLOUD_BACKUP_NOT_FOUND', async () => {
    const cb = new CloudBackup({ adapter: new MemoryAdapter(), argonOpts: FAST_ARGON });
    await expect(cb.restore({ passphrase: 'pw' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_NOT_FOUND' });
  });

  it('malformed envelope JSON throws CLOUD_BACKUP_MALFORMED', async () => {
    const adapter = new MemoryAdapter();
    await adapter.put(
      'onderling-cloud-backup.enc',
      new TextEncoder().encode('not json at all'),
    );
    const cb = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    await expect(cb.restore({ passphrase: 'pw' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_MALFORMED' });
  });

  it('envelope with missing fields throws CLOUD_BACKUP_MALFORMED', async () => {
    const adapter = new MemoryAdapter();
    await adapter.put(
      'onderling-cloud-backup.enc',
      new TextEncoder().encode(JSON.stringify({ v: 1, alg: 'argon2id+xsalsa20poly1305' })),
    );
    const cb = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    await expect(cb.restore({ passphrase: 'pw' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_MALFORMED' });
  });

  it('upload validates inputs', async () => {
    const cb = new CloudBackup({ adapter: new MemoryAdapter(), argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    await expect(cb.upload({ bootstrap, passphrase: '' })).rejects.toThrow(/passphrase/);
    await expect(cb.upload({ bootstrap: /** @type {any} */ ({}), passphrase: 'p' }))
      .rejects.toThrow(/Bootstrap/);
    await expect(cb.upload({
      bootstrap, passphrase: 'p', hints: /** @type {any} */ ('not array'),
    })).rejects.toThrow(/hints/);
    await expect(cb.upload({
      bootstrap, passphrase: 'p', fullPodArchive: /** @type {any} */ ('not bytes'),
    })).rejects.toThrow(/fullPodArchive/);
  });

  it('restore validates inputs', async () => {
    const cb = new CloudBackup({ adapter: new MemoryAdapter(), argonOpts: FAST_ARGON });
    await expect(cb.restore({ passphrase: '' })).rejects.toThrow(/passphrase/);
  });
});

describe('CloudBackup — includeFullPod (Q-C.1 opt-in)', () => {
  it('round-trips an opaque PodExporter archive', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    // Mock archive bytes — C1 treats these as opaque.
    const fullPodArchive = new Uint8Array(256);
    for (let i = 0; i < fullPodArchive.length; i++) fullPodArchive[i] = (i * 7) & 0xff;

    await cb.upload({ bootstrap, passphrase: 'pw', fullPodArchive });
    const restored = await cb.restore({ passphrase: 'pw' });

    expect(restored.fullPodArchive).toBeInstanceOf(Uint8Array);
    expect(arrEq(restored.fullPodArchive, fullPodArchive)).toBe(true);
  });

  it('omits fullPodArchive when not provided', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();

    await cb.upload({ bootstrap, passphrase: 'pw' });
    const restored = await cb.restore({ passphrase: 'pw' });
    expect(restored.fullPodArchive).toBeUndefined();
  });
});

describe('CloudBackup — exists() + deleteRemote()', () => {
  it('exists() is false on empty adapter, true after upload', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    expect(await cb.exists()).toBe(false);

    const { bootstrap } = Bootstrap.create();
    await cb.upload({ bootstrap, passphrase: 'pw' });
    expect(await cb.exists()).toBe(true);
  });

  it('deleteRemote() removes the blob; restore then throws NOT_FOUND', async () => {
    const adapter = new MemoryAdapter();
    const cb      = new CloudBackup({ adapter, argonOpts: FAST_ARGON });
    const { bootstrap } = Bootstrap.create();
    await cb.upload({ bootstrap, passphrase: 'pw' });
    expect(await cb.exists()).toBe(true);

    await cb.deleteRemote();
    expect(await cb.exists()).toBe(false);
    await expect(cb.restore({ passphrase: 'pw' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_NOT_FOUND' });
  });
});
