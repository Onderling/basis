/**
 * FITNESS — the circle attach menu is MANIFEST-DERIVED, never hardcoded in a shell (invariant #4).
 *
 * Web builds its composer "+" attach menu from `renderAttachments(basisManifest).attachMenu` — the shared
 * projector over the manifest's `surfaces.attach` ops (Kaart / File / Afspraak). The single source of truth for
 * which attach options exist is the manifest; a shell must PROJECT it, never restate it.
 *
 * The drift this guards: a shell (today the likely offender is mobile, whose noticeboard has only a hardcoded
 * image button and no manifest-derived menu — a known, tracked parity gap) growing its own hand-written attach
 * menu with the attach labels baked in. That is exactly the class of web≢mobile / manifest-bypass drift that let
 * `/security-status` misroute: a surface the manifest declares, restated by hand in one shell. This pins it —
 * the attach LABELS live only in the manifest + the locale files; if any shell source restates one, it has
 * hardcoded the menu instead of deriving it, and this fails. So whenever the mobile attach menu IS built, it is
 * forced through `renderAttachments`, not a parallel hand-rolled list.
 *
 * (This does NOT assert mobile HAS the menu yet — that is a deferred UI feature. It asserts that when any shell
 * renders it, the source is the manifest.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { basisManifest } from '../../manifest.js';
import { renderAttachments } from '@onderling/app-manifest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The attach labels — they belong to the manifest + locale files ONLY, never restated in shell code. */
const ATTACH_LABELS = ['circle.attach.card', 'circle.attach.file', 'circle.attach.appointment'];

/** Shell source trees that render surfaces (composers/screens). Excludes the manifest + locale sources. */
const SHELL_TREES = ['apps/basis/web', 'apps/basis-mobile/src'];

/** Recursively collect .js files under a dir, skipping node_modules + the locale JSON. */
function jsFiles(absDir) {
  const out = [];
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'locales') continue;
    const p = join(absDir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('FITNESS: the circle attach menu is manifest-derived (invariant #4)', () => {
  it('the manifest declares attach surfaces, so the projector has real content', () => {
    const menu = renderAttachments(basisManifest).attachMenu;
    expect(Array.isArray(menu)).toBe(true);
    expect(menu.length, 'manifest declares at least one surfaces.attach op').toBeGreaterThan(0);
  });

  it('the built (web) side DERIVES its attach menu from renderAttachments — not a hardcoded list', () => {
    const web = jsFiles(resolve(repoRoot, 'apps/basis/web'));
    const derives = web.some((f) => readFileSync(f, 'utf8').includes('renderAttachments(basisManifest)'));
    expect(derives, 'a web composer must call renderAttachments(basisManifest) to build its attach menu').toBe(true);
  });

  it('no shell source hardcodes an attach LABEL — the labels live only in the manifest + locales', () => {
    const offenders = [];
    for (const tree of SHELL_TREES) {
      for (const file of jsFiles(resolve(repoRoot, tree))) {
        const src = readFileSync(file, 'utf8');
        for (const label of ATTACH_LABELS) {
          if (src.includes(label)) offenders.push(`${file.replace(repoRoot + '/', '')} → ${label}`);
        }
      }
    }
    expect(
      offenders,
      `a shell restated an attach-menu label instead of projecting it from renderAttachments(manifest) — `
      + `add the op to the manifest and derive the menu, do not hand-roll it: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
