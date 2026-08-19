/**
 * basis — profile-update propagation (Phase-4 Wave B): the roster "pull-me" signal.
 *
 * The pinned model (plans/NOTE-reveal-state-and-profile-updates.md §2): a real disclosure change
 * writes the admin roster → a SILENT typed entry lands on the circle stream carrying only WHAT to
 * re-read (member ref + changed key names, never values) → members pull the changed rows. Two hard
 * rules: diff-gated (open-and-save-unchanged does nothing) and reveal-gated (only what the member
 * discloses to THAT circle ever travels). This suite proves the substrate keeps all of it.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  ROSTER_UPDATED_KIND,
  rosterUpdatedPayload,
  appendRosterUpdatedEntry,
  changedReleaseKeys,
  releaseUnchanged,
  makeRosterUpdateAnnouncer,
  makeRosterUpdatedPeerHandler,
  isValidRosterUpdatedEnvelope,
} from '../src/v2/rosterUpdated.js';
import { EventLog, isSilentEntry, shouldWakeForEntry } from '../src/eventLog.js';
import { buildCircleChat, buildCircleStream } from '../src/v2/circleStream.js';
import { PROFILE_PICTURE_KEY, isSealedMediaRef } from '@onderling/agent-registry';

const CIRCLE = 'circle-oost';
const MEMBER = 'app.member.test';

describe('the diff-gate (changedReleaseKeys / releaseUnchanged)', () => {
  it('a truly unchanged release yields NO changed keys (the no-op save)', () => {
    const rel = { place: 'Groningen', handle: 'bram' };
    expect(changedReleaseKeys(rel, { ...rel })).toEqual([]);
    expect(releaseUnchanged(rel, { ...rel })).toBe(true);
  });

  it('added / removed / edited keys all count, sorted', () => {
    expect(changedReleaseKeys({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);          // added
    expect(changedReleaseKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);          // removed
    expect(changedReleaseKeys({ a: 1 }, { a: 2 })).toEqual(['a']);                // edited
    expect(changedReleaseKeys({ b: 1, a: 1 }, { a: 2, b: 2 })).toEqual(['a', 'b']);
  });

  it('null / absent and {} are the same "share nothing" state', () => {
    expect(releaseUnchanged(null, {})).toBe(true);
    expect(releaseUnchanged({}, null)).toBe(true);
  });
});

describe('the pull-me payload carries refs, NEVER values', () => {
  it('whitelists memberRef + key NAMES; drops any value a caller straps on', () => {
    const body = rosterUpdatedPayload({
      memberRef: MEMBER,
      keys: ['place', 'realName'],
      // hostile extras — a value the caller must never be able to leak on this wire:
      values: { place: 'Groningen' },
      place: 'Groningen',
    });
    expect(body).toEqual({ memberRef: MEMBER, keys: ['place', 'realName'] });
    expect(JSON.stringify(body)).not.toContain('Groningen');
  });

  it('a media/picture change carries the KEY NAME only — never the sealed ref', () => {
    const sealedRef = { type: 'blob', ref: 'blob://abc', enc: { sealed: true, keyRef: 'k1' } };
    expect(isSealedMediaRef(sealedRef)).toBe(true);
    const before = { handle: 'bram' };
    const after  = { handle: 'bram', [PROFILE_PICTURE_KEY]: sealedRef };
    const keys = changedReleaseKeys(before, after);
    expect(keys).toEqual([PROFILE_PICTURE_KEY]);
    const body = rosterUpdatedPayload({ memberRef: MEMBER, keys });
    expect(body).toEqual({ memberRef: MEMBER, keys: [PROFILE_PICTURE_KEY] });
    // The sealed ref (pointer + enc) never appears on the wire — only the key name does.
    expect(JSON.stringify(body)).not.toContain('blob://abc');
  });
});

describe('the silent entry (C15 lane)', () => {
  it('appendRosterUpdatedEntry writes exactly one silent, non-waking, chat-excluded entry', () => {
    const log = new EventLog({ initial: [] });
    const entry = appendRosterUpdatedEntry({
      eventLog: log, circleId: CIRCLE, memberRef: MEMBER, keys: ['place'],
    });
    expect(log.size).toBe(1);
    expect(entry.type).toBe(ROSTER_UPDATED_KIND);
    // silent, never wakes an offline member.
    expect(isSilentEntry(entry)).toBe(true);
    expect(shouldWakeForEntry(entry)).toBe(false);
    // first-class circle scope + refs-only payload.
    expect(entry.circleId).toBe(CIRCLE);
    expect(entry.payload).toEqual({ memberRef: MEMBER, keys: ['place'] });

    const events = log.query({});
    const circles = [{ id: CIRCLE, name: 'Oost' }];
    // The chat projection EXCLUDES it; the Stream firehose SHOWS it.
    expect(buildCircleChat({ events, circles, circleId: CIRCLE })).toHaveLength(0);
    expect(buildCircleStream({ events, circles }).map((r) => r.type)).toContain(ROSTER_UPDATED_KIND);
  });
});

describe('the admin-side announcer', () => {
  it('drops the silent entry locally AND fans the refs out (no values on the wire)', async () => {
    const log = new EventLog({ initial: [] });
    const rawCallSkill = vi.fn(async () => ({ sent: 1, attempted: 1, errors: [] }));
    const announce = makeRosterUpdateAnnouncer({ rawCallSkill, eventLog: log });

    await announce({ circleId: CIRCLE, memberRef: MEMBER, keys: ['place'] });

    // one silent local entry
    expect(log.size).toBe(1);
    expect(isSilentEntry(log.query({})[0])).toBe(true);
    // fan-out via the stoop broadcast, carrying refs only
    expect(rawCallSkill).toHaveBeenCalledTimes(1);
    const [app, op, args] = rawCallSkill.mock.calls[0];
    expect([app, op]).toEqual(['stoop', 'broadcastRosterUpdated']);
    expect(args).toMatchObject({ groupId: CIRCLE, memberRef: MEMBER, keys: ['place'] });
    expect(JSON.stringify(args)).not.toContain('Groningen');
  });
});

describe('the member-side receiver (the pull)', () => {
  it('records the silent entry + calls onPull with the refs to re-read; no bubble', async () => {
    const log = new EventLog({ initial: [] });
    const onPull = vi.fn(async () => {});
    const handler = makeRosterUpdatedPeerHandler({ eventLog: log, onPull });

    const env = {
      type: 'p2p-chat', subtype: ROSTER_UPDATED_KIND,
      circleId: CIRCLE, msgId: 'ru-1', ts: Date.now(),
      memberRef: MEMBER, keys: ['place'],
    };
    expect(isValidRosterUpdatedEnvelope(env)).toBe(true);
    await handler('admin.addr', env);

    // silent entry recorded (Stream shows it, chat doesn't)
    expect(log.size).toBe(1);
    expect(isSilentEntry(log.query({})[0])).toBe(true);
    expect(buildCircleChat({ events: log.query({}), circles: [{ id: CIRCLE }], circleId: CIRCLE })).toHaveLength(0);
    // the pull fired with exactly what to re-read
    expect(onPull).toHaveBeenCalledWith({ circleId: CIRCLE, memberRef: MEMBER, keys: ['place'] });
  });

  it('is idempotent on msgId (a redelivered signal pulls once)', async () => {
    const onPull = vi.fn(async () => {});
    const handler = makeRosterUpdatedPeerHandler({ eventLog: new EventLog({ initial: [] }), onPull });
    const env = { subtype: ROSTER_UPDATED_KIND, circleId: CIRCLE, msgId: 'ru-dup', ts: 1, memberRef: MEMBER, keys: [] };
    await handler('a', env);
    await handler('a', env);
    expect(onPull).toHaveBeenCalledTimes(1);
  });

  it('drops a malformed envelope (no pull, no entry)', async () => {
    const log = new EventLog({ initial: [] });
    const onPull = vi.fn();
    const handler = makeRosterUpdatedPeerHandler({ eventLog: log, onPull });
    await handler('a', { subtype: ROSTER_UPDATED_KIND, circleId: CIRCLE });   // missing msgId/ts/memberRef
    expect(onPull).not.toHaveBeenCalled();
    expect(log.size).toBe(0);
  });
});
