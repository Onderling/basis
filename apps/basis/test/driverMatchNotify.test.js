// Drivers match→notify (#5) — the on-device feed seam. Matches an incoming item against the user's
// private drivers locally and fires ONE explainable notification on a resonant match. Reuses
// matchProfileDrivers + injected getDrivers/notify; never throws on bad input; outreach is not automatic.
import { describe, it, expect, vi } from 'vitest';
import { createDriver } from '@onderling/agent-registry';
import { evaluateItemForDrivers, notifyIfResonant, matchReasonText, annotateResonantPosts } from '../src/core/handlers/driverMatchNotify.js';

const DRIVERS = { sailing: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] }) };
const getDrivers = async () => DRIVERS;

describe('driver match→notify seam (#5)', () => {
  it('evaluateItemForDrivers matches an item carrying a driverSignature', async () => {
    const item = { id: 'q1', title: 'sailing buddies?', driverSignature: { tags: ['sailing'] } };
    const matches = await evaluateItemForDrivers({ item, getDrivers });
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toEqual({ kind: 'tags', tags: ['sailing'] });
  });

  it('evaluateItemForDrivers: no drivers / no item / thrown loader → [] (feed never breaks)', async () => {
    expect(await evaluateItemForDrivers({ item: { tags: ['x'] }, getDrivers: async () => ({}) })).toEqual([]);
    expect(await evaluateItemForDrivers({ item: null, getDrivers })).toEqual([]);
    expect(await evaluateItemForDrivers({ item: { tags: ['x'] }, getDrivers: async () => { throw new Error('boom'); } })).toEqual([]);
  });

  it('matchReasonText renders the explainable reason for both sources', () => {
    expect(matchReasonText({ reason: { kind: 'tags', tags: ['sailing', 'learning'] } })).toBe('you both care about: sailing, learning');
    expect(matchReasonText({ reason: { kind: 'llm', text: 'boating ≈ sailing' } })).toBe('boating ≈ sailing');
    expect(matchReasonText({})).toBe('a resonant match');
  });

  it('notifyIfResonant fires ONE notification with the item ref + explainable reason on a match', async () => {
    const notify = vi.fn();
    const item = { id: 'q1', title: 'anyone up for sailing lessons?', driverSignature: { tags: ['sailing'] } };
    const res = await notifyIfResonant({ item, getDrivers, notify });
    expect(res.notified).toBe(true);
    expect(res.matches).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.itemId).toBe('q1');
    expect(payload.topReason).toBe('you both care about: sailing');
    expect(payload.message).toContain('sailing lessons');
    expect(payload.message).toContain('you both care about: sailing');
  });

  it('notifyIfResonant: no match ⇒ no notification', async () => {
    const notify = vi.fn();
    const res = await notifyIfResonant({ item: { tags: ['cooking'] }, getDrivers, notify });
    expect(res.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifyIfResonant: a notify that throws does not break ingestion', async () => {
    const notify = vi.fn(() => { throw new Error('notify down'); });
    const item = { id: 'q1', title: 'sail', driverSignature: { tags: ['sailing'] } };
    await expect(notifyIfResonant({ item, getDrivers, notify })).resolves.toMatchObject({ notified: true });
  });

  it('notifyIfResonant threads an injected judge for synonym matches, under the persona\'s yes', async () => {
    const notify = vi.fn();
    const judge = vi.fn(async () => ({ match: true, reason: 'boating is sailing' }));
    const item = { id: 'q2', title: 'weekend boating', driverSignature: { tags: ['boating'] } };   // no tag overlap
    const res = await notifyIfResonant({ item, getDrivers, notify, judge, modelConsent: true });
    expect(res.notified).toBe(true);
    expect(notify.mock.calls[0][0].topReason).toBe('boating is sailing');
  });
});

describe('annotateResonantPosts (#5b)', () => {
  const drivers = { sailing: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing'] }) };
  const getDrivers = async () => drivers;

  it('flags matching posts with a resonance reason, leaves others untouched', async () => {
    const posts = [
      { id: 'p1', text: 'sailing lessons?', skillTags: ['sailing'] },
      { id: 'p2', text: 'cooking club', skillTags: ['cooking'] },
    ];
    const out = await annotateResonantPosts({ posts, getDrivers });
    expect(out[0].resonance).toEqual({ reason: 'you both care about: sailing', matches: expect.any(Array) });
    expect(out[1].resonance).toBeUndefined();
  });

  it('no drivers ⇒ posts pass through unchanged', async () => {
    const posts = [{ id: 'p1', text: 'sailing', skillTags: ['sailing'] }];
    expect(await annotateResonantPosts({ posts, getDrivers: async () => ({}) })).toBe(posts);
  });

  it('matches on an explicit driverSignature nested under source (stored-item shape)', async () => {
    const posts = [{ id: 'p1', text: 'weekend', source: { driverSignature: { tags: ['sailing'] } } }];
    const out = await annotateResonantPosts({ posts, getDrivers });
    expect(out[0].resonance?.reason).toBe('you both care about: sailing');
  });
});
