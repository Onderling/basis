/**
 * A file someone sent in a contact thread, saved WHERE THE PERSON CHOOSES (Android's folder picker, the Storage Access
 * Framework in expo-file-system) — the twin of web's Download link. Before this the phone showed a received file's
 * name and size and nothing could open or keep it. The app-private directory is no answer: a person cannot reach it.
 */
import { describe, it, expect, vi } from 'vitest';
import { saveFileToChosenPlace } from '../src/core/fileSave.js';

const fakeSaf = ({ granted = true, fail = null } = {}) => {
  const written = new Map();
  return {
    written,
    EncodingType: { Base64: 'base64' },
    writeAsStringAsync: vi.fn(async (uri, v) => { if (fail === 'write') throw new Error('disk full'); written.set(uri, v); }),
    StorageAccessFramework: {
      requestDirectoryPermissionsAsync: vi.fn(async () => (granted ? { granted: true, directoryUri: 'content://tree/Downloads' } : { granted: false })),
      createFileAsync: vi.fn(async (dir, name, mime) => `${dir}/${name}#${mime}`),
    },
  };
};

describe('saveFileToChosenPlace', () => {
  it('asks where, makes the file there with its name and type, and writes the bytes', async () => {
    const fs = fakeSaf();
    const r = await saveFileToChosenPlace({ dataB64: 'JVBERi0=', name: 'rooster.pdf', mime: 'application/pdf' }, { fs });
    expect(r).toEqual({ ok: true, uri: 'content://tree/Downloads/rooster#application/pdf', name: 'rooster' });
    expect(fs.written.get(r.uri)).toBe('JVBERi0=');
    expect(fs.writeAsStringAsync.mock.calls[0][2].encoding).toBe('base64');
  });
  it('TEXT (the recovery file) is written as UTF-8 text where the person chooses, never handed to the share sheet', async () => {
    // "Save file" for the recovery file opened Android's share sheet as text (chat apps, mail, "Copy text"); nothing
    // was kept on the phone (a walk, 2026-11-27). Written as text, a name with letters outside ASCII survives as is.
    const fs = fakeSaf();
    fs.EncodingType.UTF8 = 'utf8';
    const text = '{"v":1,"naam":"Anna Ögren"}';
    const r = await saveFileToChosenPlace({ text, name: 'onderling-recovery.json', mime: 'application/json' }, { fs });
    expect(r).toEqual({ ok: true, uri: 'content://tree/Downloads/onderling-recovery#application/json', name: 'onderling-recovery' });
    expect(fs.written.get(r.uri)).toBe(text);
    expect(fs.writeAsStringAsync.mock.calls[0][2].encoding).toBe('utf8');
  });
  it('the person closes the picker: nothing written, said as such', async () => {
    const fs = fakeSaf({ granted: false });
    expect(await saveFileToChosenPlace({ dataB64: 'QQ==', name: 'a.txt', mime: 'text/plain' }, { fs })).toEqual({ ok: false, error: 'not-chosen' });
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });
  it('no bytes, or no picker on this platform: said, never a throw', async () => {
    expect(await saveFileToChosenPlace({ name: 'a' }, { fs: fakeSaf() })).toEqual({ ok: false, error: 'no-data' });
    expect(await saveFileToChosenPlace({ dataB64: 'QQ==', name: 'a' }, { fs: { EncodingType: {} } })).toEqual({ ok: false, error: 'no-picker' });
  });
  it('a write that fails says why', async () => {
    expect(await saveFileToChosenPlace({ dataB64: 'QQ==', name: 'a.bin' }, { fs: fakeSaf({ fail: 'write' }) })).toEqual({ ok: false, error: 'disk full' });
  });
});

describe('fileSaveWords', () => {
  it('kept, failed, or nothing when the person closed the picker', async () => {
    const { fileSaveWords } = await import('../src/core/fileSave.js');
    expect(fileSaveWords({ ok: true, name: 'rooster' })).toEqual({ key: 'circle.fileShare.saved', params: { name: 'rooster' } });
    expect(fileSaveWords({ ok: false, error: 'disk full' })).toEqual({ key: 'circle.fileShare.save_failed', params: { error: 'disk full' } });
    expect(fileSaveWords({ ok: false, error: 'not-chosen' })).toBe(null);
  });
});
