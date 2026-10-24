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

  // A painter paints ITS section and nothing else: a cut that swallows its neighbours moves them off the old page and onto
  // a group's screen (mobile's week-overview painter held ten sections, custody among them, 2026-10-24).
  const painterBodies = (src) => {
    const start = src.indexOf('const painters = {');
    const end = src.indexOf('\n  };\n', start);
    const block = src.slice(start, end);
    const heads = [...block.matchAll(/^ {4}'([a-z0-9-]+)': \(\) =>/gm)];
    return heads.map((m, i) => [m[1], block.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : block.length)]);
  };
  for (const [shell, src] of Object.entries(SHELLS)) {
    it(`${shell}: each painter paints exactly one section`, () => {
      const sectionOpen = shell === 'web' ? /\bsection\(tr\(/g : /<Section title=/g;
      const counts = painterBodies(src).map(([id, body]) => `${id}:${(body.match(sectionOpen) ?? []).length + (shell === 'web' && /renderUserLlmSettings\(holder/.test(body) ? 1 : 0)}`);
      expect(counts.filter((c) => !c.endsWith(':1'))).toEqual([]);
    });
  }

  it('no custody section is declared until both shells\' guard is checked here', () => {
    const custody = settingsHomeFor(basisManifest).groups.flatMap((g) => g.sections.filter((s) => s.custody).map((s) => s.id));
    expect(custody).toEqual([]);
  });
  it.todo('every custody section is painted behind the custody guard on web and mobile (with the keys & devices group)');
});
