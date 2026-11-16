/**
 * A task given to me by someone else is news ("Nieuw voor jou", and a banner by default); an edit of its words is not.
 */
import { describe, it, expect } from 'vitest';
import { assignedEntryFor, isItemLanding } from '../../src/v2/itemLanding.js';
import { notificationRows } from '../../src/v2/notifications.js';

const NOW = Date.UTC(2026, 10, 10, 12);
const task = (over = {}) => ({ id: 't1', type: 'task', title: 'lamp', createdAt: NOW - 5000, ...over });
const t = (k, v = {}) => `${k.split('.').pop()}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ''}`;

describe('assignedEntryFor', () => {
  it('an existing task newly assigned to me, by someone else: one reference entry', () => {
    const e = assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'me-c1' }), previous: task(), self: 'me-c1', authorRef: 'bea', now: NOW });
    expect(e).toMatchObject({ id: 'assigned:c1:t1:me-c1', actor: 'bea', payload: { circleId: 'c1', itemId: 't1', kind: 'task', reason: 'assigned' } });
    expect(isItemLanding({ ...e, type: e.type ?? e.kind })).toBe(true);
  });
  it('a new task that arrives already given to me is the same news', () => {
    expect(assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'me-c1' }), previous: null, self: 'me-c1', authorRef: 'bea', now: NOW })?.payload.reason).toBe('assigned');
  });
  it('no entry: a title edit of a task already mine, a task given to someone else, my own assignment', () => {
    expect(assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'me-c1', title: 'lamp!' }), previous: task({ assignee: 'me-c1' }), self: 'me-c1', authorRef: 'bea', now: NOW })).toBe(null);
    expect(assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'cas' }), previous: task(), self: 'me-c1', authorRef: 'bea', now: NOW })).toBe(null);
    expect(assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'me-c1' }), previous: task(), self: 'me-c1', authorRef: 'me-c1', now: NOW })).toBe(null);
  });
  it('is a row of its own kind under "Nieuw voor jou"', () => {
    const e = assignedEntryFor({ circleId: 'c1', item: task({ assignee: 'me-c1' }), previous: task(), self: 'me-c1', authorRef: 'bea', now: NOW });
    const rows = notificationRows({ events: [{ ...e, type: e.type ?? e.kind, landedAt: NOW - 100 }], circles: [{ id: 'c1', name: 'Straat' }], myRefs: ['me-c1'], t, now: NOW });
    expect(rows.map((r) => [r.kind, r.id])).toEqual([['assigned', 'assigned:c1:t1:me-c1']]);
  });
});
