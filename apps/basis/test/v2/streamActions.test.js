/**
 * Stream per-row actions + pinned compose tests.
 */
import { describe, it, expect } from 'vitest';
import {
  actionsForStreamRow, buildStreamComposeContext,
} from '../../src/v2/streamActions.js';

describe('actionsForStreamRow', () => {
  function mkRow({ id = 'r1', circleId = 'selwerd', kind, type, payload = {} } = {}) {
    return {
      id, circleId,
      type, event: { type, payload: { kind, ...payload } },
    };
  }

  it('returns [] for malformed rows', () => {
    expect(actionsForStreamRow(null)).toEqual([]);
    expect(actionsForStreamRow({})).toEqual([]);
    expect(actionsForStreamRow({ event: 'not-an-object' })).toEqual([]);
  });

  it('returns [] for unknown kinds (renderer falls back to no buttons)', () => {
    const row = mkRow({ kind: 'mystery' });
    expect(actionsForStreamRow(row)).toEqual([]);
  });

  it('emits help + ignore for an ask', () => {
    const row = mkRow({ kind: 'ask' });
    const actions = actionsForStreamRow(row);
    expect(actions.map((a) => a.action)).toEqual(['help', 'ignore']);
    expect(actions[0].label).toBe('circle.streamAction.help');
  });

  it('emits offer + ignore for borrow/leen', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'borrow' })).map((a) => a.action))
      .toEqual(['offer', 'ignore']);
    expect(actionsForStreamRow(mkRow({ kind: 'lend' })).map((a) => a.action))
      .toEqual(['offer', 'ignore']);
  });

  it('emits take + ignore for offer', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'offer' })).map((a) => a.action))
      .toEqual(['take', 'ignore']);
  });

  it('emits claim + snooze for a chore', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'chore' })).map((a) => a.action))
      .toEqual(['claim', 'snooze']);
  });

  it('emits done + snooze for a reminder', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'reminder' })).map((a) => a.action))
      .toEqual(['done', 'snooze']);
  });

  it('reads kind from event.type when payload.kind is absent', () => {
    const row = mkRow({ type: 'ask', payload: { kind: undefined } });
    expect(actionsForStreamRow(row).map((a) => a.action)).toEqual(['help', 'ignore']);
  });

  it('normalises case (KIND, Kind, kind)', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'ASK' })).map((a) => a.action))
      .toEqual(['help', 'ignore']);
  });

  it('threads rowId + circleId + kind through the payload', () => {
    const row = mkRow({ id: 'r-42', circleId: 'huisgenoten', kind: 'chore' });
    const actions = actionsForStreamRow(row);
    expect(actions[0].payload).toEqual({
      rowId: 'r-42', circleId: 'huisgenoten', kind: 'chore', ref: null,
    });
    expect(actions[0].id).toBe('r-42-claim');
  });

  it('passes through a payload.ref when present (e.g. itemRef)', () => {
    const row = mkRow({ kind: 'ask', payload: { ref: 'item-99' } });
    expect(actionsForStreamRow(row)[0].payload.ref).toBe('item-99');
  });

  // ── Mandate ("entrust") — owner-only action on task-like rows ────────────────
  describe('mandate (entrust) action', () => {
    it('is absent by default (no viewer signals) — backwards-compatible', () => {
      expect(actionsForStreamRow(mkRow({ kind: 'chore' })).map((a) => a.action))
        .toEqual(['claim', 'snooze']);
      expect(actionsForStreamRow(mkRow({ kind: 'reminder' })).map((a) => a.action))
        .toEqual(['done', 'snooze']);
    });

    it('appears for a circle admin on task/chore/reminder', () => {
      for (const kind of ['task', 'chore', 'reminder']) {
        const actions = actionsForStreamRow(mkRow({ kind }), { isAdmin: true });
        expect(actions.map((a) => a.action)).toContain('mandate');
      }
    });

    it('appears for the row author (isOwn)', () => {
      const actions = actionsForStreamRow(mkRow({ kind: 'chore' }), { isOwn: true });
      expect(actions.map((a) => a.action)).toContain('mandate');
    });

    it('appears when the viewer WebID matches the row creator', () => {
      const row = mkRow({ kind: 'chore', payload: { addedBy: 'https://me.example/#me' } });
      const actions = actionsForStreamRow(row, { viewerWebid: 'https://me.example/#me' });
      expect(actions.map((a) => a.action)).toContain('mandate');
    });

    it('is hidden for a non-owner (different WebID, not admin, not own)', () => {
      const row = mkRow({ kind: 'chore', payload: { addedBy: 'https://alice.example/#me' } });
      const actions = actionsForStreamRow(row, { viewerWebid: 'https://bob.example/#me' });
      expect(actions.map((a) => a.action)).not.toContain('mandate');
    });

    it('is hidden when ownership cannot be affirmed (no creator, no viewer)', () => {
      const actions = actionsForStreamRow(mkRow({ kind: 'chore' }), { viewerWebid: 'https://me.example/#me' });
      expect(actions.map((a) => a.action)).not.toContain('mandate');
    });

    it('never appears on non-task kinds even for an admin', () => {
      for (const kind of ['question', 'offer', 'lend']) {
        const actions = actionsForStreamRow(mkRow({ kind }), { isAdmin: true });
        expect(actions.map((a) => a.action)).not.toContain('mandate');
      }
    });

    it('carries the taskId (row ref) in the mandate payload', () => {
      const row = mkRow({ id: 'r-7', kind: 'chore', payload: { ref: 'task-42' } });
      const mandate = actionsForStreamRow(row, { isAdmin: true }).find((a) => a.action === 'mandate');
      expect(mandate.payload.taskId).toBe('task-42');
      expect(mandate.payload.ref).toBe('task-42');
      expect(mandate.id).toBe('r-7-mandate');
      expect(mandate.label).toBe('circle.streamAction.mandate');
    });

    it('offers entrust on a bare task kind (no chips of its own)', () => {
      const actions = actionsForStreamRow(mkRow({ kind: 'task' }), { isAdmin: true });
      expect(actions.map((a) => a.action)).toEqual(['mandate']);
    });

    // ── First-class provenance (the projection stamps row.taskId + row.addedBy) ──
    // The owner check is now DETERMINISTIC: the actual creator sees entrust even
    // when they are NOT an admin, straight off the row's stamped provenance.
    describe('exact provenance (row.addedBy / row.taskId)', () => {
      it('the creator (non-admin) sees entrust from first-class row.addedBy', () => {
        const row = { id: 'r1', circleId: 'c', type: 'chore', addedBy: 'https://me.example/#me', taskId: 'task-77', event: { type: 'chore', payload: { kind: 'chore' } } };
        const actions = actionsForStreamRow(row, { viewerWebid: 'https://me.example/#me', isAdmin: false });
        expect(actions.map((a) => a.action)).toContain('mandate');
      });

      it('a non-owner still does not see entrust despite provenance', () => {
        const row = { id: 'r1', circleId: 'c', type: 'chore', addedBy: 'https://alice.example/#me', taskId: 'task-77', event: { type: 'chore', payload: { kind: 'chore' } } };
        const actions = actionsForStreamRow(row, { viewerWebid: 'https://bob.example/#me', isAdmin: false });
        expect(actions.map((a) => a.action)).not.toContain('mandate');
      });

      it('the mandate payload carries the first-class row.taskId (preferred over the ref)', () => {
        const row = { id: 'r1', circleId: 'c', type: 'chore', addedBy: 'https://me.example/#me', taskId: 'task-77', event: { type: 'chore', payload: { kind: 'chore', ref: 'stale-ref' } } };
        const mandate = actionsForStreamRow(row, { isAdmin: true }).find((a) => a.action === 'mandate');
        expect(mandate.payload.taskId).toBe('task-77');
      });
    });
  });
});

describe('buildStreamComposeContext', () => {
  const t = (key, vars = {}) => {
    if (key === 'circle.stream.compose_placeholder_targeted') return `Reply in ${vars.circle}`;
    if (key === 'circle.stream.compose_placeholder_default')  return `Reply in the timeline`;
    return key;
  };

  it('returns the default placeholder when no row is focused', () => {
    const ctx = buildStreamComposeContext({ focusedRow: null, t });
    expect(ctx).toEqual({
      targetCircleId: null, targetCircleName: null,
      placeholder: 'Reply in the timeline', replyToId: null,
    });
  });

  it('returns the targeted placeholder + threads circleId/replyToId when focused', () => {
    const row = { id: 'r-1', circleId: 'selwerd', circleName: 'Selwerd' };
    const ctx = buildStreamComposeContext({ focusedRow: row, t });
    expect(ctx).toEqual({
      targetCircleId: 'selwerd', targetCircleName: 'Selwerd',
      placeholder: 'Reply in Selwerd', replyToId: 'r-1',
    });
  });

  it('falls back to the default placeholder when circleName is absent', () => {
    const ctx = buildStreamComposeContext({ focusedRow: { id: 'x', circleId: 'c' }, t });
    expect(ctx.placeholder).toBe('Reply in the timeline');
  });

  it('uses key identity without a translator', () => {
    const ctx = buildStreamComposeContext({ focusedRow: null });
    expect(ctx.placeholder).toBe('circle.stream.compose_placeholder_default');
  });
});
