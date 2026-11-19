/**
 * The alpha-size seed counts what the relay gave up on, per sender (ledger L1061): `bootPeople`'s `onUndelivered`
 * reaches the secure agent the way a shell's give-up consumers do. Proven with a relay that holds ONE line for an
 * peer who left: the next line pushes the first out, and the sender hears it, named. Without this a seed run's
 * "0 undelivered" could mean the hook never fires.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '@onderling/relay';
import { bootPeople, sendBypassingTheGate, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';

let relay = null;
afterEach(async () => { await relay?.stop?.(); relay = null; });

describe('the seed hears each sender\'s undelivered', () => {
  it('a line the relay drops for an absent peer is reported to bootPeople\'s hook, with the sender', async () => {
    relay = await startRelay({ port: 0, queueCap: 1, queueCapTotal: 1 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const heard = [];
    const [a, b] = await bootPeople({ relayUrl, handles: ['a', 'b'], onUndelivered: (handle, info) => heard.push({ handle, info }) });
    await sendBypassingTheGate(a, b.pubKey, { type: 'probe', msgId: 'seed-1-hello' }, { reason: 'one line while b is there, so the two have met' });
    await b.agent.sa.relay.disconnect();   // b is gone: the relay holds what comes for it, one line at most
    for (let i = 0; i < 3; i += 1) {
      await sendBypassingTheGate(a, b.pubKey, { type: 'probe', msgId: `seed-1-m${i}`, i }, { reason: 'lines for a peer who left, to overfill the relay\'s one-line hold' });
    }
    expect(await untilTrue(() => heard.length > 0, 8000), 'the sender heard the relay give up').toBe(true);
    expect(heard[0].handle).toBe('a');
    expect(heard[0].info).toHaveProperty('reason');
  }, 30000);
});
