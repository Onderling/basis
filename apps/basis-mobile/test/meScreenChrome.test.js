/**
 * The Me screen and the member card, as a phone walk found them (2026-10-08):
 *   - Handle / Display name sat EMPTY for seconds after opening Me, editable, with Save live — what someone typed
 *     there was overwritten when the profile landed. The fields and Save now wait for the profile's answer.
 *   - The "Me" title (and everything scrolled) drew under the status bar.
 *   - The member card — a sheet over the Members tab — said "← circles" but only closed the sheet.
 *   - The two pointers into personas are links, yet were painted as italic footnotes.
 *
 * `src/screens/**` cannot be rendered under vitest, so this pins the WIRING as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ME = read('../src/screens/v2/CircleProfileScreen.js');
const CARD = read('../src/screens/v2/CircleMemberCardScreen.js');
const en = JSON.parse(read('../../basis/src/locales/circle.en.json'));
const nl = JSON.parse(read('../../basis/src/locales/circle.nl.json'));

describe('Me — the identity fields wait for the profile', () => {
  it('the profile is marked loaded only on an answer from getMyProfile', () => {
    expect(ME).toMatch(/const \[profileLoaded, setProfileLoaded\] = useState\(false\)/);
    expect(ME).toMatch(/if \(prof\) setProfileLoaded\(true\)/);
  });
  it('both fields are editable only once loaded', () => {
    expect(ME).toMatch(/testID="profile-handle"/);
    expect((ME.match(/editable=\{profileLoaded\}/g) ?? []).length).toBe(2);
  });
  it('Save is disabled until loaded (and while saving)', () => {
    expect(ME).toMatch(/disabled=\{!profileLoaded \|\| busy\}/);
  });
});

describe('Me — clears the status bar', () => {
  it('pads its top by the safe-area inset', () => {
    expect(ME).toMatch(/useSafeAreaInsets\(\)/);
    expect(ME).toMatch(/paddingTop: insets\?\.top/);
  });
});

describe('Me — the persona pointers read as links', () => {
  it('are not italic footnotes', () => {
    const style = ME.match(/offeringsMoved: \{[^}]*\}/)?.[0] ?? '';
    expect(style).not.toMatch(/italic/);
    expect(style).toMatch(/textDecorationLine: 'underline'/);
  });
});

describe('the member card closes, it does not claim to go to the circles', () => {
  it('uses the close label, in both languages', () => {
    expect(CARD).toMatch(/t\('circle\.membercard_close'\)/);
    expect(CARD).not.toMatch(/t\('circle\.back'\)/);
    expect(en.membercard_close?.text).toBe('Close');
    expect(nl.membercard_close?.text).toBe('Sluiten');
  });
});
