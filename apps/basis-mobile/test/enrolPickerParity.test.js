/**
 * The enrol picker — web ≡ mobile, from ONE model (`enrollOffer.js`): both shells paint the rows `pickerRows` gives,
 * toggle through `togglePick` (the last-self refusal lives there), say "Dit apparaat spreekt als …" from `pickPrimary`,
 * and hand the ceremony `enrolPickArgs`. Neither keeps a Set of its own. RN cannot render under Vitest, so this reads
 * the sources, as the other parity tests here do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the enrol picker — parity', () => {
  const web = code(read('../../basis/web/v2/circleApp.js'));
  const mobile = code(read('../src/screens/v2/EnrollDeviceModal.js'));
  it('both paint the shared rows, toggle through the shared rule and hand the shared args', () => {
    for (const src of [web, mobile]) {
      for (const fn of ['pickerRows(', 'togglePick(', 'pickPrimary(', 'enrolPickArgs(']) expect(src, fn).toContain(fn);
      expect(src).toContain("'circle.enroll.speaks_as'");
      expect(src).toContain("'circle.enroll.last_self'");
    }
  });
  it('neither keeps its own pick set', () => {
    expect(mobile).not.toMatch(/new Set\(Array\.isArray\(d\[ENROL_PERSONAS_PARAM\]\)/);
    expect(web).not.toMatch(/const picked = new Set\(values\[ENROL_PERSONAS_PARAM\]/);
  });
});
