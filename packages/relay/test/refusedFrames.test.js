/**
 * A frame that names a prototype key is refused at the parse (`parseUntrustedJson`) and COUNTED (`refusedFrames()`), not
 * dropped silently; JSON that does not parse stays the quiet drop it always was, and the socket carries on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { openClient, addr, registerAndWait } from './helpers/provenClient.js';

describe('the relay counts a refused frame', () => {
  let relay;
  afterEach(async () => { await (relay?.stop?.() ?? relay?.close?.()); });
  it('a prototype key counts; malformed JSON does not; the socket still registers after both', async () => {
    relay = await startRelay({ port: 0 });
    const c = await openClient(`ws://127.0.0.1:${relay.port}`);
    c.send('{"type":"register","__proto__":{"x":1}}');
    c.send('{not json');
    await new Promise((r) => setTimeout(r, 100));
    expect(relay.refusedFrames()).toBe(1);
    await registerAndWait(c, addr('anna'));
    c.close();
  });
});
