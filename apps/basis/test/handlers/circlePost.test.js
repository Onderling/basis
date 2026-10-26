/**
 * The announcement of a circle post that landed from another member: a notification, no ingest (the post is already
 * in the circle's store), and the driver match.
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

  it('publishes the notification and ingests nothing: the post is already in the circle\'s store', async () => {
    const d = deps();
    const handle = makeHandleCirclePost(d);
    await handle('peer-A', env());
    expect(d.callSkill.mock.calls.filter(([app, op]) => app === 'pinboard')).toEqual([]);
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      app: 'pinboard', type: 'notification',
      payload: expect.objectContaining({ postId: 'req-1', groupId: 'g1' }),
    }));
  });
});
