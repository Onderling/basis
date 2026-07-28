import { describe, it, expect } from 'vitest';
import {
  eventCircleId, buildCircleStream, buildCircleChat,
  buildKringStream, KRING_STREAM_KIND_FILTERS,
  projectEntries, allCircleRows, circleRows, chatRows, agentTrailRows,
} from '../../src/v2/circleStream.js';
import { makeSilentEntry, makeAgentTrailEntry } from '../../src/eventLog.js';

const circles = [
  { id: 'circle-1', name: 'Garden circle' },
  { id: 'grp-9',  name: 'Block 9' },
];

describe('eventCircleId', () => {
  it('reads circleId / circleId / groupId / buurtId off the payload', () => {
    expect(eventCircleId({ payload: { circleId: 'circle-1' } })).toBe('circle-1');
    expect(eventCircleId({ payload: { circleId: 'circle-1' } })).toBe('circle-1');
    expect(eventCircleId({ payload: { groupId: 'grp-9' } })).toBe('grp-9');
    expect(eventCircleId({ payload: { buurtId: 'grp-9' } })).toBe('grp-9');
  });

  it('falls back to itemRef.circleId, else null', () => {
    expect(eventCircleId({ itemRef: { circleId: 'grp-9' } })).toBe('grp-9');
    expect(eventCircleId({ payload: {} })).toBeNull();
    expect(eventCircleId({})).toBeNull();
    expect(eventCircleId(null)).toBeNull();
  });

  // C15 — a first-class top-level circleId is read DIRECTLY, ahead of the
  // payload dig (which stays as the back-compat fallback for older entries).
  it('reads a first-class top-level circleId ahead of the payload dig', () => {
    expect(eventCircleId({ circleId: 'circle-1', payload: { groupId: 'grp-9' } })).toBe('circle-1');
    expect(eventCircleId({ circleId: 'circle-1' })).toBe('circle-1');
    // absent top-level → still digs the payload (unchanged behaviour)
    expect(eventCircleId({ payload: { circleId: 'circle-1' } })).toBe('circle-1');
  });
});

describe('C15 silent system-entry lane', () => {
  const chatEvent = { id: 'c1', ts: 200, app: 'kring', type: 'chat-message', payload: { circleId: 'circle-1', text: 'hi', kind: 'chat-message' } };
  const silent = makeSilentEntry({ circleId: 'circle-1', kind: 'membership-changed', payload: { who: 'ann' }, id: 's1', ts: 100 });

  it('buildCircleStream (the firehose) INCLUDES silent entries, tagged by first-class circleId', () => {
    const rows = buildCircleStream({ events: [chatEvent, silent], circles });
    expect(rows.map((r) => r.id)).toEqual(['c1', 's1']);         // both present, newest-first
    const srow = rows.find((r) => r.id === 's1');
    expect(srow.circleId).toBe('circle-1');                       // read from the first-class field
    expect(srow.circleName).toBe('Garden circle');
  });

  it('buildCircleChat EXCLUDES silent entries (chat stays a chat)', () => {
    const rows = buildCircleChat({ events: [chatEvent, silent], circles, circleId: 'circle-1' });
    expect(rows.map((r) => r.id)).toEqual(['c1']);               // silent dropped, chat kept
  });

  it('buildCircleChat is behaviour-preserving when there are no silent entries', () => {
    const events = [chatEvent, { id: 'c2', ts: 50, app: 'kring', type: 'chat-message', payload: { circleId: 'circle-1', text: 'yo' } }];
    expect(buildCircleChat({ events, circles, circleId: 'circle-1' }).map((r) => r.id))
      .toEqual(buildKringStream({ events, circles, circleId: 'circle-1' }).map((r) => r.id));
  });
});

describe('buildCircleStream', () => {
  it('tags each event with its circle name and keeps newest-first', () => {
    const events = [
      { id: 'e1', ts: 300, app: 'stoop',    type: 'buurt-post',   payload: { groupId: 'grp-9' } },
      { id: 'e2', ts: 100, app: 'tasks', type: 'task-claimed', payload: { circleId: 'circle-1' } },
      { id: 'e3', ts: 200, app: 'household',type: 'note-added',   payload: {} },
    ];
    const rows = buildCircleStream({ events, circles });
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e3', 'e2']); // ts desc
    expect(rows[0]).toMatchObject({ circleId: 'grp-9', circleName: 'Block 9', app: 'stoop' });
    expect(rows[2]).toMatchObject({ circleId: 'circle-1', circleName: 'Garden circle' });
  });

  it('keeps un-scoped events (no circle) untagged rather than dropping them', () => {
    const events = [{ id: 'e3', ts: 200, app: 'household', type: 'note-added', payload: {} }];
    const [row] = buildCircleStream({ events, circles });
    expect(row.circleId).toBeNull();
    expect(row.circleName).toBeNull();
  });

  it('tolerates an unknown circleId (tag id kept, name null)', () => {
    const events = [{ id: 'e9', ts: 1, app: 'stoop', type: 'x', payload: { circleId: 'ghost' } }];
    const [row] = buildCircleStream({ events, circles });
    expect(row.circleId).toBe('ghost');
    expect(row.circleName).toBeNull();
  });

  it('returns [] for empty / missing inputs', () => {
    expect(buildCircleStream()).toEqual([]);
    expect(buildCircleStream({ events: [], circles: [] })).toEqual([]);
    expect(buildCircleStream({ events: [null, undefined] })).toEqual([]);
  });

  // First-class task provenance (taskId + addedBy) so the owner-only entrust
  // check downstream is DETERMINISTIC, not a best-effort payload dig.
  describe('task provenance (taskId + addedBy)', () => {
    it('stamps taskId + addedBy on task/chore/reminder rows', () => {
      const events = [
        { id: 'e1', ts: 3, app: 'tasks', type: 'buurt-post', payload: { circleId: 'circle-1', kind: 'chore', ref: 'task-77', addedBy: 'https://me.example/#me' } },
        { id: 'e2', ts: 2, app: 'tasks', type: 'task', payload: { circleId: 'circle-1', taskId: 'task-9', creator: 'https://al.example/#me' } },
        { id: 'e3', ts: 1, app: 'tasks', type: 'reminder', payload: { circleId: 'circle-1' } },
      ];
      const rows = buildCircleStream({ events, circles });
      expect(rows[0]).toMatchObject({ taskId: 'task-77', addedBy: 'https://me.example/#me' });
      expect(rows[1]).toMatchObject({ taskId: 'task-9', addedBy: 'https://al.example/#me' });
      // A task-like row with no creator present still stamps the fields (null), so
      // the projection contract is uniform.
      expect(rows[2]).toMatchObject({ taskId: null, addedBy: null });
    });

    it('does NOT add provenance fields to non-task rows (backwards-compatible)', () => {
      const events = [{ id: 'e1', ts: 1, app: 'stoop', type: 'buurt-post', payload: { circleId: 'circle-1', kind: 'question', ref: 'q-1' } }];
      const [row] = buildCircleStream({ events, circles });
      expect(row).not.toHaveProperty('taskId');
      expect(row).not.toHaveProperty('addedBy');
    });
  });
});

describe('buildKringStream (SP-13)', () => {
  const events = [
    { id: 'a', ts: 300, app: 'stoop',    type: 'buurt-post', payload: { groupId: 'grp-9',  kind: 'vraag' } },
    { id: 'b', ts: 250, app: 'stoop',    type: 'buurt-post', payload: { groupId: 'grp-9',  kind: 'aanbod' } },
    { id: 'c', ts: 200, app: 'stoop',    type: 'buurt-post', payload: { groupId: 'grp-9',  kind: 'leen' } },
    { id: 'd', ts: 150, app: 'stoop',    type: 'buurt-post', payload: { groupId: 'circle-1', kind: 'vraag' } },
    { id: 'e', ts: 100, app: 'tasks', type: 'task-claimed', payload: { circleId: 'circle-1' } },
    { id: 'f', ts:  50, app: 'household',type: 'note-added',   payload: {} },
  ];

  it('exposes the canonical chip set', () => {
    expect(KRING_STREAM_KIND_FILTERS).toEqual(['all', 'vraag', 'aanbod', 'leen']);
  });

  it('with circleId narrows to that kring (newest first)', () => {
    const rows = buildKringStream({ events, circles, circleId: 'grp-9' });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('with no circleId returns the full cross-kring stream', () => {
    expect(buildKringStream({ events, circles }).map((r) => r.id))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('with kindFilter narrows to that kind only', () => {
    expect(buildKringStream({ events, circles, circleId: 'grp-9', kindFilter: 'vraag' })
      .map((r) => r.id)).toEqual(['a']);
    expect(buildKringStream({ events, circles, circleId: 'grp-9', kindFilter: 'aanbod' })
      .map((r) => r.id)).toEqual(['b']);
  });

  it('treats kindFilter=null / "all" as no filter', () => {
    const expected = ['a', 'b', 'c'];
    expect(buildKringStream({ events, circles, circleId: 'grp-9', kindFilter: null })
      .map((r) => r.id)).toEqual(expected);
    expect(buildKringStream({ events, circles, circleId: 'grp-9', kindFilter: 'all' })
      .map((r) => r.id)).toEqual(expected);
  });

  it('unknown kind → no rows (helper does not invent)', () => {
    expect(buildKringStream({ events, circles, circleId: 'grp-9', kindFilter: 'nope' }))
      .toEqual([]);
  });

  it('unknown circle → no rows', () => {
    expect(buildKringStream({ events, circles, circleId: 'ghost' })).toEqual([]);
  });
});

/**
 * One projector, two axes (C15 slice 2, 2026-07-27).
 *
 * There used to be three functions whose names hid what differed — and two were the same word in two
 * languages (`buildCircleStream` / `buildKringStream`; *kring* IS circle), so a reader could not tell which
 * selected a SCOPE and which selected CONTENT. These pin the axes, and that the wrappers are genuinely the
 * same function with different arguments.
 */
describe('projectEntries — scope × content', () => {
  const circles = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
  const ev = (id, circleId, type, extra = {}) => ({ id, ts: id.length, app: 'a', type, circleId, ...extra });
  const events = [
    ev('m1', 'x', 'chat-message'),
    ev('m22', 'y', 'chat-message'),
    { ...ev('g333', 'x', 'governance'), silent: true },
    ev('t4444', 'y', 'task'),
  ];

  it('scope: null = every circle', () => {
    expect(projectEntries({ events, circles }).map((r) => r.id).sort())
      .toEqual(['g333', 'm1', 'm22', 't4444']);
  });

  it('scope: one circle', () => {
    expect(projectEntries({ events, circles, circleId: 'x' }).map((r) => r.id).sort()).toEqual(['g333', 'm1']);
  });

  it('scope: a LIST of circles — one call, no hand-rolled merge', () => {
    // This is what let `userScreenBlocks` stop looping per circle and merging by hand.
    const rows = projectEntries({ events, circles, circleId: ['x', 'y'] });
    expect(rows).toHaveLength(4);
  });

  it('content: lane human drops the system lane', () => {
    expect(projectEntries({ events, circles, lane: 'human' }).map((r) => r.id)).not.toContain('g333');
  });

  it('content: explicit kinds', () => {
    expect(projectEntries({ events, circles, kinds: ['task'] }).map((r) => r.id)).toEqual(['t4444']);
  });

  it('the two axes compose', () => {
    expect(projectEntries({ events, circles, circleId: 'y', kinds: ['chat-message'] }).map((r) => r.id))
      .toEqual(['m22']);
  });
});

describe('the wrappers are the projector with arguments', () => {
  const circles = [{ id: 'x', name: 'X' }];
  const events = [
    { id: 'a', ts: 2, app: 'k', type: 'chat-message', circleId: 'x' },
    { id: 'b', ts: 1, app: 'k', type: 'governance', circleId: 'x', silent: true },
  ];

  it('allCircleRows ignores scope; chatRows drops the system lane; circleRows keeps both', () => {
    expect(allCircleRows({ events, circles }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(circleRows({ events, circles, circleId: 'x' }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(chatRows({ events, circles, circleId: 'x' }).map((r) => r.id)).toEqual(['a']);
  });

  it('the old names still work — this is a rename, not a migration', () => {
    expect(buildKringStream({ events, circles, circleId: 'x' })).toEqual(circleRows({ events, circles, circleId: 'x' }));
    expect(buildCircleChat({ events, circles, circleId: 'x' })).toEqual(chatRows({ events, circles, circleId: 'x' }));
  });
});

/* ── The agent-trail LENS (one-log step E): the same log, narrowed to one actor ─────────────────────── */

describe('agentTrailRows — the trail is a lens, not a second store (J-L6/J-L7)', () => {
  const events = [
    makeAgentTrailEntry({ actor: 'bot-x', op: 'addItems', via: 'grant:g9', circleId: 'c1', ts: 30, id: 't1' }),
    makeAgentTrailEntry({ actor: 'bot-x', op: 'setRelayUrl', kind: 'settings-change', via: 'mandate:task-7', circleId: null, ts: 20, id: 't2' }),
    makeAgentTrailEntry({ actor: 'bot-y', op: 'addItems', via: 'owner', circleId: 'c1', ts: 10, id: 't3' }),
    { id: 'm1', ts: 5, app: 'kring', type: 'chat-message', actor: 'anna', payload: { circleId: 'c1', text: 'hoi' } },
  ];
  const circles = [{ id: 'c1', name: 'Kring 1' }];

  it("one actor's rows, every circle + the un-scoped ones, newest first, via readable per row", () => {
    const rows = agentTrailRows({ events, circles, actor: 'bot-x' });
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(rows[0].circleName).toBe('Kring 1');
    expect(rows[1].circleId).toBeNull();               // a non-circle action still shows in the trail
    // J-L7 — `via` records the AUTHORITY, so the answer survives the grant's revocation.
    expect(rows.map((r) => r.event.payload.via)).toEqual(['grant:g9', 'mandate:task-7']);
  });

  it('no actor = no trail — never the whole firehose', () => {
    expect(agentTrailRows({ events, circles })).toEqual([]);
  });

  it('projectEntries composes actor with the other narrowings (scope × kinds still work)', () => {
    const rows = projectEntries({ events, circles, actor: 'bot-x', kinds: ['agent-action'] });
    expect(rows.map((r) => r.id)).toEqual(['t1']);
  });
});
