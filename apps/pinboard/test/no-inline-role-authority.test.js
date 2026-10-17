/**
 * Guard (roles-authority reconciliation): pinboard skills must NOT gate
 * authority with inline role-string comparisons like
 * `role === 'admin' || role === 'coordinator'`. Those hand-reimplement the
 * canonical rank table and drift (and can't see custom roles). The single
 * canonical path is `@onderling/core` (`Roles.js`): the local `isCircleAdmin`
 * helper delegates to `roleRank(role) >= roleRank('coordinator')`.
 *
 * This test fails if any inline role-authority comparison reappears in the
 * skills source, and asserts the canonical helper + core import are present.
 * Mirrors packages/relay/test/no-duplicate-rank-table.test.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/skills/index.js', import.meta.url));

/** Strip block and line comments so doc-comment prose can legitimately
 *  mention the old pattern without tripping the scan. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (leave e.g. http://)
}

describe('no inline role-string authority gates in pinboard skills', () => {
  const code = stripComments(readFileSync(SRC, 'utf8'));

  it('holds no `role === \'<standardRole>\'` authority comparison', () => {
    // Matches `x.role === 'admin'`, `me?.role === 'coordinator'`, `r === 'member'`,
    // etc. — a role-valued expression compared against a standard role literal.
    const inlineRoleCompare =
      /===\s*['"](admin|coordinator|member|observer|external)['"]/;
    expect(code).not.toMatch(inlineRoleCompare);
  });

  it('sources authority from the canonical core helper', () => {
    // Imports the canonical rank fn from core and gates via the local helper.
    expect(code).toMatch(/from '@onderling\/core'/);
    expect(code).toMatch(/roleRank/);
    expect(code).toMatch(/isCircleAdmin\(/);
  });
});
