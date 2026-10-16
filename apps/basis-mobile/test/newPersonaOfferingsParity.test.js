/**
 * The new-persona form asks "what you offer — also as <name>?" on both shells, unticked, and both make the persona
 * through the shared `newPersonaArgs` (only a yes is said; the agents core gives a new persona the no).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the new-persona offerings question — parity', () => {
  it('both forms ask it, unticked, with the shared key', () => {
    const web = code(read('../../basis/web/v2/circleMij.js'));
    const mobile = code(read('../src/screens/v2/CircleMijScreen.js'));
    for (const src of [web, mobile]) expect(src).toMatch(/circle\.mij\.new_persona_offerings/);
    expect(web).toMatch(/offer\.checked = false/);
    expect(mobile).toMatch(/takeOfferings === true/);
  });
  it('both make the persona through the shared args', () => {
    expect(code(read('../../basis/web/v2/circleApp.js'))).toMatch(/createProfile', newPersonaArgs\(/);
    expect(code(read('../src/core/mijHost.js'))).toMatch(/createProfile', newPersonaArgs\(/);
  });
});
