/**
 * renderWeb(tasksManifest) NavModel + dag.html wiring.
 *
 * Per `PLAN-gui-chat-uplift.md` acceptance gate #2 ("NavModel
 * JSON for that page snapshot-locked + owner-confirmed").  Locks the
 * shape of the `dag` section + the `getDagTree` op declaration so
 * downstream consumers (web `dag.html`, future mobile DagScreen
 * adapter, characterization corpus) can rely on it.
 *
 * Pure-JSON assertions only — no live server.  The end-to-end "page
 * serves + skill returns" check lives in
 * `test/characterization/dag.test.js`.
 */

import { describe, it, expect } from 'vitest';

import { renderWeb } from '@onderling/app-manifest';

import { tasksManifest } from '../manifest.js';

describe('Slice B.1: renderWeb(tasksManifest) NavModel', () => {
  const navModel = renderWeb(tasksManifest);

  it('app + sections + globals shape', () => {
    expect(navModel.app).toBe('tasks');
    expect(Array.isArray(navModel.sections)).toBe(true);
    expect(Array.isArray(navModel.globals)).toBe(true);
    // V0 has no global affordances declared (no `placement: 'global'`
    // in any op.surfaces.ui) — this guards against accidental
    // promotion of an existing op.
    expect(navModel.globals).toEqual([]);
  });

  it('preserves manifest.views declaration order', () => {
    // Mirrors `views[]` in manifest.js exactly.  When a new view is
    // added, append here AND to manifest.js (preserves: declaration
    // order = render order).
    expect(navModel.sections.map((s) => s.id)).toEqual([
      'open',
      'mine',
      'mastered',     // .1 (2026-05-20) — middle section of mine.html
      'pending-claims', // (2026-08-07) — claims awaiting my confirmation (claim-confirmation UX)
      'claimable',
      'review',       // .2 (2026-05-20) — review.html reviewer queue
      'dag',          // (2026-05-20)
      'inbox',        // .3 (2026-05-20) — inbox.html notification feed
      'pod-settings', // .4 (2026-05-20) — pod-settings.html -adopt
    ]);
  });

  it('the `dag` section shape locks the Slice B.1 contract', () => {
    const dag = navModel.sections.find((s) => s.id === 'dag');
    expect(dag).toBeTruthy();
    expect(dag.id).toBe('dag');
    expect(dag.title).toBe('DAG');
    expect(dag.itemType).toBe('task');
    // No `filter` (full forest), no `sort` (DAG order preserved by
    // `flattenDagTree`), no `audience` (V0 — no consumer).
    expect(dag.filter).toBeUndefined();
    expect(dag.sort).toBeUndefined();
    expect(dag.audience).toBeUndefined();
    // View-only — no per-item buttons in V0 (no surfaces.ui on
    // getDagTree, no other ops marked claim/complete on this view).
    // `claimTask`/`completeTask` etc. only surface as itemActions in
    // sections matching `appliesTo.type: 'task'` AND having
    // `surfaces.ui.control: 'button'`; the projector picks them up
    // for the `open`/`mine`/`claimable`/`dag` views alike.  The dag
    // page chooses to render NONE of them per the view-only contract
    // — adapters MAY ignore itemActions for this section.
    expect(Array.isArray(dag.itemActions)).toBe(true);
    expect(Array.isArray(dag.affordances)).toBe(true);
    // No `add` op surfaces here — `addTask`'s appliesTo is `{type:
    // 'task'}` so it surfaces in EVERY task section.  That's a
    // projector behaviour, not a B.1 regression; the dag.html script
    // ignores affordances by design (view-only).
  });

  it('getDagTree op declaration is preserved verbatim', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'getDagTree');
    expect(op).toBeTruthy();
    expect(op.verb).toBe('tree');                  // app-local verb (not in canonical VERBS)
    expect(op.appliesTo).toEqual({ type: 'task' });
    expect(op.params).toEqual([
      { name: 'rootId', kind: 'string' },          // optional — no `required`
    ]);
    expect(op.surfaces?.chat?.hint).toBeTruthy();
    expect(op.surfaces?.slash).toBeUndefined();    // read-only structural query
  });

});
