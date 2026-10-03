/**
 * The cap on calls from one sender, for a person tapping through their screen: a burst of 30, then one a second (the
 * browser walk of the admin's screen hit the old 10-then-one-per-2-s at a person's pace). The cap across all senders
 * stays as it was.
 */
import { describe, it, expect } from 'vitest';
import { makePeerSkillCalls } from '../src/peerSkillCalls.js';

function door() {
  let now = 0;
  const said = [];
  const accept = makePeerSkillCalls({ agent: { skills: new Map() }, now: () => now });
  const tx = { respond: async (_to, _id, msg) => { said.push(msg.error); } };
  const callOnce = (i) => accept({ _from: 'SCREEN', _id: `m${i}`, payload: { taskId: `t${i}`, skillId: 'lists.listLists', parts: [] } }, tx);
  return { said, callOnce, advance: (ms) => { now += ms; } };
}

describe('the per-sender cap: a burst of 30, then one a second', () => {
  it('30 at once pass the cap; the 31st is refused; a second later one more passes', async () => {
    const d = door();
    for (let i = 0; i < 31; i += 1) await d.callOnce(i);
    expect(d.said.filter((r) => r === 'rate-limited')).toHaveLength(1);
    expect(d.said.at(-1)).toBe('rate-limited');
    d.advance(1000);
    await d.callOnce(99);
    expect(d.said.at(-1)).not.toBe('rate-limited');
  });
});
