/**
 * The key-event sink's DIRECT fan (the log-less degrade, and the fallback when the waist fan throws) names the circle it
 * is fanning for. Without it, the app's send gate cannot tell a rotation from a direct message and takes the person
 * path: circle key traffic under the person key, which every member refuses inside a circle.
 */
import { describe, it, expect } from 'vitest';
import { makeKeyEventLogSink } from '../src/keyEventLogSink.js';

const event = { groupId: 'c-1', kind: 'rotate', epoch: 2 };

describe('the key-event sink\'s direct fan names its circle', () => {
  it('the log-less degrade (no lane): every recipient send carries circleId', async () => {
    const sent = [];
    const sink = makeKeyEventLogSink({
      groupId: 'c-1',
      resolveRecipientAddrs: async () => ['a', 'b'],
      sendPeer: async (addr, payload, opts) => { sent.push({ addr, opts }); },
      sendOptions: { guarantee: 'hold-forward' },
    });
    await sink.append(event);
    expect(sent.map((s) => s.addr)).toEqual(['a', 'b']);
    for (const s of sent) expect(s.opts).toEqual({ guarantee: 'hold-forward', circleId: 'c-1' });
  });

  it('the fallback when the waist fan throws: still names the circle', async () => {
    const sent = [];
    const sink = makeKeyEventLogSink({
      resolveRecipientAddrs: async () => ['a'],
      sendPeer: async (addr, payload, opts) => { sent.push(opts); },
      emitStatement: async () => ({ body: { hash: 'h' }, sig: 's' }),
      statementSubtype: 'circle-key-statement',
      fanStatement: async () => { throw new Error('waist down'); },
    });
    await sink.append(event);
    expect(sent).toEqual([{ circleId: 'c-1' }]);
  });
});
