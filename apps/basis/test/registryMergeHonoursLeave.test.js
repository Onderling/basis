/**
 * A LEAVE SURVIVES THE MERGE. The registry's merge of a pod copy this device has not read (mergeUnreadPodCopy) unions
 * the circles; a leave used to be a plain removal, so a device still holding a circle the person left elsewhere would
 * put it back on the pod at its first merge. A leave now leaves a dated tombstone, a membership write a dated record,
 * and the merge keeps whichever is newer.
 */
import { describe, it, expect } from 'vitest';
import { setCircleMembership, removeCircleMembership, circleMembershipsOf } from '@onderling/agent-registry';
import { mergeUnreadPodCopy } from '../src/v2/registryCarrier.js';

const body = (properties, updatedAt) => ({ v: 1, agents: [{ agentId: 'default', properties }], updatedAt });
const circlesOf = (b) => Object.keys(circleMembershipsOf(b.agents[0]));

describe('the merge honours a leave', () => {
  it('a circle the person LEFT on the pod side does not come back from this device\'s stale copy', () => {
    const joined = setCircleMembership({}, 'c1', { handle: 'me', address: 'relay:me', at: '2026-11-01T10:00:00.000Z' });
    const stale = body(joined, '2026-11-01T10:00:00.000Z');                       // this device: still holds c1
    const left = removeCircleMembership(joined, 'c1', { at: '2026-11-20T10:00:00.000Z' });
    const pod = body(left, '2026-11-20T10:00:00.000Z');                           // the pod: c1 left elsewhere
    expect(circlesOf(mergeUnreadPodCopy(stale, pod))).not.toContain('c1');
    expect(circlesOf(mergeUnreadPodCopy(pod, stale)), 'whichever side holds the leave').not.toContain('c1');
  });

  it('a circle joined AGAIN after the leave stays', () => {
    const joined = setCircleMembership({}, 'c1', { handle: 'me', address: 'relay:me', at: '2026-11-01T10:00:00.000Z' });
    const left = removeCircleMembership(joined, 'c1', { at: '2026-11-20T10:00:00.000Z' });
    const again = setCircleMembership(left, 'c1', { handle: 'me', address: 'relay:me2', at: '2026-11-25T10:00:00.000Z' });
    expect(circlesOf(mergeUnreadPodCopy(body(left, '2026-11-20T10:00:00.000Z'), body(again, '2026-11-25T10:00:00.000Z')))).toContain('c1');
    expect(circlesOf(mergeUnreadPodCopy(body(again, '2026-11-25T10:00:00.000Z'), body(left, '2026-11-20T10:00:00.000Z')))).toContain('c1');
  });

  it('the restore case still takes the pod\'s circles in', () => {
    const pod = body(setCircleMembership({}, 'c1', { handle: 'me', address: 'relay:me', at: '2026-11-01T10:00:00.000Z' }), '2026-11-01T10:00:00.000Z');
    const fresh = body({}, '2026-11-28T10:00:00.000Z');
    expect(circlesOf(mergeUnreadPodCopy(fresh, pod))).toContain('c1');
  });
});
