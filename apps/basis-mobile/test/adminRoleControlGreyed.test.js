/**
 * The phone paints a role change that cannot stand (the last admin, alone in the circle) greyed with its reason, as the
 * web panel does — the shared decision (`roleControlFor`) says `disabled` and `reasonKey`; the screen must honour both.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCREEN = fileURLToPath(new URL('../src/screens/v2/CircleAdminPanelScreen.js', import.meta.url));

describe('the admin panel on the phone: a step-back that cannot stand is greyed', () => {
  it('the role control is disabled by the shared decision and says why', () => {
    const src = readFileSync(SCREEN, 'utf8');
    const at = src.indexOf('testID={`admin-role-');
    expect(at, 'the role control is on the screen').toBeGreaterThan(0);
    const tag = src.slice(src.lastIndexOf('<Pressable', at), at);
    expect(tag).toMatch(/disabled=\{control\.disabled\}/);
    expect(tag).toMatch(/accessibilityHint=\{control\.reasonKey \? t\(control\.reasonKey\)/);
  });
});
