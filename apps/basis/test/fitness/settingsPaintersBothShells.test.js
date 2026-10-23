/**
 * The person's settings are declared once (`settingsGroups` in the basis manifest) and painted by each shell, one
 * painter per section id. This pins the agreement: every declared section has a painter on web AND mobile, and
 * neither shell paints a section the manifest does not declare (a painter with no declaration is a section listed by
 * hand). Custody-guarded sections must be painted behind the guard on both shells; none is declared yet, and adding
 * one stays red until that check is written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basisManifest } from '../../manifest.js';
import { settingsHomeFor, settingsSectionIds } from '../../src/v2/settingsHome.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** The keys of a shell's `const painters = { 'id': () => … }` map. */
function painterIds(src) {
  const start = src.indexOf('const painters = {');
  if (start < 0) return [];
  const end = src.indexOf('\n  };\n', start);
  return [...src.slice(start, end).matchAll(/^ {4}'([a-z0-9-]+)': \(\) =>/gm)].map((m) => m[1]);
}

const SHELLS = {
  web: read('../../web/v2/circleMyData.js'),
  mobile: read('../../../basis-mobile/src/screens/v2/CircleMyDataScreen.js'),
};

describe('settings sections: declared once, painted on both shells', () => {
  const declared = [...settingsSectionIds(basisManifest)].sort();

  it('the declaration is not empty (the probe reads it)', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  for (const [shell, src] of Object.entries(SHELLS)) {
    it(`${shell}: one painter per declared section, and none undeclared`, () => {
      expect(painterIds(src).sort()).toEqual(declared);
    });
  }

  it('no custody section is declared until both shells\' guard is checked here', () => {
    const custody = settingsHomeFor(basisManifest).groups.flatMap((g) => g.sections.filter((s) => s.custody).map((s) => s.id));
    expect(custody).toEqual([]);
  });
  it.todo('every custody section is painted behind the custody guard on web and mobile (with the keys & devices group)');
});
