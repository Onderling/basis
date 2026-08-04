/**
 * routingTable.test.js — Phase 2 foundation.
 *
 * Locks the routing decisions as a regression test.  If the routing
 * table changes, this test must change with it (and the
 * implementation-plan.md table at the same time).
 */
import { describe, it, expect } from 'vitest';

import { route, ROUTING_TABLE } from '../../src/pods/routingTable.js';

describe('routingTable — Phase 2 foundation lock', () => {
  it('shopping items always land on the household pod', () => {
    expect(route({ type: 'shopping', assignee: null })).toEqual({ pod: 'household', withRef: false });
    expect(route({ type: 'shopping', assignee: 'https://id.example/alice' })).toEqual({ pod: 'household', withRef: false });
  });

  it('repair items always land on the household pod', () => {
    expect(route({ type: 'repair', assignee: null })).toEqual({ pod: 'household', withRef: false });
    expect(route({ type: 'repair', assignee: 'https://id.example/alice' })).toEqual({ pod: 'household', withRef: false });
  });

  it('unassigned errands land on the household pod', () => {
    expect(route({ type: 'errand', assignee: null })).toEqual({ pod: 'household', withRef: false });
  });

  it('assigned errands land on the member pod with a household ref', () => {
    expect(route({ type: 'errand', assignee: 'https://id.example/alice' })).toEqual({ pod: 'member', withRef: true });
  });

  it('unassigned schedule items land on the household pod', () => {
    expect(route({ type: 'schedule', assignee: null })).toEqual({ pod: 'household', withRef: false });
  });

  it('assigned schedule items land on the member pod with a household ref', () => {
    expect(route({ type: 'schedule', assignee: 'https://id.example/alice' })).toEqual({ pod: 'member', withRef: true });
  });

  it('unknown types fall back to the household pod', () => {
    expect(route({ type: 'something-new', assignee: null })).toEqual({ pod: 'household', withRef: false });
  });

  it('ROUTING_TABLE is frozen', () => {
    expect(Object.isFrozen(ROUTING_TABLE)).toBe(true);
  });

  it('ROUTING_TABLE matches the live route() function for every row', () => {
    for (const row of ROUTING_TABLE) {
      const assignee = row.assignee === 'set' ? 'https://id.example/anyone' : null;
      const got = route({ type: row.type, assignee });
      expect(got).toEqual({ pod: row.pod, withRef: row.withRef });
    }
  });
});
