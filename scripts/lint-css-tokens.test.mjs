import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { definedTokens, usedTokens } from './lint-css-tokens.mjs';

describe('lint-css-tokens', () => {
  it('reads what a stylesheet defines and what a source uses', () => {
    expect([...definedTokens(':root { --card: #fff; --ink:#000 }')]).toEqual(['--card', '--ink']);
    expect(usedTokens("a\nb.style.cssText = 'background:var(--surface,#fff)';").map((u) => [u.token, u.line])).toEqual([['--surface', 2]]);
  });
  it('passes on the repo as it stands', () => {
    const r = spawnSync(process.execPath, ['scripts/lint-css-tokens.mjs'], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
