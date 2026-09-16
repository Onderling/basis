/**
 * The "sealed to the person" mark (web ≡ mobile) — a direct-message thread's header says what a message to this
 * contact is sealed to, on BOTH shells, from ONE source: the agent's own seal resolution (`contactSeal.statusFor`)
 * projected by the shared `contactSealMark` onto one of two shared locale keys. A shell that decides the level
 * itself, or names a key of its own, is the drift this test exists for (2026-09-16).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('contact seal mark parity', () => {
  const webHost      = read('../../basis/web/v2/circleApp.js');
  const webThread    = read('../../basis/web/v2/contactThread.js');
  const mobileThread = read('../src/screens/v2/ContactThreadScreen.js');

  it('both shells ask the agent what the thread is sealed to, and project it through the shared mark', () => {
    for (const src of [webHost, mobileThread]) {
      expect(src).toMatch(/contactSeal\??\.statusFor/);
      expect(src).toMatch(/from '\.\.\/\.\.\/src\/v2\/contactSealMark\.js'|from '@onderling\/basis\/src\/v2\/contactSealMark\.js'|src\/v2\/contactSealMark\.js'/);
      expect(src).toMatch(/contactSealMark\(/);
    }
  });
  it('neither shell names the locale keys itself — the mark does', () => {
    for (const src of [webHost, webThread, mobileThread]) {
      expect(src).not.toMatch(/circle\.contacts\.sealed_(person|device)/);
    }
  });
  it('both thread views paint the mark in the header with its level, and paint nothing before it is decided', () => {
    expect(webThread).toMatch(/cc-cthread__sealed/);
    expect(webThread).toMatch(/sealed\.level/);
    expect(mobileThread).toMatch(/testID="contact-thread-sealed"/);
    expect(mobileThread).toMatch(/sealedMark\s*\?/);
  });
});
