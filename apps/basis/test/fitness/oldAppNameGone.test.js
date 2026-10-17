/**
 * FITNESS: the old app name is gone — from code, ids, paths, docs and words alike. The circles-and-contacts board is
 * `pinboard` (its Dutch word "prikbord"); the old name anywhere in a tracked text file is the old name creeping back.
 * Not a comment-only check (the codename lint): the name was an identifier, an op id prefix and a pod path, so the
 * whole tracked tree is scanned. No allowed site.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(__dirname, '../../../..');
// the name, split so this file does not name it
const OLD = ['st', 'oop'].join('');

describe('the old app name', () => {
  it('appears in no tracked text file, nor in any tracked path', () => {
    let hits = '';
    try { hits = execSync(`git grep -I -n -i -e ${OLD}`, { cwd: repo, encoding: 'utf8' }); }
    catch (err) { if (err.status !== 1) throw err; }
    expect(hits.trim().split('\n').filter(Boolean).slice(0, 20)).toEqual([]);
    const paths = execSync('git ls-files', { cwd: repo, encoding: 'utf8' }).split('\n').filter((f) => f.toLowerCase().includes(OLD));
    expect(paths).toEqual([]);
  });
});
