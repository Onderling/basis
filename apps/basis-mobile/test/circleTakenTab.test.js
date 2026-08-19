/**
 * Taken (tasks) tab — MOBILE parity.
 *
 * RN screens can't render under Vitest (see vitest.config.js), so — like
 * circleTabBarProjection.test.js — this exercises the SAME shared pure logic the
 * CircleLauncherScreen's Taken tab wires: a tasks `listOpen` item is projected via
 * the shared `buildTaskRows` into the stream-row shape `actionsForStreamRow` reads,
 * yielding the lifecycle chips + the owner-only entrust ("Toevertrouwen") chip. Both
 * come from `@onderling-app/basis` — the exact import the screen uses — so web ≡ mobile
 * by construction. The user strings resolve through the real mobile `t()`.
 */
import { describe, it, expect } from 'vitest';
import { buildTaskRows, actionsForStreamRow } from '@onderling-app/basis';
import { t } from '../src/core/localisation.js';

describe('mobile Taken tab — shared task-row projection + chips', () => {
  it('an OPEN task row yields claim + snooze + the owner-only mandate chip (admin viewer)', () => {
    const [row] = buildTaskRows([{ id: 'task-1', text: 'Afwas', state: 'open' }], { circleId: 'huis' });
    const actions = actionsForStreamRow(row, { isAdmin: true }).map((a) => a.action);
    expect(actions).toContain('claim');
    expect(actions).toContain('snooze');
    expect(actions).toContain('mandate');
  });

  it('a CLAIMED task row yields done + the owner-only mandate chip', () => {
    const [row] = buildTaskRows([{ id: 'task-2', text: 'Vuilnis', state: 'claimed' }], { circleId: 'huis' });
    const actions = actionsForStreamRow(row, { isAdmin: true }).map((a) => a.action);
    expect(actions).toContain('done');
    expect(actions).toContain('mandate');
  });

  it('the row carries the taskId so the mandate chip can open the picker', () => {
    const [row] = buildTaskRows([{ id: 'task-42', text: 'X', state: 'open' }], { circleId: 'huis' });
    expect(row.taskId).toBe('task-42');
    const mandate = actionsForStreamRow(row, { isAdmin: true }).find((a) => a.action === 'mandate');
    expect(mandate.payload.taskId).toBe('task-42');
  });

  it('the mandate chip is hidden from a non-owner', () => {
    const [row] = buildTaskRows([{ id: 't', text: 'X', state: 'open', addedBy: 'https://alice/#me' }], { circleId: 'huis' });
    const actions = actionsForStreamRow(row, { viewerWebid: 'https://bob/#me' }).map((a) => a.action);
    expect(actions).not.toContain('mandate');
  });

  it('the Taken-tab + chip user strings resolve via the mobile t()', () => {
    for (const key of ['circle.circle.taken_empty', 'circle.circle.taken_add', 'circle.circle.taken_untitled',
      'circle.taskStatus.open', 'circle.taskStatus.claimed', 'circle.streamAction.mandate',
      'circle.streamAction.claim', 'circle.streamAction.done']) {
      const s = t(key);
      expect(typeof s, key).toBe('string');
      expect(s, key).not.toBe(key);   // a raw key means the locale entry is missing
    }
  });
});
