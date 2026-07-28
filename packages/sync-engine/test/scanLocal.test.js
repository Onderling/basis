import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { scanLocal } from '../src/scanLocal.js';
import { PathMap }   from '../src/PathMap.js';

let root;

async function mkRoot() {
  return await fs.mkdtemp(join(tmpdir(), 'folio-scan-'));
}

beforeEach(async () => { root = await mkRoot(); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function pm() {
  return new PathMap({ localRoot: root, podRoot: 'https://x/notes/' });
}

function expectedSha(s) {
  return createHash('sha256').update(s).digest('hex');
}

describe('scanLocal', () => {
  it('returns empty for an empty dir', async () => {
    const out = await scanLocal(root, { pathMap: pm() });
    expect(out).toEqual([]);
  });

  it('returns empty for a non-existent root', async () => {
    const out = await scanLocal(join(root, 'does-not-exist'), { pathMap: pm() });
    expect(out).toEqual([]);
  });

  it('lists top-level files with deterministic sha256', async () => {
    await fs.writeFile(join(root, 'a.md'), 'hello');
    await fs.writeFile(join(root, 'b.md'), 'world');
    const out = await scanLocal(root, { pathMap: pm() });
    expect(out).toHaveLength(2);
    const a = out.find((f) => f.relPath === 'a.md');
    const b = out.find((f) => f.relPath === 'b.md');
    expect(a.sha256).toBe(expectedSha('hello'));
    expect(b.sha256).toBe(expectedSha('world'));
    expect(a.size).toBe(5);
    expect(typeof a.mtimeMs).toBe('number');
    expect(a.absPath.endsWith(`a.md`)).toBe(true);
  });

  it('descends into nested subdirs', async () => {
    await fs.mkdir(join(root, 'recipes', 'desserts'), { recursive: true });
    await fs.writeFile(join(root, 'recipes', 'desserts', 'cake.md'), 'cake');
    await fs.writeFile(join(root, 'top.md'), 'top');
    const out = await scanLocal(root, { pathMap: pm() });
    const rels = out.map((f) => f.relPath).sort();
    expect(rels).toEqual(['recipes/desserts/cake.md', 'top.md']);
  });

  it('skips dotfiles and .onderling/', async () => {
    await fs.writeFile(join(root, '.hidden'), 'x');
    await fs.writeFile(join(root, 'visible.md'), 'y');
    await fs.mkdir(join(root, '.onderling'), { recursive: true });
    await fs.writeFile(join(root, '.onderling', 'state.json'), '{}');
    const out = await scanLocal(root, { pathMap: pm() });
    const rels = out.map((f) => f.relPath);
    expect(rels).toEqual(['visible.md']);
  });

  it('uses POSIX-style relPath even on platforms that use backslash separators', async () => {
    await fs.mkdir(join(root, 'a', 'b'), { recursive: true });
    await fs.writeFile(join(root, 'a', 'b', 'c.md'), 'cc');
    const out = await scanLocal(root, { pathMap: pm() });
    expect(out[0].relPath).toBe('a/b/c.md');
  });
});
