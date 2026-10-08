/**
 * The relay question — asked only when the device knows no relay at all (there is no default relay), and "Later"
 * holds for the session.
 */
import { describe, it, expect } from 'vitest';
import { createRelayQuestion } from '../../src/v2/connectionPoints.js';

const P = (url, kind = 'relay') => ({ url, kind, adopted: true });
const ask = async (known) => (await createRelayQuestion({ read: () => known }).check()).ask;

describe('the relay question', () => {
  it('asks when nothing is saved, no argument was given and no circle recorded a relay', async () => {
    expect(await ask({ saved: null, arg: null, list: [] })).toBe(true);
    expect(await ask({ saved: '  ', arg: '', list: [] })).toBe(true);
  });

  it('a pod is not a relay — a circle that recorded only its pod still leaves the question open', async () => {
    expect(await ask({ list: [P('https://pod.test/', 'pod')] })).toBe(true);
  });

  it('does not ask when the person saved one, the build/boot gave one, or a circle (an invite) recorded one', async () => {
    expect(await ask({ saved: 'wss://relay.test' })).toBe(false);
    expect(await ask({ arg: 'wss://relay.test' })).toBe(false);
    expect(await ask({ list: [P('wss://relay.test')] })).toBe(false);
  });

  it('reads what the device knows NOW — a relay saved after the first check closes it', async () => {
    let saved = null;
    const q = createRelayQuestion({ read: async () => ({ saved }) });
    expect((await q.check()).ask).toBe(true);
    saved = 'wss://relay.test';
    expect((await q.check()).ask).toBe(false);
  });

  it('"Later" holds for the session', async () => {
    const q = createRelayQuestion({ read: () => ({}) });
    expect((await q.check()).ask).toBe(true);
    q.later();
    expect((await q.check()).ask).toBe(false);
  });

  it('an unreadable device state asks (better once too often than a device that silently has none)', async () => {
    const q = createRelayQuestion({ read: () => { throw new Error('storage'); } });
    expect((await q.check()).ask).toBe(true);
  });
});
