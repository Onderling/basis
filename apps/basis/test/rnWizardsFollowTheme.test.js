/**
 * Every phone wizard built on the kit follows the app's theme. The kit's primitives (steps, fields, radio groups)
 * read their colours from `WizardTheme`; a wizard that does not wrap itself in it paints them LIGHT on a dark
 * sheet — dark text on dark, white inputs (the create-circle wizard, walked on the emulator 2026-10-22). Only the
 * join wizard wrapped itself. `src/rn/**` cannot render under vitest, so this pins the wiring as source text.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = fileURLToPath(new URL('../src/rn/wizards/', import.meta.url));
const modals = readdirSync(DIR).filter((f) => /WizardModal\.js$/.test(f));

describe('the phone wizards follow the theme', () => {
  it('there are wizard modals to check', () => { expect(modals.length).toBeGreaterThan(3); });
  for (const f of modals) {
    it(`${f} wraps itself in WizardTheme when it uses the kit`, () => {
      const src = readFileSync(path.join(DIR, f), 'utf8');
      if (!/from '\.\/_kit\.js'/.test(src)) return;
      expect(src, `${f} uses the kit but never wraps in <WizardTheme theme={…}>`).toMatch(/<WizardTheme theme=\{/);
    });
  }
});
