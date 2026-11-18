/**
 * .1 — mine.html migrated to NavModel + B.2.0 web-adapter helpers.
 *
 * Asserts:
 *   - The manifest now declares the `listMyMasteredTasks` op AND the
 *     `mastered` view (was off-manifest pre-B.2.1).
 *   - renderWeb's NavModel projects the three mine.html sections
 *     (`mine` / `mastered` / `claimable`) in declaration order with
 *     the expected DoD-lifecycle itemActions.
 *   - The page serves + carries the imports the B.2.0 overlay
 *     provides (itemMatchesAppliesTo / applyPrefilledParams).
 *   - The three list skills round-trip via /tasks/send.
 *
 * Pattern mirrors the dag.html characterization tests — same
 * `buildCharacterizationFixture` harness; the fixture overlays
 * `/lib/web-adapter/*` automatically (per setup.js,.0).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { renderWeb } from '@onderling/app-manifest';

import { tasksManifest } from '../manifest.js';
import {
  ANNE, FRITS, buildCharacterizationFixture,
} from './characterization/setup.js';

let fixture;

beforeAll(async () => {
  fixture = await buildCharacterizationFixture({ actor: ANNE });
});

afterAll(async () => {
  await fixture?.teardown();
});

describe('Slice B.2.1 — manifest delta (mine.html data sources)', () => {
  it('declares listMyMasteredTasks as a list op on type=task', () => {
    const op = tasksManifest.operations.find((o) => o.id === 'listMyMasteredTasks');
    expect(op).toBeTruthy();
    expect(op.verb).toBe('list');
    expect(op.appliesTo).toEqual({ type: 'task' });
    expect(op.params).toEqual([]);
    expect(op.surfaces?.chat?.hint, 'withheld from a model: a task flow that lost its screen (L1025 prune, L442)').toBeUndefined();
    // No surfaces.ui — list ops are an implicit data source, not a button.
    expect(op.surfaces?.ui).toBeUndefined();
  });

  it('renderWeb projects mine / mastered / claimable in declaration order', () => {
    const nav = renderWeb(tasksManifest);
    const ids = nav.sections.map((s) => s.id);
    // mine.html's three sections must appear in this order so the
    // page renders top-to-bottom matching the manifest.
    const mine      = ids.indexOf('mine');
    const mastered  = ids.indexOf('mastered');
    const claimable = ids.indexOf('claimable');
    expect(mine).toBeGreaterThan(-1);
    expect(mastered).toBeGreaterThan(-1);
    expect(claimable).toBeGreaterThan(-1);
    expect(mine).toBeLessThan(mastered);
    expect(mastered).toBeLessThan(claimable);
  });

  it('each mine.html section carries the V0.7 DoD-lifecycle itemActions', () => {
    const nav = renderWeb(tasksManifest);
    for (const id of ['mine', 'mastered', 'claimable']) {
      const sec = nav.sections.find((s) => s.id === id);
      expect(sec, `section ${id} missing`).toBeTruthy();
      const opIds = sec.itemActions.map((a) => a.opId).sort();
      // Every type='task' op with surfaces.ui surfaces here.  The
      // section is responsible for filtering by appliesTo.state at
      // render time (itemMatchesAppliesTo).
      expect(opIds).toEqual(expect.arrayContaining([
        'claimTask', 'completeTask', 'submitTask',
        'approveTask', 'rejectTask', 'revokeTask',
      ]));
    }
  });

  it('claimTask itemAction carries the F-SP3-a state gate', () => {
    const nav = renderWeb(tasksManifest);
    const mine = nav.sections.find((s) => s.id === 'mine');
    const claim = mine.itemActions.find((a) => a.opId === 'claimTask');
    expect(claim).toBeTruthy();
    expect(claim.appliesTo.state).toEqual(['open']);
  });

  it('revokeTask carries the multi-state F-SP3-a gate', () => {
    const nav = renderWeb(tasksManifest);
    const mine = nav.sections.find((s) => s.id === 'mine');
    const revoke = mine.itemActions.find((a) => a.opId === 'revokeTask');
    expect(revoke).toBeTruthy();
    expect(revoke.appliesTo.state).toEqual(['claimed', 'submitted', 'rejected']);
  });
});

describe('Slice B.2.1 — mine.html page integration', () => {
  it('serves /mine.html with the V0.7 DoD nav + the B.2.0 web-adapter imports', async () => {
    const html = await fixture.fetchPage('mine.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('My work');                    // static nav skeleton
    expect(html).toContain('id="assigned-list"');
    expect(html).toContain('id="mastered-list"');
    expect(html).toContain('id="claimable-list"');
    // B.2.0 overlay imports — proof the page is wired through the
    // shared helpers, not the pre-B.2.1 inline copies.
    expect(html).toContain('/lib/web-adapter/itemMatchesAppliesTo.js');
    expect(html).toContain('/lib/web-adapter/applyPrefilledParams.js');
  });

  it('serves the B.2.0 web-adapter overlay endpoints (mirror of household-web)', async () => {
    // The characterization fixture's setup.js was extended in B.2.0
    // to overlay /lib/web-adapter/* on top of the static dir.  Smoke-
    // check each helper is reachable.
    for (const n of [
      'callSkill', 'deriveItemState', 'itemMatchesAppliesTo',
      'applyPrefilledParams', 'index',
    ]) {
      const res = await fetch(`${fixture.baseUrl}/lib/web-adapter/${n}.js`);
      expect(res.status, `expected 200 for ${n}.js`).toBe(200);
      const js = await res.text();
      expect(js).toContain('export');
    }
  });

  it('/navmodel.json includes the new mastered section', async () => {
    const nav = await fixture.fetchJson('/navmodel.json');
    const ids = nav.sections.map((s) => s.id);
    expect(ids).toContain('mine');
    expect(ids).toContain('mastered');
    expect(ids).toContain('claimable');
    const mastered = nav.sections.find((s) => s.id === 'mastered');
    expect(mastered.title).toBe("I'm master of");
    expect(mastered.itemType).toBe('task');
  });

  it('listMine / listMyMasteredTasks / listClaimable all round-trip via /tasks/send', async () => {
    // Pre-seed a task assigned to ANNE so listMine has something to return.
    const seed = await fixture.callSkill('addTask', { text: 'B.2.1 seed', type: 'task' });
    const taskId = seed?.task?.id ?? seed?.id;
    expect(taskId, 'addTask must return an id').toBeTruthy();
    await fixture.callSkill('claimTask', { id: taskId });

    // listMine — through A2A wire (the same path mine.html uses).
    const mineRes = await fetch(`${fixture.baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listMine',
        message: { parts: [{ type: 'DataPart', data: {} }] },
      }),
    });
    expect(mineRes.status).toBe(200);
    const mineJson = await mineRes.json();
    const mineDp = (mineJson.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    expect(Array.isArray(mineDp?.data?.items)).toBe(true);

    // listMyMasteredTasks — same path.
    const masteredRes = await fetch(`${fixture.baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listMyMasteredTasks',
        message: { parts: [{ type: 'DataPart', data: {} }] },
      }),
    });
    expect(masteredRes.status).toBe(200);
    const masteredJson = await masteredRes.json();
    const masteredDp = (masteredJson.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    expect(Array.isArray(masteredDp?.data?.items)).toBe(true);

    // listClaimable — same path.
    const claimableRes = await fetch(`${fixture.baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'listClaimable',
        message: { parts: [{ type: 'DataPart', data: {} }] },
      }),
    });
    expect(claimableRes.status).toBe(200);
    const claimableJson = await claimableRes.json();
    const claimableDp = (claimableJson.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
    expect(Array.isArray(claimableDp?.data?.items)).toBe(true);
  });
});
