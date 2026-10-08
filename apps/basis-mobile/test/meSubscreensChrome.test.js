/**
 * The screens under Me: a way back, clear of the status bar, saying where back goes — and the developer tool hidden.
 *
 * Walked on a real phone (2026-10-08): every screen under Me drew its title and back link under the status bar (where
 * the system takes the touch); Availability and Advanced had no back link at all; Shared with me and Blocked said
 * "← circles" although they open from Me; Availability's times were painted in the default dark text on a dark field;
 * and Advanced — raw parameter keys and raw values, a developer tool — was offered to every person.
 * `src/screens/**` cannot be rendered under vitest, so the paint is pinned as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASIS_USER_PARAMS, DEVELOPER_PARAM_KEY } from '../../basis/src/v2/paramsService.js';

const read = (name) => readFileSync(fileURLToPath(new URL(`../src/screens/v2/${name}`, import.meta.url)), 'utf8');
const SUBSCREENS = ['ShareMyContactScreen.js', 'CircleAvailabilityScreen.js', 'SharedWithMeScreen.js', 'CircleBlockedScreen.js', 'CircleAdvancedScreen.js'];

describe('the screens under Me', () => {
  for (const name of SUBSCREENS) {
    it(`${name}: clears the status bar and says "← Me"`, () => {
      const src = read(name);
      expect(src).toMatch(/useSafeAreaInsets\(\)/);
      expect(src).toMatch(/insets\?\.top/);
      expect(src).toMatch(/t\('circle\.back_me'\)/);
      expect(src).not.toMatch(/t\('circle\.back'\)/);
    });
  }

  it('Advanced has a back link, and the launcher hands Availability and Advanced their way back', () => {
    expect(read('CircleAdvancedScreen.js')).toMatch(/onBack/);
    const launcher = read('CircleLauncherScreen.js');
    expect(launcher).toMatch(/<CircleAdvancedScreen[^>]*onBack=\{\(\) => setView\('profile'\)\}/);
    expect(launcher).toMatch(/<CircleAvailabilityScreen\s+store=\{availabilityStore\}\s+onBack=\{\(\) => setView\('profile'\)\}/);
  });

  it('Availability paints its field text in ink, and its placeholders in the soft ink', () => {
    const src = read('CircleAvailabilityScreen.js');
    expect(src).toMatch(/input:\s*\{[^}]*color: theme\.color\.ink/);
    expect(src.match(/placeholderTextColor=\{theme\.color\.inkSoft\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('the developer switch', () => {
  it('is a register param, off by default, settable (kind user)', () => {
    const p = BASIS_USER_PARAMS.find((x) => x.key === DEVELOPER_PARAM_KEY);
    expect(p).toMatchObject({ key: 'app.developer', kind: 'user', default: false });
  });

  it('Advanced is offered on Me only when it is on (mobile and web)', () => {
    expect(read('CircleLauncherScreen.js')).toMatch(/onAdvanced=\{developerOn \? \(\) => setView\('advanced'\) : undefined\}/);
    const web = readFileSync(fileURLToPath(new URL('../../basis/web/v2/circleApp.js', import.meta.url)), 'utf8');
    expect(web).toMatch(/onAdvanced: developer \? showAdvanced : undefined/);
  });
});
