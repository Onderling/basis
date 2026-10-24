/**
 * The person's settings are declared once (`settingsGroups` in the basis manifest) and painted by each shell, one
 * painter per section id. This pins the agreement: every declared section has a painter on web AND mobile, and
 * neither shell paints a section the manifest does not declare (a painter with no declaration is a section listed by
 * hand). A custody section's painter reaches only owner-only ops, through the waist, on both shells.
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

  // A section declared a switch is painted as one ("a row looks like what it is"): not a button with on/off words.
  for (const [shell, src] of Object.entries(SHELLS)) {
    it(`${shell}: every painter of a declared switch paints a real switch`, () => {
      const bodies = Object.fromEntries(painterBodies(src));
      const switches = settingsHomeFor(basisManifest).groups.flatMap((g) => g.sections.filter((x) => x.kind === 'switch').map((x) => x.id));
      expect(switches.length).toBeGreaterThan(0);
      const real = shell === 'web' ? /setAttribute\('role', 'switch'\)/ : /<Switch\b/;
      expect(switches.filter((id) => !real.test(bodies[id] ?? ''))).toEqual([]);
    });
  }

  // Custody — the keys, the devices, and where the data lives (sign-in): what a section with `custody: true` paints
  // reaches only owner-only (`private`) ops, and only through the waist. Its painter on either shell calls no handler
  // directly, writes no store, and every `callSkill` it makes names a `private` op of the declared app; everything else
  // it does is a host callback that opens the ceremony (the ceremony's own ops are the waist's to gate).
  const custody = settingsHomeFor(basisManifest).groups.flatMap((g) => g.sections.filter((x) => x.custody).map((x) => x.id));
  it('the custody sections are the keys, the devices and the storage (sign-in)', () => {
    expect([...custody].sort()).toEqual(['devices', 'keys', 'storage']);
  });
  const MANIFESTS = { basis: basisManifest };
  for (const [shell, src] of Object.entries(SHELLS)) {
    it(`${shell}: a custody painter reaches only private ops, through the waist`, () => {
      const bodies = Object.fromEntries(painterBodies(src));
      for (const id of custody) {
        const body = bodies[id] ?? '';
        expect(body, `${id} has a painter`).not.toBe('');
        expect(body, `${id}: a direct handler call`).not.toMatch(/\.handler\(/);
        expect(body, `${id}: a store written by hand`).not.toMatch(/AsyncStorage|localStorage|\.write\(|\bvault\.set\(/);
        for (const m of body.matchAll(/callSkill\??\.?\(\s*(?:'([^']+)'|([^,\s)]+))\s*,\s*(?:'([^']+)'|([^,\s)]+))/g)) {
          expect(m[1] && m[3], `${id}: callSkill names its op by a literal`).toBeTruthy();
          const op = (MANIFESTS[m[1]]?.operations ?? []).find((o) => o.id === m[3]);
          expect(op?.visibility, `${id}: ${m[1]}.${m[3]} is private`).toBe('private');
        }
      }
    });
  }
});
