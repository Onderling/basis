/**
 * FITNESS: the shared blocks reach both shells through ONE seam, and nothing changed when they did.
 *
 * Both loaders used to name the shared blocks themselves — `{ ...appLocale, circle: …, consequence: …,
 * role: … }`, written out in `apps/basis/src/localisation.js` AND
 * `apps/basis-mobile/src/core/localisation.js`. Adding a shared block meant editing both, and
 * forgetting one dropped that block on one shell with nothing failing: the same silent-divergence
 * shape the shared directory exists to end, reintroduced one level up.
 *
 * They now spread `sharedLocale[lng]` and name nothing. These assertions are what makes that a
 * guarantee rather than a convention: the seam must carry EVERY block, and neither loader may go back
 * to naming them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  sharedLocale, sharedCircleLocale, sharedConsequenceLocale, sharedRoleLocale, sharedHostLocale,
} from '../../src/locales/index.js';

const ROOT = new URL('../../../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

describe('the shared locale seam', () => {
  it('carries exactly the blocks the named exports carry, in both languages', () => {
    // The old composition, written out. If a block is added to `sharedLocale` and NOT to this list the
    // test fails — which is the moment to ask whether it also wants a named export.
    for (const lng of ['en', 'nl']) {
      expect(sharedLocale[lng]).toEqual({
        circle: sharedCircleLocale[lng],
        consequence: sharedConsequenceLocale[lng],
        role: sharedRoleLocale[lng],
        // `host.*` spreads at the TOP level — its blocks keep their own names (`sync`, `me`, `mute`…),
        // so only the file holding them changed, not a single call site.
        ...sharedHostLocale[lng],
      });
    }
  });

  it('the host blocks land at the top level, keeping their own names', () => {
    // If these ever nested under a `host.` prefix, every call site would have to change — the whole
    // point of the move was that none did.
    for (const b of ['sync', 'mute', 'peer', 'relay', 'sendFile', 'threadsCmd']) {
      expect(sharedLocale.en, `${b} should be a top-level block`).toHaveProperty(b);
      expect(sharedLocale.nl).toHaveProperty(b);
    }
  });

  it('every block is present in BOTH languages (a one-language block is a half-shipped block)', () => {
    expect(Object.keys(sharedLocale.en).sort()).toEqual(Object.keys(sharedLocale.nl).sort());
    expect(Object.keys(sharedLocale.en).length).toBeGreaterThan(0);
  });

  it('neither loader names a shared block any more — they go through the seam', () => {
    for (const rel of ['apps/basis/src/localisation.js', 'apps/basis-mobile/src/core/localisation.js']) {
      const src = read(rel);
      expect(src, `${rel} should take the shared blocks through the seam`)
        .toMatch(/mergeShared\(\w+, sharedLocale(\.|\[)/);
      expect(src, `${rel} still names a block by hand — add it to src/locales/index.js instead`)
        .not.toMatch(/(circle|consequence|role):\s*shared\w+Locale/);
    }
  });

  it('the package re-exports the seam, which is how the mobile shell reaches it', () => {
    expect(read('apps/basis/src/index.js')).toMatch(/export \{[^}]*sharedLocale[^}]*\} from '\.\/locales\/index\.js'/);
  });
});
