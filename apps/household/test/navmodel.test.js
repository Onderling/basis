/**
 * household manifest → NavModel snapshot test.
 *
 * The FIRST real manifest fed through `renderWeb`.  Asserts:
 *   - the 6 declared views all surface as sections (4 list-types +
 *     tasks + members);
 *   - each list-type section has `addItem` as an affordance
 *     (auto-surfaced via verb=add rule, prefilled type);
 *   - each list-type + tasks section has `markComplete`/`removeItem`
 *     as itemActions (multi-type via F-SP3-a);
 *   - the snapshot is byte-stable across runs (no non-determinism).
 *
 * See `DESIGN-navmodel-sketch.md` "Owner decisions" for the
 * locked answers this test exercises.
 */

import { describe, it, expect } from 'vitest';

import { renderWeb } from '@onderling/app-manifest';

import { householdManifest } from '../manifest.js';

const navModel = renderWeb(householdManifest);

describe('household manifest → NavModel (Slice A.2)', () => {
  it('app mirrors manifest.app', () => {
    expect(navModel.app).toBe('household');
  });

  it('six sections — 4 list-types + tasks + members — in declaration order', () => {
    expect(navModel.sections.map((s) => s.id)).toEqual([
      'shopping', 'errand', 'repair', 'schedule', 'tasks', 'members',
    ]);
  });

  it('every section mirrors its view title + itemType', () => {
    const byId = Object.fromEntries(navModel.sections.map((s) => [s.id, s]));
    expect(byId.shopping).toMatchObject({ title: 'Shopping', itemType: 'shopping' });
    expect(byId.errand).toMatchObject  ({ title: 'Errands',  itemType: 'errand'   });
    expect(byId.repair).toMatchObject  ({ title: 'Repairs',  itemType: 'repair'   });
    expect(byId.schedule).toMatchObject({ title: 'Schedule', itemType: 'schedule' });
    expect(byId.tasks).toMatchObject   ({ title: 'Tasks',    itemType: 'task'     });
    expect(byId.members).toMatchObject ({ title: 'Members',  itemType: 'contact'  });
  });

  describe('list-type sections (Q6 type-enum fallback exercise)', () => {
    for (const id of ['shopping', 'errand', 'repair', 'schedule']) {
      it(`${id}: addItem auto-surfaces as affordance with prefilledParams.type='${id}'`, () => {
        const sec = navModel.sections.find((s) => s.id === id);
        const addItem = sec.affordances.find((a) => a.opId === 'addItem');
        expect(addItem, `${id}.affordances must include addItem`).toBeTruthy();
        expect(addItem.prefilledParams).toEqual({ type: id });
      });

      it(`${id}: markComplete + removeItem surface as itemActions`, () => {
        const sec = navModel.sections.find((s) => s.id === id);
        const ids = sec.itemActions.map((a) => a.opId);
        expect(ids).toContain('markComplete');
        expect(ids).toContain('removeItem');
      });
    }
  });

  describe('tasks section (SP-2 appliesTo + multi-type lifecycle)', () => {
    const tasks = navModel.sections.find((s) => s.id === 'tasks');

    it('no addTask affordance: a chore is added through the tasks app (one owner per op)', () => {
      expect(tasks.affordances.find((a) => a.opId === 'addTask')).toBeUndefined();
    });

    it('claim surfaces as itemAction with state="open"', () => {
      const claim = tasks.itemActions.find((a) => a.opId === 'claim');
      expect(claim).toBeTruthy();
      // (2026-05-26) canonicalised appliesTo.state to array form
      // across all apps (tasks-v0 / calendar / pinboard / household).
      expect(claim.appliesTo.state).toEqual(['open']);
    });

    it('markComplete + removeItem surface as itemActions on tasks too (multi-type appliesTo)', () => {
      const ids = tasks.itemActions.map((a) => a.opId);
      expect(ids).toContain('markComplete');
      expect(ids).toContain('removeItem');
    });
  });

  describe('members section', () => {
    const members = navModel.sections.find((s) => s.id === 'members');

    it('Q10 (2026-05-21): verb=register auto-surfaces registerName as affordance', () => {
      // Resolved 2026-05-21 (NavModel): `register` is now a
      // creative verb (alongside `add`).  household's `registerName`
      // op (verb='register', non-canonical via F-SP1-e) auto-surfaces
      // in the members section without needing `surfaces.ui`.
      const reg = members.affordances.find((a) => a.opId === 'registerName');
      expect(reg).toBeTruthy();
      expect(reg.opId).toBe('registerName');
    });
  });

  describe('chat-only ops omitted from NavModel', () => {
    it('classifyAndExtract / listOpen / listTasks / reassign do NOT surface', () => {
      const allOpIds = navModel.sections.flatMap((s) => [
        ...s.affordances.map((a) => a.opId),
        ...s.itemActions.map((a) => a.opId),
      ]);
      // listOpen + listTasks: skipped by verb=list rule.
      expect(allOpIds).not.toContain('listOpenItems');
      expect(allOpIds).not.toContain('listTasks');
      // classifyAndExtract: not in manifest, sanity-check.
      expect(allOpIds).not.toContain('classifyAndExtract');
      // reassign: no surfaces.ui declared — chat-only (NOT a creative verb).
      expect(allOpIds).not.toContain('reassign');
      // registerName IS a creative verb so it DOES surface — moved
      // out of the omission test.
    });
  });

  describe('determinism + structural snapshot', () => {
    it('two runs produce JSON-equal NavModel', () => {
      const a = JSON.stringify(renderWeb(householdManifest));
      const b = JSON.stringify(renderWeb(householdManifest));
      expect(a).toBe(b);
    });

    it('structural baseline (snapshot)', () => {
      // Snapshot covers the full NavModel.  ULIDs / timestamps don't
      // appear here (NavModel is pure manifest projection — no
      // runtime data).  If the snapshot fails on first run, vitest
      // auto-writes it; review the diff to confirm intended drift.
      expect(navModel).toMatchSnapshot('household.NavModel.structural');
    });
  });
});
