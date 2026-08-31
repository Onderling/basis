/**
 * FITNESS — the Advanced list is the door of last resort, so it may not skip an op on a guess.
 *
 * Its promise is "an op with no bespoke screen is still visible and reachable here". It used to ask the
 * coverage REPORT whether an op had a screen, and that report credits a screen to any op whose verb is
 * creative (`add`/`register`), because `renderWeb` auto-projects a compose form for those.
 *
 * Measured 2026-08-31: fifteen basis ops carry `verb: 'add'` while creating nothing — `signin`, `mute`,
 * `rotate-identity`, `peer-connect`, `test-peer`, `send-file` — so the report credited each with a
 * screen that does not exist, and the net skipped precisely the ops that had nowhere else to be. They
 * had one declared door, `surfaces.slash`, and the chat shell that served it was folded into the circle
 * view months earlier. Nothing failed: every parity guard compares the shells to each other, and both
 * were equally shut.
 */
import { describe, it, expect } from 'vitest';
import { advancedOpRows } from '../../src/v2/advancedSurface.js';
import { basisManifest } from '../../manifest.js';

const rows = advancedOpRows({ manifests: [basisManifest] });
const listed = new Set(rows.map((r) => r.op));

describe('the Advanced surface reaches every op with no declared screen', () => {
  it('lists an op whose only declared door is a slash command', () => {
    // `mute` is the case that started this: verb `add`, no ui, no page, slash only.
    const op = basisManifest.operations.find((o) => o.id === 'mute');
    expect(op?.surfaces?.ui, 'precondition: mute declares no ui surface').toBeUndefined();
    expect(op?.surfaces?.page, 'precondition: mute declares no page surface').toBeUndefined();
    expect(listed.has('mute'), 'an op with no declared screen must be reachable in Advanced').toBe(true);
  });

  it('lists EVERY basis op that declares neither ui nor page', () => {
    const doorless = basisManifest.operations
      .filter((o) => !o?.surfaces?.ui && !o?.surfaces?.page)
      .map((o) => o.id);
    const missing = doorless.filter((id) => !listed.has(id));
    expect(missing, 'these ops declare no screen and are not in the Advanced list either — '
      + 'they would be reachable by nothing').toEqual([]);
  });

  it('still EXCLUDES an op that has a real declared screen', () => {
    // `me` declares `surfaces.page` — it has the Me tab, so the fallback list should not repeat it.
    expect(basisManifest.operations.find((o) => o.id === 'me')?.surfaces?.page).toBeTruthy();
    expect(listed.has('me')).toBe(false);
  });

  it('says how each doorless op can be run — directly, or through its own form', () => {
    for (const r of rows) expect(['run', 'form']).toContain(r.via);
  });
});
