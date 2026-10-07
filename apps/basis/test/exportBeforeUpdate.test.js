/**
 * The export before an update: the box's updater asks the RUNNING assistant for a fresh export of the household (a
 * request file in its exports dir; `bin/export-now.mjs` drops it and waits). The runner's tick job answers it through
 * the export shelf, under a name that says when and which version it was made by. Those files rotate on their own, so
 * a run of updates never pushes the nightly files off the shelf, nor the other way round.
 */
import { describe, it, expect } from 'vitest';
import { createExportShelf, isExportName } from '../src/v2/householdExportShelf.js';
import { createExportRequestJob, requestExportNow, EXPORT_REQUEST_FILE, EXPORT_ANSWER_FILE } from '../src/v2/exportRequest.js';

function memFiles() {
  const m = new Map();
  return {
    m,
    list: async () => [...m.keys()],
    write: async (n, t) => { m.set(n, t); },
    read: async (n) => { if (!m.has(n)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(n); },
    remove: async (n) => { m.delete(n); },
  };
}
const household = { people: [{ id: 'p1' }], lists: [], loose: [] };

describe('the export before an update', () => {
  it('a request is answered with a fresh export named by its time and the outgoing version; the request is cleared', async () => {
    const files = memFiles();
    let at = Date.parse('2026-10-07T13:00:00Z');
    const shelf = createExportShelf({ files, exportNow: async () => household, now: () => at });
    const job = createExportRequestJob({ files, shelf });
    await job.run();
    expect([...files.m.keys()]).toEqual([]);   // nothing asked, nothing written
    await files.write(EXPORT_REQUEST_FILE, JSON.stringify({ id: 'r1', sha: '0123456789abcdef0123' }));
    await job.run();
    const answer = JSON.parse(await files.read(EXPORT_ANSWER_FILE));
    expect(answer).toMatchObject({ id: 'r1', ok: true });
    expect(answer.name).toMatch(/^pre-update-\d{4}-\d{2}-\d{2}-\d{4}-0123456789ab\.json$/);
    expect(isExportName(answer.name), 'an /import can read it like any export').toBe(true);
    expect(JSON.parse(await files.read(answer.name)).people).toEqual([{ id: 'p1' }]);
    expect(files.m.has(EXPORT_REQUEST_FILE)).toBe(false);
  });

  it('the asking side waits for its own answer, and says so when none comes', async () => {
    const files = memFiles();
    const shelf = createExportShelf({ files, exportNow: async () => household });
    const job = createExportRequestJob({ files, shelf });
    // the runner answers between two looks
    const sleep = async () => { await job.run(); };
    const ok = await requestExportNow({ files, sha: 'abc1234', timeoutMs: 5000, pollMs: 1, sleep });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.name).toMatch(/-abc1234\.json$/);
    // no runner: a timeout, and the request is taken back
    const none = await requestExportNow({ files: memFiles(), sha: 'abc1234', timeoutMs: 20, pollMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    expect(none).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('a failed export is answered as failed, never as a file', async () => {
    const files = memFiles();
    const shelf = createExportShelf({ files, exportNow: async () => { throw new Error('store unreadable'); } });
    const job = createExportRequestJob({ files, shelf });
    await files.write(EXPORT_REQUEST_FILE, JSON.stringify({ id: 'r2', sha: 'abc1234' }));
    await job.run();
    expect(JSON.parse(await files.read(EXPORT_ANSWER_FILE))).toMatchObject({ id: 'r2', ok: false });
  });

  it('pre-update files keep the last three of their own; the nightly files keep theirs', async () => {
    const files = memFiles();
    let at = Date.parse('2026-10-01T03:00:00Z');
    const shelf = createExportShelf({ files, exportNow: async () => household, now: () => at, keep: 2 });
    await shelf.writeNow(); at += 86_400_000; await shelf.writeNow();
    for (let i = 0; i < 5; i += 1) { at += 60_000; await shelf.writeNow({ preUpdateSha: `sha${i}aaaa` }); }
    const names = await shelf.names();
    expect(names.filter((n) => n.startsWith('household-export-'))).toHaveLength(2);
    expect(names.filter((n) => n.startsWith('pre-update-')).map((n) => n.match(/-(sha\daaaa)\.json$/)[1])).toEqual(['sha4aaaa', 'sha3aaaa', 'sha2aaaa']);
  });
});
