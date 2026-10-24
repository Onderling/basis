/**
 * Mobile Contacten paints the help bot as a contact the same way web does — by construction, through the shared
 * `withHelpContact` / `contactOpenTarget` / `tileCircles` (mobile screens cannot render under vitest, so these pin
 * the source; the projection itself is tested in apps/basis).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const contacts = read('../src/screens/v2/ContactsScreen.js');
const launcher = read('../src/screens/v2/CircleLauncherScreen.js');

describe('mobile: the help bot is a contact', () => {
  it('Contacten adds the synthetic row through the shared projection, and fetches no face for it', () => {
    expect(contacts).toMatch(/withHelpContact\(kept, \{ t, available: helpAvailable \}\)/);
    expect(contacts).toMatch(/typeof resolvePictureFor === 'function' && !c\.synthetic \? resolvePictureFor\(c\)/);
  });

  it('the launcher routes a Contacten tap through contactOpenTarget and paints no help-circle tile', () => {
    expect(launcher).toMatch(/helpAvailable=\{circles\.some\(\(c\) => c\.id === HELP_CIRCLE_ID\)\}/);
    expect(launcher).toMatch(/const target = contactOpenTarget\(c\); if \(target\.kind === 'circle'\)/);
    expect(launcher).toMatch(/splitBySight\(tileCircles\(circlesShown\)/);
  });
});
