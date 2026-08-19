// circle-post handler → drivers match→notify hook (#5). On ingest, the handler matches the post against
// MY drivers on-device (getProfileDrivers) and fires a SEPARATE resonance notification on an explainable
// match — working off the post's text/tags even without an explicit driverSignature.
import { describe, it, expect, vi } from 'vitest';
import { createDriver } from '@onderling/agent-registry';
import { makeHandleCirclePost } from '../src/core/handlers/circlePost.js';

function harness({ drivers }) {
  const events = [];
  const callSkill = vi.fn(async (app, op) => {
    if (op === 'ingestRemotePost') return { itemId: 'item-1' };
    if (op === 'getProfileDrivers') return { ok: true, drivers };
    return {};
  });
  const handler = makeHandleCirclePost({ callSkill, publishEvent: (e) => events.push(e), logger: { info() {}, warn() {}, error() {} } });
  return { handler, events, callSkill };
}

const SAILING = { sailing: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing'] }) };

describe('circle-post → driver match→notify (#5)', () => {
  it('fires a resonance notification when a post matches my drivers (via text/tags fallback)', async () => {
    const { handler, events } = harness({ drivers: SAILING });
    await handler('peer.addr', { groupId: 'circle-oost', payload: { requestId: 'r1', text: 'sailing lessons?', tags: ['sailing'], from: 'anne' } });

    // the normal "post received" notification + the resonance nudge
    const resonance = events.find((e) => e.payload?.driverMatch);
    expect(resonance).toBeTruthy();
    expect(resonance.payload.topReason).toBe('you both care about: sailing');
    expect(resonance.payload.postId).toBe('r1');
    expect(resonance.payload.message).toContain('sailing lessons');
  });

  it('no resonance notification when the post does not match any driver', async () => {
    const { handler, events } = harness({ drivers: SAILING });
    await handler('peer.addr', { groupId: 'b', payload: { requestId: 'r2', text: 'cooking club', tags: ['cooking'], from: 'x' } });
    expect(events.find((e) => e.payload?.driverMatch)).toBeUndefined();
    expect(events.some((e) => e.payload?.message?.includes('cooking'))).toBe(true);   // normal post notif still fires
  });

  it('no drivers ⇒ no resonance check (and ingestion still works)', async () => {
    const { handler, events, callSkill } = harness({ drivers: {} });
    await handler('peer.addr', { groupId: 'b', payload: { requestId: 'r3', text: 'sailing', tags: ['sailing'], from: 'x' } });
    expect(events.find((e) => e.payload?.driverMatch)).toBeUndefined();
    expect(callSkill).toHaveBeenCalledWith('stoop', 'ingestRemotePost', expect.any(Object));
  });

  it('honours an explicit driverSignature over the post text/tags', async () => {
    const { handler, events } = harness({ drivers: SAILING });
    // text is about something else, but the authored signature says sailing
    await handler('peer.addr', { groupId: 'b', payload: { requestId: 'r4', text: 'weekend plans', driverSignature: { tags: ['sailing'] }, from: 'x' } });
    expect(events.find((e) => e.payload?.driverMatch)?.payload.topReason).toBe('you both care about: sailing');
  });
});
