/**
 * The sealed export: the box seals each night's file with only the PUBLIC half of a key the admin made from a
 * passphrase; the file carries that key sealed with the passphrase, so it opens on its own — on this box or a new one.
 * The wrong passphrase opens nothing; another key opens nothing; the box's sealing needs nothing secret.
 */
import { describe, it, expect } from 'vitest';
import { createExportKey, unlockExportKey, sealExport, openExport, isSealedExport } from '../src/v2/householdExportSeal.js';

const LIGHT = { m: 256, t: 1, p: 1 };   // the KDF's cost, light for a test (the box uses the envelope's default)
const FILE = { format: 'onderling-household-export', v: 1, lists: [{ n: 1, name: 'Boodschappen', entries: [{ n: 2, type: 'list-item', text: 'melk' }] }], people: [], loose: [] };

describe('the sealed export', () => {
  it('seals with the public half; opens with the passphrase, from the file alone', async () => {
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    expect(Object.keys(key).sort()).toEqual(['publicKey', 'sealedSecret', 'v']);
    const sealed = sealExport(FILE, { publicKey: key.publicKey, sealedSecret: key.sealedSecret });
    expect(isSealedExport(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('melk');
    // a new box: only the file
    const secret = await unlockExportKey({ key: sealed, passphrase: 'correct horse battery', argonOpts: LIGHT });
    expect(openExport(sealed, secret)).toEqual(FILE);
  });

  it('the wrong passphrase, or another key, opens nothing', async () => {
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    const sealed = sealExport(FILE, key);
    await expect(unlockExportKey({ key: sealed, passphrase: 'wrong horse battery', argonOpts: LIGHT })).rejects.toThrow('wrong-passphrase');
    const other = await createExportKey({ passphrase: 'another passphrase!', argonOpts: LIGHT });
    const otherSecret = await unlockExportKey({ key: other, passphrase: 'another passphrase!', argonOpts: LIGHT });
    expect(() => openExport(sealed, otherSecret)).toThrow('not-this-key');
  });
});

describe('the shelf seals when the admin has set a key', () => {
  it('a sealed night file says only whether it holds something; the last good one is still kept', async () => {
    const { createExportShelf } = await import('../src/v2/householdExportShelf.js');
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    const disk = new Map();
    const files = { list: async () => [...disk.keys()], write: async (n, t) => { disk.set(n, t); }, read: async (n) => disk.get(n), remove: async (n) => { disk.delete(n); } };
    let at = new Date('2026-10-01T02:00:00').getTime();
    let full = true;
    const shelf = createExportShelf({
      files, keep: 2, now: () => at,
      exportNow: async () => (full ? FILE : { ...FILE, lists: [] }),
      sealWith: async () => key,
    });
    await shelf.writeNow();
    full = false;
    for (let d = 1; d <= 3; d++) { at += 86_400_000; await shelf.writeNow(); }
    const names = await shelf.names();
    expect(names).toHaveLength(3);
    const all = await Promise.all(names.map((n) => shelf.read(n)));
    expect(all.every(isSealedExport)).toBe(true);
    expect(all.map((f) => f.holds)).toEqual([false, false, true]);
    expect(JSON.stringify(all)).not.toContain('melk');
  });
});

describe('/import of a sealed file', () => {
  it('locked: it says how to unlock on the box; unlocked: it imports, and the key is locked again', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    const sealed = sealExport({ ...FILE, lists: [] , people: [{ id: 'telegram:1', role: 'member' }] }, key);
    let secret = null;
    let locked = 0;
    const imported = [];
    const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    const admin = {
      exports: { names: async () => ['household-export-2026-10-01-0200.json'], read: async () => sealed },
      unlockedKey: async () => secret, lockKey: async () => { locked += 1; secret = null; },
      importFile: async (f) => { imported.push(f); return { ok: true, done: { lists: 0, entries: 0, chores: 0, appointments: 0, people: 1 }, notRestored: [] }; },
    };
    const call = withAssistantOps({ callSkill: async () => ({ ok: false }), threads: null, t: tt, admin });
    const shut = await call('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json' });
    expect(shut.ok).toBe(false);
    expect(shut.error.message).toContain('circle.bot.import_locked');
    secret = await unlockExportKey({ key: sealed, passphrase: 'correct horse battery', argonOpts: LIGHT });
    expect((await call('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json', preview: true })).message).toContain('"people":1');
    expect((await call('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json' })).ok).toBe(true);
    expect(imported[0].people).toEqual([{ id: 'telegram:1', role: 'member' }]);
    expect(locked).toBe(1);
  });
});

describe('/export', () => {
  it('writes one now and says whether it is sealed', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    const files = new Map();
    const exports = { writeNow: async () => { files.set('household-export-2026-10-01-0900.json', sealExport(FILE, key)); return 'household-export-2026-10-01-0900.json'; }, read: async (n) => files.get(n), names: async () => [...files.keys()] };
    const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    const call = withAssistantOps({ callSkill: async () => ({ ok: false }), threads: null, t: tt, admin: { exports } });
    expect((await call('assistant', 'assistant-export', {})).message).toContain('circle.bot.export_written_sealed');
  });
});

describe('the review of the sealed export', () => {
  it('a passphrase is at least 12 characters', async () => {
    await expect(createExportKey({ passphrase: 'eleven-char', argonOpts: LIGHT })).rejects.toThrow(/at least 12/);
  });

  it('the unlocked key is locked after any real /import attempt — also one that fails', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const key = await createExportKey({ passphrase: 'correct horse battery', argonOpts: LIGHT });
    const other = await createExportKey({ passphrase: 'another passphrase!', argonOpts: LIGHT });
    const sealed = sealExport(FILE, key);
    let locked = 0;
    const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    const wrongSecret = await unlockExportKey({ key: other, passphrase: 'another passphrase!', argonOpts: LIGHT });
    const mk = (importFile) => withAssistantOps({ callSkill: async () => ({ ok: false }), threads: null, t: tt, admin: {
      exports: { names: async () => ['household-export-2026-10-01-0200.json'], read: async () => sealed },
      unlockedKey: async () => wrongSecret, lockKey: async () => { locked += 1; }, importFile,
    } });
    // not this key
    expect((await mk(async () => ({ ok: true, done: {} }))('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json' })).ok).toBe(false);
    expect(locked).toBe(1);
    // a preview leaves it open (the question needs it)
    await mk(async () => ({ ok: true, done: {} }))('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json', preview: true });
    expect(locked).toBe(1);
  });

  it('a key file that cannot be read makes the night write FAIL, never write plain', async () => {
    const { createExportShelf } = await import('../src/v2/householdExportShelf.js');
    const disk = new Map();
    const files = { list: async () => [...disk.keys()], write: async (n, t) => { disk.set(n, t); }, read: async (n) => disk.get(n), remove: async (n) => { disk.delete(n); } };
    const seen = [];
    const shelf = createExportShelf({ files, exportNow: async () => FILE,
      sealWith: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); }, onWritten: (e) => seen.push(e) });
    expect(await shelf.writeNow()).toBeNull();
    expect(disk.size).toBe(0);
    expect(seen[0]).toMatchObject({ ok: false });
  });

  it('a preview that refuses with a bare code is not shown: the declared question is asked', async () => {
    const { confirmPreview } = await import('../src/v2/confirmGate.js');
    const { mergeManifests } = await import('../src/manifestMerge.js');
    const { resolveDispatch } = await import('../src/router.js');
    const { listsManifest } = await import('../../lists/manifest.js');
    const cat = mergeManifests([{ manifest: listsManifest }]);
    const route = resolveDispatch({ kind: 'slash', opId: 'removeList', args: { list: 'x' } }, cat);
    expect(await confirmPreview({ route, catalogue: cat, call: async () => ({ ok: false, error: 'unwired' }) })).toBeNull();
  });
});
