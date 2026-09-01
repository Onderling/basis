/**
 * FITNESS — the Advanced list is the door of last resort, so it may not skip an op on a guess.
 *
 * Its promise is "an op with no bespoke screen is still visible and reachable here". It used to ask the
 * coverage REPORT whether an op had a screen, and that report credits a screen to any op whose verb is
 * creative (`add`/`register`), because `renderWeb` auto-projects a compose form for those.
 *
 * Measured 2026-08-31: twelve basis ops carry `verb: 'add'` while creating nothing — `signin`, `mute`,
 * `rotate-identity`, `peer-connect`, `test-peer`, `send-file` — so the report credited each with a
 * screen that does not exist, and the net skipped precisely the ops that had nowhere else to be. They
 * had one declared door, `surfaces.slash`, and the chat shell that served it was folded into the circle
 * view months earlier. Nothing failed: every parity guard compares the shells to each other, and both
 * were equally shut.
 */
import { describe, it, expect } from 'vitest';
import { advancedOpRows, ADVANCED_SHELVES } from '../../src/v2/advancedSurface.js';
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

  it('lists EVERY basis op that declares no door of its own', () => {
    const doorless = basisManifest.operations
      .filter((o) => !o?.surfaces?.ui && !o?.surfaces?.page && !o?.surfaces?.attach)
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

  it('does NOT repeat an op whose door is the attach menu', () => {
    // `embed-file` declares `surfaces.attach`: `renderAttachments` puts it in the composer's "+" menu
    // on both shells, and a tap there compiles to the same {opId, args} a slash command does. A
    // declared door is a door, whichever projector paints it — the list of last resort skips it.
    for (const id of ['embed', 'embed-file', 'embed-time']) {
      expect(basisManifest.operations.find((o) => o.id === id)?.surfaces?.attach,
        `precondition: ${id} declares an attach surface`).toBeTruthy();
      expect(listed.has(id), `${id} is reachable from the attach menu, so Advanced need not repeat it`)
        .toBe(false);
    }
  });

  it('every row says which shelf it belongs on, and the shelf is DECLARED not guessed', () => {
    // A flat list of twenty is a place things are put, not a door — nobody scans it, which is how an op
    // that had lost its door could sit here and still be unreachable in practice. The group rides the
    // manifest so the shells only paint it, and so two shells cannot shelve the same op differently.
    for (const r of rows) {
      expect(typeof r.group, `${r.op} has no group`).toBe('string');
      expect(r.group.length).toBeGreaterThan(0);
    }
    const groups = new Set(rows.map((r) => r.group));
    expect(groups.has('other'), 'nothing should be falling through to the catch-all today').toBe(false);
    expect(groups.size, 'a handful of shelves, not one per op').toBeLessThanOrEqual(8);
  });

  it('paints each shelf ONCE — the rows arrive grouped, not in declaration order', () => {
    // The shells paint a heading when the group CHANGES from the previous row, which is the cheap and
    // right way to do it — provided the rows are grouped. Unsorted, that same code painted "Identity"
    // three times and "This device" twice: eight shelves rendered as twelve headings, which reads as
    // noise with headings in it. Found by walking the drawer in a browser rather than by this file,
    // which had asked whether every row HAS a shelf (true) and not whether a shelf appears once.
    const headings = rows.filter((r, i) => i === 0 || rows[i - 1].group !== r.group).map((r) => r.group);
    expect(headings, 'a shelf heading appears once').toEqual([...new Set(headings)]);
    // And in the declared reading order, so neither shell has to sort and they cannot disagree.
    expect(headings).toEqual(ADVANCED_SHELVES.filter((g) => headings.includes(g)));
  });

  it('groups the ops a person came looking for apart from the ones they did not', () => {
    const of = (g) => rows.filter((r) => r.group === g).map((r) => r.op).sort();
    expect(of('identity')).toEqual(['rotate-identity', 'signin', 'signout', 'whoami']);
    expect(of('diagnostics')).toEqual(['audit-tail', 'debug-dump', 'security-status']);
    expect(of('people'), 'blocking someone is a social act, not a transport setting')
      .toEqual(['mute', 'muted', 'unmute']);
  });

  it('says how each doorless op can be run — directly, or through its own form', () => {
    for (const r of rows) expect(['run', 'form']).toContain(r.via);
  });
});
