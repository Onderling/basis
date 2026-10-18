/**
 * FITNESS: the shape log of unrouted frames is for TESTING only (Frits 2026-10-18: "privacy is important for the final
 * product"). It is switched by an environment variable, and no release config — the deploy files, the box roles, the
 * compose files and their env templates — sets it.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(__dirname, '../../../..');
const FLAG = ['ONDERLING', 'WALK', 'SHAPES'].join('_');

describe('the shape log stays out of releases', () => {
  it('no deploy file sets the flag', () => {
    let hits = '';
    try { hits = execSync(`git grep -I -n -e ${FLAG} -- deploy .github 'apps/*/Dockerfile*' '**/*.env*' '**/docker-compose*'`, { cwd: repo, encoding: 'utf8' }); }
    catch (err) { if (err.status !== 1) throw err; }
    expect(hits.trim().split('\n').filter(Boolean)).toEqual([]);
  });
  it('the runner logs key names only, and only with the flag', () => {
    const src = readFileSync(path.join(repo, 'apps/basis/bin/device-runner.mjs'), 'utf8');
    expect(src).toContain(`process.env.${FLAG} === '1'`);
    expect(src).toMatch(/keys: frameKeyNames\(payload\)/);
  });
});
