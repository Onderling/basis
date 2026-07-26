/**
 * Personal drivers across THREE people — story 10.1 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * Drivers are the most sensitive thing in the property layer: an authored, private statement of what a
 * person actually cares about. The design says matching happens ON DEVICE and only a match SIGNAL surfaces
 * — never the profile. That is exactly the "does the un-acted-on party see something they shouldn't" shape
 * that produced the persona forgery, so it is worth pinning rather than trusting.
 *
 * Cast: Anna (posts, has NO drivers) · Bram (drivers that match) · Cato (drivers that don't).
 */
import { describe, it, expect, vi } from 'vitest';
import { matchProfileDrivers, createDriver } from '@onderling/agent-registry';
import {
  annotateResonantPosts, evaluateItemForDrivers, notifyIfResonant, matchReasonText,
} from '../src/core/handlers/driverMatchNotify.js';

// Bram's PRIVATE drivers. `text` is the giveaway: if any of it escapes the device, that is the leak.
const BRAM_DRIVERS = {
  d1: createDriver({ kind: 'hobby', text: 'I repair bikes in my shed on Saturdays', tags: ['fiets', 'reparatie'] }),
  d2: createDriver({ kind: 'goal', text: 'I want the street to grow vegetables together', tags: ['moestuin'] }),
};
const CATO_DRIVERS = {
  d1: createDriver({ kind: 'hobby', text: 'I restore antique clocks', tags: ['klokken'] }),
};
const ANNA_POST = { id: 'p1', title: 'Wie kan mijn fietsband plakken?', tags: ['fiets'] };

const getDrivers = (props) => async () => props;
/** Every string anywhere in a value — used to prove a secret never appears in a payload. */
const flatten = (v) => JSON.stringify(v ?? null);

describe('10.1 — drivers are matched on-device; only the SIGNAL surfaces', () => {
  it('a match names only the SHARED tags — never the driver text that produced it', async () => {
    const matches = await matchProfileDrivers({ properties: BRAM_DRIVERS, item: ANNA_POST });
    expect(matches.length).toBeGreaterThan(0);

    const payload = flatten(matches);
    expect(payload).toContain('fiets');                       // the overlap IS the explanation
    expect(payload).not.toContain('shed on Saturdays');       // …but the authored text never travels
    expect(payload).not.toContain('moestuin');                // nor an UNRELATED driver's tags
    for (const m of matches) expect(m.reason).toEqual({ kind: 'tags', tags: expect.arrayContaining(['fiets']) });
  });

  it('the human-readable reason is built from the overlap only', () => {
    const text = matchReasonText({ reason: { kind: 'tags', tags: ['fiets'] } });
    expect(text).toContain('fiets');
    expect(text).not.toContain('shed');
  });

  it('a NON-matching person produces no match at all (nothing to leak)', async () => {
    const matches = await matchProfileDrivers({ properties: CATO_DRIVERS, item: ANNA_POST });
    expect(matches).toEqual([]);
  });

  it('someone with NO drivers gets nothing — the author is not profiled by default', async () => {
    expect(await matchProfileDrivers({ properties: {}, item: ANNA_POST })).toEqual([]);
    expect(await evaluateItemForDrivers({ item: ANNA_POST, getDrivers: getDrivers({}) })).toEqual([]);
  });
});

describe('10.1 — the resonance nudge stays on the MATCHER\'s device', () => {
  it('notifies the matcher (not the author) and carries no driver text', async () => {
    const notify = vi.fn();
    const res = await notifyIfResonant({ item: ANNA_POST, getDrivers: getDrivers(BRAM_DRIVERS), notify });

    expect(res.notified).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    // It is a LOCAL nudge: it names the item the matcher is looking at and why it resonated…
    expect(payload.itemId).toBe('p1');
    expect(payload.topReason).toContain('fiets');
    // …and nothing in it reveals the authored drivers themselves.
    expect(flatten(payload)).not.toContain('shed on Saturdays');
    expect(flatten(payload)).not.toContain('vegetables');
  });

  it('no drivers ⇒ no nudge at all (silence, not an empty notification)', async () => {
    const notify = vi.fn();
    const res = await notifyIfResonant({ item: ANNA_POST, getDrivers: getDrivers({}), notify });
    expect(res.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('10.1 — annotating a feed does not mutate or republish the posts', () => {
  it('resonance is added to a COPY; the original post object is untouched', async () => {
    const original = { ...ANNA_POST };
    const [annotated] = await annotateResonantPosts({ posts: [original], getDrivers: getDrivers(BRAM_DRIVERS) });

    expect(annotated.resonance).toBeTruthy();
    expect(annotated).not.toBe(original);
    expect(original).not.toHaveProperty('resonance');   // the shared/stored item is never rewritten
  });

  it('a post that matches nobody passes through unchanged (identity, not a rebuilt object)', async () => {
    const post = { id: 'p9', title: 'Iemand een ladder?', tags: ['ladder'] };
    const [out] = await annotateResonantPosts({ posts: [post], getDrivers: getDrivers(BRAM_DRIVERS) });
    expect(out).toBe(post);
    expect(out).not.toHaveProperty('resonance');
  });

  it('two people annotate the SAME post independently — neither sees the other\'s result', async () => {
    const post = { ...ANNA_POST };
    const [forBram] = await annotateResonantPosts({ posts: [post], getDrivers: getDrivers(BRAM_DRIVERS) });
    const [forCato] = await annotateResonantPosts({ posts: [post], getDrivers: getDrivers(CATO_DRIVERS) });

    expect(forBram.resonance).toBeTruthy();          // Bram resonates…
    expect(forCato).not.toHaveProperty('resonance'); // …Cato does not, and neither learns about the other
    expect(post).not.toHaveProperty('resonance');    // the shared post carries no one's match state
  });
});
