// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
// The device transport modes (nkn · relay · both) are listed ONCE, as TRANSPORT_MODES in circleSettingsControls.js.
// Eight copies had grown (the manifest, both shells, the agent, the host handler, the settings wizard); a ninth with
// a fourth mode would have been refused by some and accepted by others. Every other file reads the one list.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { basisManifest } from '../../manifest.js';
import { TRANSPORT_MODES } from '../../src/v2/circleSettingsControls.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const HOME = join('apps', 'basis', 'src', 'v2', 'circleSettingsControls.js');
// the manifest is not scanned: it imports nothing (it is the contract, data only), so its op declares the list
// and the test below pins that it AGREES with the one list
const DIRS = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
const LITERAL = /\[\s*'nkn'\s*,\s*'relay'\s*,\s*'both'\s*\]/;

function* files(p) {
  const abs = join(ROOT, p);
  let st; try { st = statSync(abs); } catch { return; }
  if (st.isFile()) { if (/\.(m?js)$/.test(abs)) yield abs; return; }
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    yield* files(join(p, name));
  }
}

describe('the transport modes have one home', () => {
  it('no file but circleSettingsControls.js spells the list out', () => {
    const copies = [];
    for (const d of DIRS) for (const f of files(d)) {
      const rel = relative(ROOT, f);
      if (rel === HOME) continue;
      if (LITERAL.test(readFileSync(f, 'utf8'))) copies.push(rel);
    }
    expect(copies).toEqual([]);
  });

  it('the manifest\'s transport-mode op declares the same modes', () => {
    const op = basisManifest.operations.find((o) => o.id === 'transport-mode');
    const mode = (op?.params ?? []).find((p) => p.name === 'mode');
    expect(mode?.of).toEqual([...TRANSPORT_MODES]);
  });
});
