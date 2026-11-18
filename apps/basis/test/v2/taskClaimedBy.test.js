// A claimed task says WHO holds it (the phone walk of 2026-11-13: the row said "claimed" but not by whom). The name
// comes from the circle's roster through the reveal ladder, never a key; the viewer's own claim says "you".
import { describe, it, expect } from 'vitest';
import { taskItemToStreamRow, taskStatusShown } from '../../src/v2/taskRows.js';
import { actionsForStreamRow } from '../../src/v2/streamActions.js';

const t = (k, v) => (v ? `${k}|${JSON.stringify(v)}` : k);
const members = [
  { id: 'webid:anna', handle: 'anna' },
  { id: 'webid:bram', handle: 'bram' },
];

describe('what a claimed task offers', () => {
  const row = taskItemToStreamRow({ id: 't1', text: 'Afwas', state: 'claimed', assignees: ['webid:bram'], addedBy: 'webid:carla' });
  const acts = (viewerWebid) => actionsForStreamRow(row, { viewerWebid }).map((a) => a.action);

  it('its holder gets Done and Snooze', () => {
    expect(acts('webid:bram')).toEqual(['done', 'snooze']);
  });

  it('another member gets neither (the handler stays open: anyone may complete, by chat too)', () => {
    expect(acts('webid:anna')).toEqual([]);
    expect(acts(null)).toEqual([]);
  });

  it('the task\'s maker still gets entrust, not Done', () => {
    expect(acts('webid:carla')).toEqual(['mandate']);
  });

  it('an open task offers Claim to everyone', () => {
    const open = taskItemToStreamRow({ id: 't2', state: 'open' });
    expect(actionsForStreamRow(open, { viewerWebid: 'webid:anna' }).map((a) => a.action)).toEqual(['claim', 'snooze']);
  });
});

describe('the status a task row shows', () => {
  it('a claimed task names its holder', () => {
    const row = taskItemToStreamRow({ id: 't1', text: 'Afwas', state: 'claimed', assignees: ['webid:bram'], assignee: 'webid:bram' });
    expect(row.holders).toEqual(['webid:bram']);
    expect(taskStatusShown(row, { members, viewerId: 'webid:anna', t })).toBe('circle.taskStatus.claimed_by|{"who":"bram"}');
  });

  it('the viewer\'s own claim says you; co-holders are all named', () => {
    const row = taskItemToStreamRow({ id: 't1', state: 'claimed', assignees: ['webid:anna', 'webid:bram'] });
    expect(taskStatusShown(row, { members, viewerId: 'webid:anna', t })).toBe('circle.taskStatus.claimed_by|{"who":"circle.taskStatus.you, bram"}');
  });

  it('a holder the roster cannot place is "someone", never the key', () => {
    const row = taskItemToStreamRow({ id: 't1', state: 'claimed', assignee: 'z6MkrandomKeyMaterial0123456789abcdef' });
    const shown = taskStatusShown(row, { members, viewerId: 'webid:anna', t });
    expect(shown).not.toContain('z6Mk');
    expect(shown).toBe('circle.taskStatus.claimed_by|{"who":"circle.reply.who_someone"}');
  });

  it('an open task, or a claimed one without a holder, shows the plain status', () => {
    expect(taskStatusShown(taskItemToStreamRow({ id: 't1', state: 'open' }), { members, t })).toBe('circle.taskStatus.open|{"defaultValue":"open"}');
    expect(taskStatusShown(taskItemToStreamRow({ id: 't1', state: 'claimed' }), { members, t })).toBe('circle.taskStatus.claimed|{"defaultValue":"claimed"}');
  });
});
