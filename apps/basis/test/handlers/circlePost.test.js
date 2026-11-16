/**
 * A circle post that landed from another member: no ingest (the post is already in the circle's store), no second
 * log row (its landing entry is the record), and the driver match.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleCirclePost } from '../../src/core/handlers/circlePost.js';

function deps(overrides = {}) {
  return {
    callSkill:    vi.fn(async () => ({ drivers: {} })),
    publishEvent: vi.fn(),
    logger:       { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

const env = (overrides = {}) => ({
  groupId: 'g1', fromPubKey: 'pk-A',
  payload: { requestId: 'req-1', text: 'hi', kind: 'request' },
  ...overrides,
});

describe('makeHandleCirclePost', () => {
  it('throws when callSkill missing', () => {
    expect(() => makeHandleCirclePost({})).toThrow(/callSkill required/);
  });

  it('drops envelopes missing payload.requestId', async () => {
    const d = deps();
    const handle = makeHandleCirclePost(d);
    await handle('peer-A', env({ payload: { text: 'hi' } }));
    expect(d.publishEvent).not.toHaveBeenCalled();
  });

  it('logs no notification of its own and ingests nothing: the post is in the store and its landing on the log', async () => {
    const d = deps();
    const handle = makeHandleCirclePost(d);
    await handle('peer-A', env());
    expect(d.callSkill.mock.calls.filter(([app]) => app === 'pinboard')).toEqual([]);
    expect(d.publishEvent).not.toHaveBeenCalled();   // no drivers here, so no resonance nudge either
  });
});
