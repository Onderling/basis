/**
 * The phone's profile form keeps a name typed while the profile loads, as the web form does: its load sets each field
 * through the shared `fieldAfterLoad`, never straight to the loaded value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/screens/v2/ProfileBasics.js', import.meta.url)), 'utf8');

describe('the phone profile form: a load never wipes what was typed', () => {
  it('sets the handle and the name through fieldAfterLoad', () => {
    expect(src).toMatch(/setHandle\(\(cur\) => fieldAfterLoad\(/);
    expect(src).toMatch(/setDisplay\(\(cur\) => fieldAfterLoad\(/);
    expect(src).not.toMatch(/setDisplay\(entry\.displayName/);
  });
});
