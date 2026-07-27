/**
 * Fitness — invariant 4b: a bot cannot rewrite its own trail.
 *
 * `EventLog.append` de-duped on the caller's `id` by SPLICING OUT the existing entry and unshifting the new
 * one. For chat that is the feature — an idempotent re-delivery must collapse rather than duplicate. For an
 * auditable entry it was the hole: anyone who knew an entry's id could silently change what it said, which
 * is precisely what invariant 4b forbids ("a compromised bot can't cover its tracks").
 *
 * The fix separates the two ideas that `id` was carrying at once:
 *   • `id`  — the caller's DEDUP KEY, which is how a replay collapses;
 *   • `seq` — a storage handle assigned on append, never accepted from a caller.
 *
 * …and then makes the repeat rule depend on the KIND: first-write-wins for auditable kinds, replace for the
 * rest. Journeys J-L8 and J-L9.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { isAuditKind } from '@onderling/item-store';

// `ts: Date.now()`, not a synthetic epoch: the log PRUNES by a retention window, so an entry dated 1970 is
// swept before any assertion can see it — the same trap that made the three-device harness look like a
// broken fan.
const entry = (id, type, payload) => ({ id, ts: Date.now(), app: 'test', type, payload });

describe('an auditable entry is immutable once written', () => {
  it.each(['governance', 'report', 'key-event', 'membership', 'agent-action', 'settings-change'])(
    '%s: a re-append with the same id does NOT change it', (type) => {
      expect(isAuditKind(type), `${type} should be auditable`).toBe(true);   // non-vacuous
      const log = new EventLog({ initial: [] });
      log.append(entry('e1', type, { said: 'the truth' }));
      log.append(entry('e1', type, { said: 'something else entirely' }));

      const rows = log.query({}).filter((e) => e.id === 'e1');
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ said: 'the truth' });
    },
  );

  it('the re-append RETURNS the original, so a caller cannot believe it succeeded', () => {
    const log = new EventLog({ initial: [] });
    log.append(entry('e1', 'governance', { v: 1 }));
    const got = log.append(entry('e1', 'governance', { v: 2 }));
    expect(got.payload).toEqual({ v: 1 });
  });

  it('a DIFFERENT id is a new entry, not a rewrite — appending still works', () => {
    const log = new EventLog({ initial: [] });
    log.append(entry('e1', 'governance', { v: 1 }));
    log.append(entry('e2', 'governance', { v: 2 }));
    expect(log.query({})).toHaveLength(2);
  });
});

describe('chat keeps replace-on-redelivery — it relies on it', () => {
  it('a re-delivered chat message collapses to one row, with the newer content', () => {
    // If first-write-wins were applied globally this would still be one row, so the payload check is what
    // makes this case meaningful: chat REPLACES.
    const log = new EventLog({ initial: [] });
    log.append(entry('m1', 'chat-message', { text: 'first' }));
    log.append(entry('m1', 'chat-message', { text: 'edited-in-flight' }));

    const rows = log.query({}).filter((e) => e.id === 'm1');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ text: 'edited-in-flight' });
  });

  it('an UNREGISTERED kind also replaces — immutability is opt-in, never assumed', () => {
    const log = new EventLog({ initial: [] });
    log.append(entry('x1', 'buurt-post', { text: 'a' }));
    log.append(entry('x1', 'buurt-post', { text: 'b' }));
    expect(log.query({}).find((e) => e.id === 'x1').payload).toEqual({ text: 'b' });
  });
});

describe('`seq` is the log\'s, not the caller\'s', () => {
  it('is assigned on append and increases', () => {
    const log = new EventLog({ initial: [] });
    const a = log.append(entry('a', 'chat-message'));
    const b = log.append(entry('b', 'chat-message'));
    expect(typeof a.seq).toBe('number');
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it('a caller-supplied seq is IGNORED — ordering is not in the caller\'s hands', () => {
    const log = new EventLog({ initial: [] });
    const first = log.append(entry('a', 'chat-message'));
    const forged = log.append({ ...entry('b', 'chat-message'), seq: -999 });
    expect(forged.seq).toBeGreaterThan(first.seq);
  });

  it('a rejected audit re-append does not burn a seq', () => {
    // Otherwise the sequence would leak how many rewrites were ATTEMPTED, and gaps would look like loss.
    const log = new EventLog({ initial: [] });
    const a = log.append(entry('e1', 'governance', { v: 1 }));
    log.append(entry('e1', 'governance', { v: 2 }));
    const next = log.append(entry('e2', 'governance', { v: 3 }));
    expect(next.seq).toBe(a.seq + 1);
  });
});

describe('subscribers see what was STORED', () => {
  it('a subscriber receives the stored entry, not the caller\'s object', () => {
    const log = new EventLog({ initial: [] });
    const seen = [];
    log.subscribe((e) => seen.push(e));
    log.append(entry('a', 'chat-message'));
    expect(seen[0].seq).toBeDefined();
  });
});
