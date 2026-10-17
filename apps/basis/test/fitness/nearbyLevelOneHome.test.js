/**
 * FITNESS FUNCTION — what the Nearby room sees of a self has ONE home: the level on that self's disclosure under the
 * reserved context `nearby`. Two things keep it there:
 *
 *   1. the per-device face choice it replaced (`basis.nearbyFace` on web, `cc.nearbyFace` on mobile) is read nowhere —
 *      a shell reading it again would present a face the person's level does not allow;
 *   2. `nearby` cannot be a circle's or a pair's context: circle ids are a hash, pair ids carry their own prefix, so a
 *      circle's reveal can never land on (or read) the room's.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { deriveCircleId } from '@onderling/core';
import { pairCircleIdFor, PAIR_CIRCLE_PREFIX } from '../../src/v2/pairCircleId.js';
import { NEARBY_CONTEXT } from '../../src/v2/nearbyLevel.js';

const repo = path.resolve(__dirname, '../../../..');

describe('the Nearby level has one home', () => {
  it('the removed device-level face keys are read nowhere', () => {
    let hits = '';
    try {
      hits = execSync(
        "git grep -n -e 'basis.nearbyFace' -e 'cc.nearbyFace' -- 'apps/basis/src' 'apps/basis/web' 'apps/basis/bin' 'apps/basis-mobile/src' 'packages/*/src'",
        { cwd: repo, encoding: 'utf8' },
      );
    } catch (err) {
      if (err.status !== 1) throw err;   // 1 = no match, which is the pass
    }
    expect(hits.trim().split('\n').filter(Boolean)).toEqual([]);
  });

  it('`nearby` is neither a circle id nor a pair id', () => {
    const circle = deriveCircleId('founder-key', 'nonce');
    const pair = pairCircleIdFor('https://a.example/#me', 'https://b.example/#me');
    // positive controls: the shapes this test relies on are the shapes the minting actually produces
    expect(circle).toMatch(/^[0-9a-f]+$/);
    expect(pair.startsWith(PAIR_CIRCLE_PREFIX)).toBe(true);
    expect(/^[0-9a-f]+$/.test(NEARBY_CONTEXT)).toBe(false);
    expect(NEARBY_CONTEXT.startsWith(PAIR_CIRCLE_PREFIX)).toBe(false);
  });
});
