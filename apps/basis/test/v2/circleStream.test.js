import { describe, it, expect } from 'vitest';
import {
  eventCircleId, buildCircleStream, buildCircleChat,
  CIRCLE_STREAM_KIND_FILTERS,
  projectEntries, allCircleRows, circleRows, chatRows, agentTrailRows,
} from '../../src/v2/circleStream.js';
import { makeSilentEntry, makeAgentTrailEntry } from '../../src/eventLog.js';

const circles = [
  { id: 'circle-1', name: 'Garden circle' },
  { id: 'grp-9',  name: 'Block 9' },
];

describe('eventCircleId', () => {
  it('reads circleId / circleId / groupId / circleId off the payload', () => {
    expect(eventCircleId({ payload: { circleId: 'circle-1' } })).toBe('circle-1');
    expect(eventCircleId({ payload: { circleId: 'circle-1' } })).toBe('circle-1');
    expect(eventCircleId({ payload: { groupId: 'grp-9' } })).toBe('grp-9');
    expect(eventCircleId({ payload: { circleId: 'grp-9' } })).toBe('grp-9');
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
  const chatEvent = { id: 'c1', ts: 200, app: 'circle', type: 'chat-message', payload: { circleId: 'circle-1', text: 'hi', kind: 'chat-message' } };
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
    const events = [chatEvent, { id: 'c2', ts: 50, app: 'circle', type: 'chat-message', payload: { circleId: 'circle-1', text: 'yo' } }];
    expect(buildCircleChat({ events, circles, circleId: 'circle-1' }).map((r) => r.id))
      .toEqual(circleRows({ events, circles, circleId: 'circle-1' }).map((r) => r.id));
  });
});

describe('buildCircleStream', () => {
  it('tags each event with its circle name and keeps newest-first', () => {
    const events = [
      { id: 'e1', ts: 300, app: 'stoop',    type: 'circle-post',   payload: { groupId: 'grp-9' } },
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
        { id: 'e1', ts: 3, app: 'tasks', type: 'circle-post', payload: { circleId: 'circle-1', kind: 'chore', ref: 'task-77', addedBy: 'https://me.example/#me' } },
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
      const events = [{ id: 'e1', ts: 1, app: 'stoop', type: 'circle-post', payload: { circleId: 'circle-1', kind: 'question', ref: 'q-1' } }];
      const [row] = buildCircleStream({ events, circles });
      expect(row).not.toHaveProperty('taskId');
      expect(row).not.toHaveProperty('addedBy');
    });
  });
});

describe('circleRows (SP-13)', () => {
  const events = [
    { id: 'a', ts: 300, app: 'stoop',    type: 'circle-post', payload: { groupId: 'grp-9',  kind: 'ask' } },
    { id: 'b', ts: 250, app: 'stoop',    type: 'circle-post', payload: { groupId: 'grp-9',  kind: 'offer' } },
    { id: 'c', ts: 200, app: 'stoop',    type: 'circle-post', payload: { groupId: 'grp-9',  kind: 'lend' } },
    { id: 'd', ts: 150, app: 'stoop',    type: 'circle-post', payload: { groupId: 'circle-1', kind: 'ask' } },
    { id: 'e', ts: 100, app: 'tasks', type: 'task-claimed', payload: { circleId: 'circle-1' } },
    { id: 'f', ts:  50, app: 'household',type: 'note-added',   payload: {} },
  ];

  it('exposes the canonical chip set', () => {
    expect(CIRCLE_STREAM_KIND_FILTERS).toEqual(['all', 'ask', 'offer', 'lend']);
  });

  it('with circleId narrows to that circle (newest first)', () => {
    const rows = circleRows({ events, circles, circleId: 'grp-9' });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('with no circleId returns the full cross-circle stream', () => {
    expect(circleRows({ events, circles }).map((r) => r.id))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('with kindFilter narrows to that kind only', () => {
    expect(circleRows({ events, circles, circleId: 'grp-9', kindFilter: 'ask' })
      .map((r) => r.id)).toEqual(['a']);
    expect(circleRows({ events, circles, circleId: 'grp-9', kindFilter: 'offer' })
      .map((r) => r.id)).toEqual(['b']);
  });

  it('treats kindFilter=null / "all" as no filter', () => {
    const expected = ['a', 'b', 'c'];
    expect(circleRows({ events, circles, circleId: 'grp-9', kindFilter: null })
      .map((r) => r.id)).toEqual(expected);
    expect(circleRows({ events, circles, circleId: 'grp-9', kindFilter: 'all' })
      .map((r) => r.id)).toEqual(expected);
  });

  it('unknown kind → no rows (helper does not invent)', () => {
    expect(circleRows({ events, circles, circleId: 'grp-9', kindFilter: 'nope' }))
      .toEqual([]);
  });

  it('unknown circle → no rows', () => {
    expect(circleRows({ events, circles, circleId: 'ghost' })).toEqual([]);
  });
});

/**
 * One projector, two axes (C15 slice 2, 2026-07-27).
 *
 * There used to be three functions whose names hid what differed — and two were the same word in two
 * languages (`buildCircleStream` / `circleRows`; *circle* IS circle), so a reader could not tell which
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
    expect(circleRows({ events, circles, circleId: 'x' })).toEqual(circleRows({ events, circles, circleId: 'x' }));
    expect(buildCircleChat({ events, circles, circleId: 'x' })).toEqual(chatRows({ events, circles, circleId: 'x' }));
  });
});

/* ── The agent-trail LENS (one-log step E): the same log, narrowed to one actor ─────────────────────── */

describe('agentTrailRows — the trail is a lens, not a second store (J-L6/J-L7)', () => {
  const events = [
    makeAgentTrailEntry({ actor: 'bot-x', op: 'addItems', via: 'grant:g9', circleId: 'c1', ts: 30, id: 't1' }),
    makeAgentTrailEntry({ actor: 'bot-x', op: 'setRelayUrl', kind: 'settings-change', via: 'mandate:task-7', circleId: null, ts: 20, id: 't2' }),
    makeAgentTrailEntry({ actor: 'bot-y', op: 'addItems', via: 'owner', circleId: 'c1', ts: 10, id: 't3' }),
    { id: 'm1', ts: 5, app: 'circle', type: 'chat-message', actor: 'anna', payload: { circleId: 'c1', text: 'hoi' } },
  ];
  const circles = [{ id: 'c1', name: 'Circle 1' }];

  it("one actor's rows, every circle + the un-scoped ones, newest first, via readable per row", () => {
    const rows = agentTrailRows({ events, circles, actor: 'bot-x' });
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(rows[0].circleName).toBe('Circle 1');
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

// ── Membership notices are RENDERED from the log, never appended ──────────────────────────────────────
// A removed member's device used to be told by a second entry that repeated what the evict statement
// already said (and the phone never got even that). The statement IS the notice; the conversation
// projection renders the ones that concern the viewer. Nothing is written, so nothing can be said twice.
describe('chatRows — membership notices as rendered projections (2026-08-29)', () => {
  const t = (key, args = {}) => `${key}${args.name ? `:${args.name}` : ''}`;
  const membership = (id, body, ts = 100) => ({
    id: `membership:${id}`, ts, app: 'basis', type: 'membership', circleId: 'k1',
    payload: { body: { kind: body.kind, subject: body.subject, author: body.author, payload: body.payload ?? {} }, sig: 'x' },
  });
  const chat = { id: 'c1', ts: 50, app: 'circle', type: 'chat-message', actor: 'alice', payload: { circleId: 'k1', text: 'hoi', kind: 'chat-message' } };

  it('renders "you were removed" for an evict whose subject is the viewer', () => {
    const rows = chatRows({ events: [chat, membership('e1', { kind: 'evict', subject: 'me', author: 'admin' })], circleId: 'k1', viewerId: 'me', t });
    const notice = rows.find((r) => r.actor === 'bot');
    expect(notice, 'a bot row is projected from the evict statement').toBeTruthy();
    expect(notice.event.payload.text).toBe('circle.membership.you_were_removed');
    expect(notice.event.payload.scope).toBe('self');
    expect(rows.some((r) => r.id === 'c1'), 'the chat row is still there').toBe(true);
  });

  it('says nothing about an evict of someone else, and nothing about my own leave', () => {
    const rows = chatRows({ events: [
      membership('e2', { kind: 'evict', subject: 'bob', author: 'admin' }),
      membership('e3', { kind: 'evict', subject: 'me', author: 'me' }),
    ], circleId: 'k1', viewerId: 'me', t });
    expect(rows.filter((r) => r.actor === 'bot')).toEqual([]);
  });

  it('tells the viewer they were promoted / demoted', () => {
    const rows = chatRows({ events: [
      membership('r1', { kind: 'role', subject: 'me', author: 'admin', payload: { role: 'admin' } }, 10),
      membership('r2', { kind: 'role', subject: 'me', author: 'admin', payload: { role: 'member' } }, 20),
    ], circleId: 'k1', viewerId: 'me', t });
    const texts = rows.filter((r) => r.actor === 'bot').map((r) => r.event.payload.text).sort();
    expect(texts).toEqual(['circle.membership.you_are_no_longer_admin', 'circle.membership.you_are_now_admin']);
  });

  it('tells the ADMITTING admin that someone joined, naming them by handle', () => {
    const rows = chatRows({
      events: [membership('j1', { kind: 'join', subject: 'newbie', author: 'me' })],
      circleId: 'k1', viewerId: 'me', t, members: [{ webid: 'newbie', handle: 'piet' }],
    });
    const notice = rows.find((r) => r.actor === 'bot');
    expect(notice?.event.payload.text, 'named through the reveal ladder, in the app\'s own @handle form').toBe('circle.membership.someone_joined:@piet');
  });

  it('is derived, so it is idempotent by construction: the same log projects the same one row', () => {
    const events = [membership('e1', { kind: 'evict', subject: 'me', author: 'admin' })];
    const a = chatRows({ events, circleId: 'k1', viewerId: 'me', t });
    const b = chatRows({ events, circleId: 'k1', viewerId: 'me', t });
    expect(a.filter((r) => r.actor === 'bot')).toHaveLength(1);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
  });

  it('conservation: a caller that passes no translator gets exactly the pre-existing rows', () => {
    const rows = chatRows({ events: [chat, membership('e1', { kind: 'evict', subject: 'me', author: 'admin' })], circleId: 'k1', viewerId: 'me' });
    expect(rows.filter((r) => r.actor === 'bot')).toEqual([]);
  });
});
