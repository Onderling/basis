/**
 * The mobile attachment blob store — bytes on the filesystem, never in AsyncStorage.
 * A fake expo-file-system keeps the contract honest without a device.
 */
import { describe, it, expect, vi } from 'vitest';
import { createAttachmentBlobStoreRN } from '../src/core/attachmentBlobStoreRN.js';

function fakeFs({ documentDirectory = 'file:///docs/', fail = null } = {}) {
  const files = new Map();
  return {
    files,
    documentDirectory,
    EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: vi.fn(async () => {}),
    writeAsStringAsync: vi.fn(async (p, v) => { if (fail === 'write') throw new Error('disk full'); files.set(p, v); }),
    getInfoAsync: vi.fn(async (p) => ({ exists: files.has(p) })),
    readAsStringAsync: vi.fn(async (p) => { if (fail === 'read') throw new Error('gone'); return files.get(p); }),
  };
}

describe('createAttachmentBlobStoreRN', () => {
  it('writes the payload as a FILE, not a storage key, and reads it back', async () => {
    const fs = fakeFs();
    const s = createAttachmentBlobStoreRN({ fs });
    await s.put('f1', 'QUJD');
    expect(await s.get('f1')).toBe('QUJD');
    const [path, value, opts] = fs.writeAsStringAsync.mock.calls[0];
    expect(path).toBe('file:///docs/attachments/f1');
    expect(value).toBe('QUJD');
    expect(opts.encoding).toBe('base64');
  });

  it('keeps a file id from escaping the directory', async () => {
    const fs = fakeFs();
    const s = createAttachmentBlobStoreRN({ fs });
    await s.put('../../etc/passwd', 'QUJD');
    expect(fs.writeAsStringAsync.mock.calls[0][0]).toBe('file:///docs/attachments/____etc_passwd');
    expect(fs.writeAsStringAsync.mock.calls[0][0]).not.toContain('..');
  });

  it('a missing file reads back null', async () => {
    const s = createAttachmentBlobStoreRN({ fs: fakeFs() });
    expect(await s.get('nope')).toBeNull();
  });

  it('a write failure never throws at the caller', async () => {
    const s = createAttachmentBlobStoreRN({ fs: fakeFs({ fail: 'write' }) });
    await expect(s.put('f1', 'QUJD')).resolves.toBeUndefined();
  });

  it('a read failure returns null rather than throwing', async () => {
    const fs = fakeFs({ fail: 'read' });
    const s = createAttachmentBlobStoreRN({ fs });
    fs.files.set('file:///docs/attachments/f1', 'QUJD');
    expect(await s.get('f1')).toBeNull();
  });

  it('with no documentDirectory it degrades quietly', async () => {
    const s = createAttachmentBlobStoreRN({ fs: fakeFs({ documentDirectory: null }) });
    await s.put('f1', 'QUJD');
    expect(await s.get('f1')).toBeNull();
  });
});
