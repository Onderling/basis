/** The version line both shells paint: the tag, or the dev word — and both shells paint it. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { versionLine } from '../../src/v2/versionLine.js';

const t = (k, p) => (p ? `${k}|${JSON.stringify(p)}` : k);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('versionLine', () => {
  it('a tag says the tag; none or empty says the dev word', () => {
    expect(versionLine('v0.1.70-alpha', t)).toBe('circle.profile.version|{"tag":"v0.1.70-alpha"}');
    expect(versionLine(null, t)).toBe('circle.profile.version|{"tag":"circle.profile.version_dev"}');
    expect(versionLine('', t)).toBe('circle.profile.version|{"tag":"circle.profile.version_dev"}');
  });
  it('both shells paint it in My data, the phone from its build\'s extra.appVersion', () => {
    expect(read('../../web/v2/circleMyData.js')).toMatch(/versionLine\(version, tr\)/);
    const mob = read('../../../basis-mobile/src/screens/v2/CircleMyDataScreen.js');
    expect(mob).toMatch(/versionLine\(/);
    expect(mob).toMatch(/expoConfig\?\.extra\?\.appVersion/);
  });
});
