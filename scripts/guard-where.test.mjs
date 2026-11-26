import { describe, it, expect } from 'vitest';
import { lineAt, linesMatching, lineOf, whereIn, whereInSelf, manifestFileByApp, MANIFEST_LIST } from './guard-where.mjs';

describe('guard-where', () => {
  it('turns an index, a pattern or a needle into 1-based lines', () => {
    const t = 'a\nbb x\nc x x\n';
    expect(lineAt(t, 0)).toBe(1);
    expect(lineAt(t, t.indexOf('c'))).toBe(3);
    expect(linesMatching(t, /x/g)).toEqual([2, 3]);
    expect(lineOf(t, 'c x')).toBe(3);
    expect(lineOf(t, 'none')).toBe(1);
  });
  it('names a repo file or the guard itself as file:line', () => {
    expect(whereIn('scripts/guard-where.mjs', 'export function lineAt')).toMatch(/^scripts\/guard-where\.mjs:\d+$/);
    expect(whereIn('no/such/file.js', 'x')).toBe('no/such/file.js:1');
    expect(whereInSelf(import.meta.url, "describe('guard-where'")).toBe('scripts/guard-where.test.mjs:4');
  });
  it('names the file that declares each loaded manifest, a re-export included', async () => {
    const { allManifests } = await import('../apps/basis/src/v2/manifestSources.js');
    const files = await manifestFileByApp(allManifests());
    expect(files.lists).toBe('apps/lists/manifest.js');
    expect(files.tasks).toBe('apps/tasks-v0/manifest.js');          // re-exported by mockManifests.js as mockTasksManifest
    expect(files.params).toBe('apps/basis/src/v2/paramsManifest.js');
    expect(files['chat-lane']).toBe('apps/basis/src/v2/chatManifest.js');
    expect(Object.values(files)).not.toContain(MANIFEST_LIST);       // every manifest the app runs is found in its own file
    expect(await manifestFileByApp([{ app: 'ghost', operations: [] }])).toEqual({ ghost: MANIFEST_LIST });
  });
});
