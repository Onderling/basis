/**
 * The first screen a new person sees says what Basis is in plain words: "Basis" capitalised, no "neighbourhood chat",
 * no "Solid pod" — the same three lines Vandaag's first card says (encrypted, no account, what a circle is), one source.
 * RN cannot render under Vitest, so this reads the source and the locale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../src/screens/FirstRunWelcomeScreen.js'), 'utf8');
const loc = (l) => JSON.parse(readFileSync(resolve(__dirname, `../../basis/src/locales/circle.${l}.json`), 'utf8'));
const textOf = (d, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => o?.[k], d)?.text;

describe('the welcome', () => {
  it('says Basis, capitalised, in both languages', () => {
    expect(textOf(loc('nl'), 'circle.firstRun.title')).toBe('Welkom bij Basis');
    expect(textOf(loc('en'), 'circle.firstRun.title')).toBe('Welcome to Basis');
  });
  it('the plain onboarding lines, from Vandaag\'s card — not the old framing', () => {
    const lines = [...src.matchAll(/'(circle\.[a-zA-Z_.0-9]+)'/g)].map((m) => m[1]).filter((k) => k.startsWith('circle.vandaag.onboarding_intro_'));
    expect(lines).toEqual(['circle.vandaag.onboarding_intro_1', 'circle.vandaag.onboarding_intro_2', 'circle.vandaag.onboarding_intro_3']);
    expect(src).not.toMatch(/firstRun\.(lede|bullet_pod|bullet_circles)/);
    for (const l of ['en', 'nl']) {
      const said = JSON.stringify(loc(l).firstRun);
      expect(said).not.toMatch(/neighbourhood chat|buurtchat|Solid pod/i);
    }
  });
});
