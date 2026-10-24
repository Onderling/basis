/**
 * taskDetail unit tests — exercise the portable glue the web
 * `task.html` page and the mobile `TaskDetailScreen.jsx` both consume.
 *
 * Mirrors `chatThread.test.js` style.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTaskLocation,
  findTaskById,
  lastReviewWasRevoke,
  deriveTaskActions,
  formatReviewEntry,
  shortWebid,
} from '../../src/ui/taskDetail.js';

const ANNE  = 'https://id.example/anne';   // assignee
const BOB   = 'https://id.example/bob';    // master / author
const CARLA = 'https://id.example/carla';  // admin
const DAVE  = 'https://id.example/dave';   // unrelated member

describe('taskDetail.parseTaskLocation', () => {
  it('parses URLSearchParams', () => {
    const p = new URLSearchParams('taskId=t-123');
    expect(parseTaskLocation(p)).toEqual({ taskId: 't-123' });
  });
  it('parses plain objects', () => {
    expect(parseTaskLocation({ taskId: 't-7' })).toEqual({ taskId: 't-7' });
  });
  it('returns null when taskId is missing', () => {
    expect(parseTaskLocation(null)).toBeNull();
    expect(parseTaskLocation(undefined)).toBeNull();
    expect(parseTaskLocation({})).toBeNull();
    expect(parseTaskLocation(new URLSearchParams(''))).toBeNull();
    expect(parseTaskLocation({ other: 'x' })).toBeNull();
  });
});

describe('taskDetail.findTaskById', () => {
  const open   = [{ id: 't-1', text: 'one' }, { id: 't-2', text: 'two' }];
  const closed = [{ id: 't-9', text: 'done', completedAt: 1 }];

  it('finds an open task by id', () => {
    expect(findTaskById('t-2', { open, closed })?.text).toBe('two');
  });
  it('falls through to the closed list', () => {
    expect(findTaskById('t-9', { open, closed })?.text).toBe('done');
  });
  it('returns null on miss', () => {
    expect(findTaskById('t-nope', { open, closed })).toBeNull();
  });
  it('tolerates missing sources', () => {
    expect(findTaskById('t-1', { open })?.text).toBe('one');
    expect(findTaskById('t-1', {})).toBeNull();
    expect(findTaskById('t-1')).toBeNull();
  });
  it('returns null on bad taskId', () => {
    expect(findTaskById('',   { open, closed })).toBeNull();
    expect(findTaskById(null, { open, closed })).toBeNull();
    expect(findTaskById(42,   { open, closed })).toBeNull();
  });
});

describe('taskDetail.lastReviewWasRevoke', () => {
  it('true when the last reviewLog entry is a revoke', () => {
    expect(lastReviewWasRevoke({
      reviewLog: [{ decision: 'submit' }, { decision: 'revoke', at: 5 }],
    })).toBe(true);
  });
  it('false when the last entry is anything else', () => {
    expect(lastReviewWasRevoke({
      reviewLog: [{ decision: 'revoke' }, { decision: 'submit' }],
    })).toBe(false);
  });
  it('false on empty / missing log', () => {
    expect(lastReviewWasRevoke({ reviewLog: [] })).toBe(false);
    expect(lastReviewWasRevoke({})).toBe(false);
    expect(lastReviewWasRevoke(null)).toBe(false);
  });
});

describe('taskDetail.deriveTaskActions — claim / submit / mark complete', () => {
  it('canClaim only for ready+unassigned', () => {
    const ready = { status: 'ready', assignee: null, addedBy: BOB };
    expect(deriveTaskActions(ready, ANNE, 'member').canClaim).toBe(true);

    const claimed = { status: 'claimed', assignee: ANNE, addedBy: BOB };
    expect(deriveTaskActions(claimed, ANNE, 'member').canClaim).toBe(false);
  });

  it('canMarkComplete for assignee + claimed + self-mark', () => {
    const task = {
      status: 'claimed', assignee: ANNE, addedBy: BOB, approval: 'self-mark',
    };
    const a = deriveTaskActions(task, ANNE, 'member');
    expect(a.canMarkComplete).toBe(true);
    expect(a.canSubmit).toBe(false);
  });

  it('canSubmit when approval is non-self-mark', () => {
    const task = {
      status: 'claimed', assignee: ANNE, addedBy: BOB, approval: 'creator',
    };
    const a = deriveTaskActions(task, ANNE, 'member');
    expect(a.canSubmit).toBe(true);
    expect(a.canMarkComplete).toBe(false);
  });

  it('non-assignee never sees submit / mark-complete', () => {
    const task = {
      status: 'claimed', assignee: ANNE, addedBy: BOB, approval: 'self-mark',
    };
    const a = deriveTaskActions(task, DAVE, 'member');
    expect(a.canSubmit).toBe(false);
    expect(a.canMarkComplete).toBe(false);
  });

  it('canSubmit on rejected for re-submission', () => {
    const task = {
      status: 'rejected', assignee: ANNE, addedBy: BOB, approval: 'creator',
    };
    expect(deriveTaskActions(task, ANNE, 'member').canSubmit).toBe(true);
  });
});

describe('taskDetail.deriveTaskActions — approve / reject', () => {
  it('approver sees approve+reject when submitted', () => {
    // approval === 'creator' makes the master the approver.
    const task = {
      status: 'submitted', assignee: ANNE, addedBy: BOB, approval: 'creator',
    };
    expect(deriveTaskActions(task, BOB, 'member').canApproveReject).toBe(true);
  });
  it('admin can always approve a submitted task', () => {
    const task = {
      status: 'submitted', assignee: ANNE, addedBy: BOB, approval: 'creator',
    };
    expect(deriveTaskActions(task, CARLA, 'admin').canApproveReject).toBe(true);
  });
  it('random member cannot approve', () => {
    const task = {
      status: 'submitted', assignee: ANNE, addedBy: BOB, approval: 'creator',
    };
    expect(deriveTaskActions(task, DAVE, 'member').canApproveReject).toBe(false);
  });
});

describe('taskDetail.deriveTaskActions — edit / revoke / reassign / remove', () => {
  const claimed = {
    status: 'claimed', assignee: ANNE, addedBy: BOB, master: BOB,
  };

  it('canEdit for the author while still mutable', () => {
    expect(deriveTaskActions(claimed, BOB, 'member').canEdit).toBe(true);
  });
  it('canEdit for admin even when not the author', () => {
    expect(deriveTaskActions(claimed, CARLA, 'admin').canEdit).toBe(true);
  });
  it('canEdit false after submission', () => {
    const submitted = { ...claimed, status: 'submitted' };
    expect(deriveTaskActions(submitted, BOB, 'member').canEdit).toBe(false);
  });
  it('canRevoke for the master on claimed', () => {
    expect(deriveTaskActions(claimed, BOB, 'member').canRevoke).toBe(true);
  });
  it('canReassign only for admin/coord', () => {
    expect(deriveTaskActions(claimed, CARLA, 'admin').canReassign).toBe(true);
    expect(deriveTaskActions(claimed, CARLA, 'coordinator').canReassign).toBe(true);
    expect(deriveTaskActions(claimed, BOB,  'member').canReassign).toBe(false);
  });
  it('canRemove only for admin', () => {
    expect(deriveTaskActions(claimed, CARLA, 'admin').canRemove).toBe(true);
    expect(deriveTaskActions(claimed, CARLA, 'coordinator').canRemove).toBe(false);
  });
  it('non-master non-admin sees no admin CTAs', () => {
    const a = deriveTaskActions(claimed, DAVE, 'member');
    expect(a.canEdit).toBe(false);
    expect(a.canRevoke).toBe(false);
    expect(a.canReassign).toBe(false);
    expect(a.canRemove).toBe(false);
  });
});

describe('taskDetail.deriveTaskActions — appeal + force-complete', () => {
  it('canAppeal when last reviewLog entry is a revoke', () => {
    const task = {
      status: 'rejected', assignee: null, addedBy: BOB,
      reviewLog: [{ decision: 'revoke', by: BOB }],
    };
    expect(deriveTaskActions(task, ANNE, 'member').canAppeal).toBe(true);
  });
  it('canForceComplete for admin when deps are blocking', () => {
    const task = {
      status: 'claimed', assignee: ANNE, addedBy: BOB,
      openDeps: ['t-dep'],
    };
    expect(deriveTaskActions(task, CARLA, 'admin').canForceComplete).toBe(true);
    expect(deriveTaskActions(task, ANNE,  'member').canForceComplete).toBe(false);
  });
  it('canForceComplete false when no open deps', () => {
    const task = { status: 'claimed', assignee: ANNE, addedBy: BOB };
    expect(deriveTaskActions(task, CARLA, 'admin').canForceComplete).toBe(false);
  });
});

describe('taskDetail.deriveTaskActions — null task / bad input', () => {
  it('returns all-false for null task', () => {
    const a = deriveTaskActions(null, ANNE, 'admin');
    expect(Object.values(a).every((v) => v === false)).toBe(true);
  });
});

describe('taskDetail.formatReviewEntry', () => {
  it('extracts action + by + note', () => {
    const r = formatReviewEntry({
      action: 'reject', by: BOB, note: 'redo it', at: 100,
    });
    expect(r).toEqual({ action: 'reject', by: BOB, note: 'redo it', at: 100 });
  });
  it('falls back to decision when action is missing', () => {
    const r = formatReviewEntry({ decision: 'revoke', actor: BOB });
    expect(r.action).toBe('revoke');
    expect(r.by).toBe(BOB);
  });
  it('returns sane defaults for null', () => {
    expect(formatReviewEntry(null)).toEqual({
      action: '', by: '', note: '', at: null,
    });
  });
});

describe('taskDetail.shortWebid', () => {
  it('keeps the last segment, caps at 14 chars', () => {
    expect(shortWebid('https://id.example/anne')).toBe('anne');
    expect(shortWebid('did:key:abcdefghijklmnopqrstuvwxyz')).toBe('did:key:abcdef…');
  });
  it('returns "" for non-strings', () => {
    expect(shortWebid(null)).toBe('');
    expect(shortWebid(42)).toBe('');
  });
});

