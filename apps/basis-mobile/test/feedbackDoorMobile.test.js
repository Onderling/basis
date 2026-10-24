/**
 * The feedback door on the phone (web parity: circleApp's createLocalBuiltins): the op's seams are composed — the
 * thread opener, the build's card, its version, the screen named — the thread starts with the draft in its composer,
 * the settings home paints the foot doors, and the "+" sheet hands a field-less act to the host to run at once.
 * Mobile screens cannot render under vitest, so these read the sources.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the feedback door on mobile', () => {
  it('the launcher hands the builtins the four seams, and opens the contact\'s thread with the draft', () => {
    const launcher = read('../src/screens/v2/CircleLauncherScreen.js');
    expect(launcher).toMatch(/openFeedback: \(\{ webid, draft \}\) => \{ openFeedbackThread\(webid, draft\)/);
    expect(launcher).toMatch(/feedbackCard: process\.env\.EXPO_PUBLIC_SEEDED_CONTACT_CARD/);
    expect(launcher).toMatch(/appVersion: Constants\.expoConfig\?\.extra\?\.appVersion/);
    expect(launcher).toMatch(/draft=\{contactThread\?\.draft \?\? ''\}/);
    expect(read('../src/core/hostOps.js')).toMatch(/openFeedback, feedbackCard, appVersion, currentScreen,/);
    expect(read('../src/screens/v2/ContactThreadScreen.js')).toMatch(/useState\(typeof draft === 'string' \? draft : ''\)/);
  });
  it('the settings home paints the foot doors; the "+" runs a field-less act through the host', () => {
    expect(read('../src/screens/v2/SettingsHomeScreen.js')).toMatch(/doors\.map\(\(d\) => <Door/);
    expect(read('../src/screens/v2/VandaagPlusModal.js')).toMatch(/actRunsAtOnce\(a\) && typeof onRunAct === 'function' \? onRunAct\(a\)/);
  });
});
