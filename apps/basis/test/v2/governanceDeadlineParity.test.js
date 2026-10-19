/**
 * A vote with a closing deadline says so on both shells. The web panel did; the phone did not, though its header
 * comment said it did. Source pins: the RN screen cannot render under vitest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('governance: the deadline line, web ≡ mobile', () => {
  for (const [shell, rel] of [['web', '../../web/v2/circleGovernancePanel.js'], ['mobile', '../../../basis-mobile/src/screens/v2/CircleGovernanceScreen.js']]) {
    it(`${shell}: a row with a deadline shows the shared words`, () => {
      const src = read(rel);
      expect(src).toMatch(/row\.deadline != null/);
      expect(src).toMatch(/t[r]?\('circle\.governance\.deadline'\)/);
    });
  }
});
