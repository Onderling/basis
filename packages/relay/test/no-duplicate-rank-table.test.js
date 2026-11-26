// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * Guard (reconciliation): the role→rank table has ONE source of truth,
 * `@onderling/core` `STANDARD_RANKS`. The relay's GroupAuthVerifier used to
 * hand-copy the numbers ("mirrors Roles.js") — this test fails if any inline
 * rank literal reappears here, and asserts the verifier's ranks ARE core's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STANDARD_RANKS } from '@onderling/core';

const SRC = fileURLToPath(new URL('../src/GroupAuthVerifier.js', import.meta.url));

describe('single rank-table source of truth', () => {
  it('GroupAuthVerifier holds no inline rank literals (imports the canonical table)', () => {
    const src = readFileSync(SRC, 'utf8');
    // a hand-copied table pairs a role with its number, e.g. `coordinator:  80`
    const inlineRankLiteral = /\b(admin|coordinator|member|observer|external)\s*:\s*\d{2,3}\b/;
    expect(src).not.toMatch(inlineRankLiteral);
    expect(src).toMatch(/STANDARD_RANKS/); // it uses the canonical import
  });

  it('the canonical table still carries the five standard ranks', () => {
    expect(STANDARD_RANKS).toMatchObject({
      admin: 100, coordinator: 80, member: 60, observer: 40, external: 20,
    });
  });
});
