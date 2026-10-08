/**
 * Circle settings and the admin panel clear the status bar.
 *
 * Both screens started at the very top, so their back link sat under the status bar — and the system takes a touch
 * there: on a real phone "← circles" in Circle settings could not be tapped at all (found 2026-10-08; Android Back
 * still worked). Both now take the safe-area top inset, as the launcher, Contacts and the contact thread do.
 * `src/screens/**` cannot be rendered under vitest, so the paint is pinned as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../src/screens/v2/${name}`, import.meta.url)), 'utf8');

describe('the status bar', () => {
  for (const name of ['CircleSettingsScreen.js', 'CircleAdminPanelScreen.js']) {
    it(`${name} pads its top by the safe-area inset`, () => {
      const src = read(name);
      expect(src).toMatch(/useSafeAreaInsets\(\)/);
      expect(src).toMatch(/paddingTop:[^,}]*insets\?\.top/);
    });
  }
});
