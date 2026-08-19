/**
 * tasks tab row mapping — a tasks `listOpen` item projected into the stream-row
 * shape `actionsForStreamRow` reads, so the Taken tab's chips + the owner-only
 * entrust action come from the SAME selector the chat stream uses.
 */
import { describe, it, expect } from 'vitest';
import { buildTaskRows, taskItemToStreamRow, taskStatusOf } from '../../src/v2/taskRows.js';
import { actionsForStreamRow } from '../../src/v2/streamActions.js';

describe('taskItemToStreamRow', () => {
  it('stamps first-class taskId + addedBy + text + status', () => {
    const row = taskItemToStreamRow(
      { id: 'task-7', text: 'Afwas doen', state: 'open', addedBy: 'https://me.example/#me', assignee: null },
      { circleId: 'huis' },
    );
    expect(row.taskId).toBe('task-7');
    expect(row.addedBy).toBe('https://me.example/#me');
    expect(row.text).toBe('Afwas doen');
    expect(row.status).toBe('open');
    expect(row.circleId).toBe('huis');
    // provenance also rides the event payload for renderers that read it there.
    expect(row.event.payload.taskId).toBe('task-7');
  });

  it('reads title/label + status fallbacks', () => {
    expect(taskItemToStreamRow({ id: 'a', title: 'T', status: 'claimed' }).text).toBe('T');
    expect(taskItemToStreamRow({ id: 'b', label: 'L' }).text).toBe('L');
    expect(taskStatusOf({ state: 'submitted' })).toBe('submitted');
    expect(taskStatusOf({})).toBe('open');
  });

  it('maps lifecycle state → chip-bearing kind (open⇒chore, claimed⇒reminder, else⇒task)', () => {
    expect(taskItemToStreamRow({ id: 'a', state: 'open' }).type).toBe('chore');
    expect(taskItemToStreamRow({ id: 'b', state: 'claimed' }).type).toBe('reminder');
    expect(taskItemToStreamRow({ id: 'c', state: 'submitted' }).type).toBe('task');
  });
});

describe('buildTaskRows → actionsForStreamRow', () => {
  it('an OPEN task row yields claim + snooze + the owner-only mandate chip', () => {
    const [row] = buildTaskRows([{ id: 'task-1', text: 'X', state: 'open' }], { circleId: 'c' });
    const actions = actionsForStreamRow(row, { isAdmin: true }).map((a) => a.action);
    expect(actions).toContain('claim');
    expect(actions).toContain('snooze');
    expect(actions).toContain('mandate');
  });

  it('a CLAIMED task row yields done + snooze + the owner-only mandate chip', () => {
    const [row] = buildTaskRows([{ id: 'task-2', text: 'Y', state: 'claimed' }], { circleId: 'c' });
    const actions = actionsForStreamRow(row, { isAdmin: true }).map((a) => a.action);
    expect(actions).toContain('done');
    expect(actions).toContain('mandate');
  });

  it('the mandate chip carries the task id so the picker can dispatch attachTaskGrant', () => {
    const [row] = buildTaskRows([{ id: 'task-9', text: 'Z', state: 'open' }], { circleId: 'c' });
    const mandate = actionsForStreamRow(row, { isAdmin: true }).find((a) => a.action === 'mandate');
    expect(mandate.payload.taskId).toBe('task-9');
  });

  it('the mandate chip is hidden from a non-owner (not admin, not creator)', () => {
    const [row] = buildTaskRows([{ id: 't', text: 'Z', state: 'open', addedBy: 'https://alice/#me' }], { circleId: 'c' });
    const actions = actionsForStreamRow(row, { viewerWebid: 'https://bob/#me' }).map((a) => a.action);
    expect(actions).not.toContain('mandate');
  });

  it('the creator (non-admin) sees the mandate chip from first-class addedBy', () => {
    const [row] = buildTaskRows([{ id: 't', text: 'Z', state: 'open', addedBy: 'https://me/#me' }], { circleId: 'c' });
    const actions = actionsForStreamRow(row, { viewerWebid: 'https://me/#me', isAdmin: false }).map((a) => a.action);
    expect(actions).toContain('mandate');
  });
});
