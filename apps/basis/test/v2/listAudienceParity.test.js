/**
 * A list section that declares an audience is filtered by it on BOTH shells, and says so (a caption that cannot be
 * dismissed). Web handed the shared model `defaultAudience: section.audience`; the phone handed nothing, so the first
 * audience-scoped view would have shown every row on the phone. Source pins: the RN screens cannot render under vitest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a list scoped to an audience — web ≡ mobile', () => {
  it('both hand the section\'s audience to the shared model', () => {
    expect(read('../../web/v2/circleApp.js')).toMatch(/defaultAudience: section\.audience/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js')).toMatch(/defaultAudience: section\.audience/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleListScreen.js')).toMatch(/const shared = \{[^}]*defaultAudience/);
  });
  it('both say so', () => {
    expect(read('../../web/v2/listScreen.js')).toMatch(/circle\.screen\.audience_scope/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleListScreen.js')).toMatch(/model\.audienceScope != null \? <Text[^>]*>\{t\('circle\.screen\.audience_scope'\)\}/);
  });
});
