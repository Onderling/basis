/**
 * THE COMPANION'S HELD MESSAGES ARE NEVER WRITTEN OVER WHEN THE INBOX FILE CANNOT BE READ.
 *
 * The file store read anything it could not parse as an empty inbox. The next deposit then wrote a file holding only
 * that one message, and a drain listed nothing and cleared — every message held for every owner while their device
 * was away, gone. Now a file that is there but does not parse (or is not an object) is never written over: reads and
 * writes are refused with INBOX_NOT_READABLE (a deposit fails, so the sender keeps its copy), and the store says why
 * at start (`notReadable()`). A missing file is an empty inbox, as before.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSealedInboxStore } from '../src/sealedInbox.js';

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const fileWith = (raw) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inbox-')); dirs.push(dir);
  const p = path.join(dir, 'sealed-inbox.json');
  if (raw != null) writeFileSync(p, raw);
  return p;
};

describe('the companion inbox keeps a file it cannot read', () => {
  for (const [what, raw, reason] of [['a torn file', '{"owner-a":[{"id":"m1","sealed":"x"}', 'unparseable'], ['an array', '[1,2]', 'shape']]) {
    it(`${what}: a deposit and a drain are refused, the file stays, and the reason is said`, async () => {
      const p = fileWith(raw);
      const store = new FileSealedInboxStore(p);
      expect(store.notReadable()).toBe(reason);
      await expect(store.append('owner-b', { id: 'm2', sealed: 'y' })).rejects.toMatchObject({ code: 'INBOX_NOT_READABLE' });
      await expect(store.list('owner-a')).rejects.toMatchObject({ code: 'INBOX_NOT_READABLE' });
      await expect(store.clear('owner-a')).rejects.toMatchObject({ code: 'INBOX_NOT_READABLE' });
      expect(readFileSync(p, 'utf8')).toBe(raw);
    });
  }

  it('a missing file is an empty inbox, and saves as before', async () => {
    const p = fileWith(null);
    const store = new FileSealedInboxStore(p);
    expect(store.notReadable()).toBeNull();
    await store.append('owner-a', { id: 'm1', sealed: 'x' });
    expect(await store.list('owner-a')).toHaveLength(1);
  });
});
