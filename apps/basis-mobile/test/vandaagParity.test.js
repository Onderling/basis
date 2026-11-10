/**
 * Vandaag and its customise sheet on the phone (web twin: apps/basis/test/v2/vandaagSweep.dom.test.js): the trigger
 * says "Aanpassen" rather than a bare ⋯, Done sits above the scroll, "Remove" is neutral, every control shows its
 * heading, the chosen chip is filled, the onboarding card's "Begrepen" is a text link and the strip has no "meer", an
 * empty block is plain text, and the header avatar is named "Profiel" and kept off the Me card. RN cannot render under
 * Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HEADER_AVATAR, HEADER_AVATAR_CLEARANCE } from '../src/screens/v2/fab.js';

const read = (f) => readFileSync(resolve(__dirname, `../src/screens/v2/${f}`), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const launcher = read('CircleLauncherScreen.js');
const sheet = read('VandaagCustomiseModal.js');
const view = read('CircleScreenView.js');
const profile = read('CircleProfileScreen.js');

describe('Vandaag on the phone', () => {
  it('the customise trigger is the word, not ⋯', () => {
    expect(launcher).toMatch(/: t\('circle\.vandaag\.customise'\)\}/);
    expect(launcher).not.toMatch(/: '⋯'\}/);
  });
  it('the sheet: Done above the scroll, Remove neutral, headings, a filled chosen chip', () => {
    expect(sheet.indexOf('testID="customise-done"')).toBeLessThan(sheet.indexOf('<ScrollView'));
    expect(sheet).not.toMatch(/variant="danger" label=\{t\('circle\.vandaag\.remove'\)\}/);
    expect((sheet.match(/\{t\(c\.titleKey\)\}/g) ?? []).length).toBe(3);
    expect(sheet).toMatch(/chipOn: \{[^}]*backgroundColor/);
  });
  it('the onboarding card: Begrepen a text link; no "meer" under the strip; an empty block no grey box', () => {
    expect(view).toMatch(/onboarding_intro_dismiss" a=\{\{ kind: 'intro-seen' \}\} variant="ghost"/);
    expect(view).toMatch(/typeof onMore === 'function' && blockOpensWhole\(block\)/);
    expect(view).not.toMatch(/blockEmpty: *\{ backgroundColor: theme\.color\.paper2/);
  });
  it('the header avatar: named Profiel, and Me starts below it', () => {
    expect(launcher).toMatch(/accessibilityLabel=\{t\('circle\.profile\.avatar_label'\)\} testID="header-avatar"/);
    expect(HEADER_AVATAR_CLEARANCE).toBeGreaterThan(HEADER_AVATAR.top + HEADER_AVATAR.size);
    expect(profile).toMatch(/paddingTop: HEADER_AVATAR_CLEARANCE/);
  });
});

describe('"Nieuw voor jou" on the phone (web twin: walk-for-you.spec.js)', () => {
  const web = readFileSync(resolve(__dirname, '../../basis/web/v2/circleApp.js'), 'utf8');
  it('the painter, its two acts, and the launcher asking for it with the turns and the window', () => {
    expect(view).toMatch(/case 'forYou':\s+body = renderForYou\(/);
    expect(view).toMatch(/kind: 'for-you-open', row/);
    expect(view).toMatch(/kind: 'for-you-read', rows: \[row\]/);
    expect(view).toMatch(/kind: 'for-you-read', rows: items/);
    expect(launcher).toMatch(/\.\.\.forYouHostOpsNow\(\),\s*forYou: true/);
    expect(launcher).toMatch(/t, turns: forYouRef\.current\.turns/);
    // the banner reads the same rows on both shells (the shared driver; each shell only paints)
    expect(launcher).toMatch(/createBannerDriver\(\{\s*readRows: \(\) => forYouRows\(forYouHostOpsNow\(\), \{ fold: false \}\)/);
    expect(web).toMatch(/createBannerDriver\(\{\s*readRows: \(\) => forYouRows\(forYouHostOps\(\), \{ fold: false \}\)/);
    expect(launcher).toMatch(/a\?\.kind === 'for-you-open'/);
    expect(launcher).toMatch(/a\?\.kind === 'for-you-read'.*readMarks\.markRows/);
    // the same acts on web
    expect(web).toMatch(/action\?\.kind === 'for-you-open'/);
    expect(web).toMatch(/action\?\.kind === 'for-you-read'/);
  });
});
