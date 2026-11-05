import { describe, it, expect } from 'vitest';
import { createInboundAdmission } from '../../src/v2/inboundAdmission.js';

// A codes door: '/start GOOD' admits once; everything else needs a code.
function codesDoor() {
  const used = new Set(); const calls = [];
  const admit = async ({ uid, text }) => {
    calls.push(text);
    if (text === '/start GOOD') { if (used.has('GOOD')) return { refused: 'code-used' }; used.add('GOOD'); return { id: uid, consumed: true }; }
    if (used.has(`admitted:${uid}`) || uid === 'admitted-one') return uid;
    return { refused: 'needs-code' };
  };
  return { admit, calls };
}
const msg = (from, text) => ({ contactId: from, fromAddr: from, text });

describe('inbound admission at a function profile inbox', () => {
  it('admits a caller the door admits, and runs the door once per turn', async () => {
    const door = codesDoor();
    const go = createInboundAdmission({ admit: door.admit });
    expect(await go(msg('admitted-one', 'hoi'))).toMatchObject({ admitted: true, result: 'admitted-one' });
    expect(door.calls).toEqual(['hoi']);
  });

  it('a code is consumed exactly once, here', async () => {
    const door = codesDoor();
    const go = createInboundAdmission({ admit: door.admit });
    expect(await go(msg('s1', '/start GOOD'))).toMatchObject({ admitted: true, result: { consumed: true } });
    expect(await go(msg('s2', '/start GOOD'))).toMatchObject({ admitted: false, reason: 'code-used' });
  });

  it('refuses a stranger who needs a code, and tells them once', async () => {
    const counted = [];
    const go = createInboundAdmission({ admit: codesDoor().admit, count: (e) => counted.push(e) });
    expect(await go(msg('s1', 'hallo'))).toEqual({ admitted: false, reason: 'needs-code', tell: true });
    expect(await go(msg('s1', 'hallo?'))).toEqual({ admitted: false, reason: 'needs-code', tell: false });
    expect(counted).toEqual([{ kind: 'stranger-refused', reason: 'needs-code' }, { kind: 'stranger-refused', reason: 'needs-code' }]);
    expect(JSON.stringify(counted)).not.toContain('s1');   // a count line, never who
  });

  it("refuses a stranger's turn over 16 KB before the door is asked", async () => {
    const door = codesDoor();
    const go = createInboundAdmission({ admit: door.admit });
    expect(await go(msg('s1', 'x'.repeat(16 * 1024 + 1)))).toMatchObject({ admitted: false, reason: 'too-large' });
    expect(door.calls).toEqual([]);
  });

  it('a stranger gets three turns a day; the fourth is over budget', async () => {
    let t = 1_000;
    const go = createInboundAdmission({ admit: async () => ({ refused: 'needs-code' }), now: () => t });
    for (let i = 0; i < 3; i += 1) expect((await go(msg('s1', `t${i}`))).reason).toBe('needs-code');
    expect((await go(msg('s1', 't3'))).reason).toBe('over-budget');
    t += 24 * 60 * 60 * 1000;
    expect((await go(msg('s1', 't4'))).reason).toBe('needs-code');
  });

  it('all strangers together have an hourly ceiling', async () => {
    const go = createInboundAdmission({ admit: async () => ({ refused: 'needs-code' }), limits: { globalPerHour: 2 }, now: () => 5 });
    await go(msg('a', '1')); await go(msg('b', '1'));
    expect((await go(msg('c', '1'))).reason).toBe('busy');
  });

  it('a known peer is no stranger: no size cap, no budget — the door still decides', async () => {
    const door = codesDoor();
    const go = createInboundAdmission({ admit: door.admit, isKnown: async (k) => k === 'friend' });
    expect((await go(msg('friend', 'x'.repeat(20 * 1024)))).reason).toBe('needs-code');
    for (let i = 0; i < 5; i += 1) expect((await go(msg('friend', `t${i}`))).reason).toBe('needs-code');
  });

  it('an open persona admits a stranger within budget without a code; over budget it refuses', async () => {
    const door = codesDoor();
    const go = createInboundAdmission({ admit: door.admit, open: true, now: () => 7 });
    for (let i = 0; i < 3; i += 1) expect(await go(msg('s1', `feedback ${i}`))).toMatchObject({ admitted: true, stranger: true });
    expect(await go(msg('s1', 'nog meer'))).toEqual({ admitted: false, reason: 'over-budget', tell: true });
    expect(door.calls).toEqual([]);
  });

  it('a stranger the persona answered is a stranger no more', async () => {
    const go = createInboundAdmission({ admit: async ({ uid }) => uid, open: true, answered: async (k) => k === 's1', now: () => 7 });
    for (let i = 0; i < 5; i += 1) expect((await go(msg('s1', `t${i}`))).admitted).toBe(true);
  });

  it('a message delivered twice is decided once: no second pass through the door, no count', async () => {
    const door = codesDoor(); const counted = [];
    const go = createInboundAdmission({ admit: door.admit, count: (e) => counted.push(e) });
    expect(await go({ ...msg('s1', '/start GOOD'), messageId: 'm1' })).toMatchObject({ admitted: true });
    expect(await go({ ...msg('s1', '/start GOOD'), messageId: 'm1' })).toEqual({ admitted: false, reason: 'duplicate', tell: false });
    expect(door.calls).toEqual(['/start GOOD']);
    expect(counted).toEqual([]);
  });
});
