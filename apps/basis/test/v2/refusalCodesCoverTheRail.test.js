/**
 * THE CLOSED SET COVERS THE RAIL. The refusal log writes only codes from its closed set; anything else becomes 'other'
 * with no detail. So a reason added to the statement check without its code would be logged as 'other', and the log
 * would stop saying why. This reads the statement check's own source and holds every reason it can return against the
 * set, in both directions: no reason without a code, no rail code without a reason.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refusalCode, REFUSAL_CODES, DOOR_REFUSAL_CODES } from '../../src/v2/refusalLog.js';

const SOURCE = fileURLToPath(new URL('../../../../packages/core/src/security/spineStatement.js', import.meta.url));

/** Every `reason: '…'` and `reason: `…`` literal in the statement check; a template's `${…}` part reads as a sample value. */
function reasonsInSource() {
  const text = readFileSync(SOURCE, 'utf8');
  const found = [];
  for (const m of text.matchAll(/reason:\s*(['`])((?:(?!\1).)*)\1/g)) found.push(m[2].replace(/\$\{[^}]*\}/g, 'sample'));
  return found;
}

// codes the set holds for refusals that do not come from the statement check's reason strings
const NOT_FROM_THE_STATEMENT_CHECK = new Set(['unverifiable', 'key-not-bound-to-its-member', 'not-allowed-by-the-circle-rule', 'no-sealing-key-pair', ...DOOR_REFUSAL_CODES]);

describe('the refusal codes cover the statement check', () => {
  const reasons = reasonsInSource();

  it('finds the reasons in the source (the reader itself works)', () => {
    expect(reasons.length).toBeGreaterThanOrEqual(15);
    expect(reasons).toContain('bad signature');
    expect(reasons).toContain('unsupported version: sample');
  });

  it('every reason the statement check returns has a code in the closed set', () => {
    const without = reasons.filter((r) => ['other', 'unknown'].includes(refusalCode(r).reason));
    expect(without).toEqual([]);
  });

  it('every statement-check code in the set is still returned by the statement check', () => {
    const returned = new Set(reasons.map((r) => refusalCode(r).reason));
    const stale = REFUSAL_CODES.filter((c) => !NOT_FROM_THE_STATEMENT_CHECK.has(c) && !returned.has(c));
    expect(stale).toEqual([]);
  });
});
