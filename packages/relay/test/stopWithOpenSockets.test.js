/**
 * `stop()` finishes while sockets are still open — a client that never registered, or one that never answers a close.
 * Before, it closed only registered clients (gracefully) and then waited for the HTTP server, which waits for every
 * open socket: a box shutting down, or a test's teardown, hung for as long as one stayed open.
 */
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import net from 'node:net';
import { startRelay } from '../src/server.js';

const within = (p, ms) => Promise.race([p.then(() => 'done'), new Promise((r) => setTimeout(() => r('hung'), ms))]);

describe('stopping the relay', () => {
  it('finishes with an unregistered websocket and a bare TCP socket still open', async () => {
    const relay = await startRelay({ port: 0, log: false });
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}`);
    await new Promise((r) => ws.once('open', r));
    const raw = net.connect(relay.port, '127.0.0.1');
    await new Promise((r) => raw.once('connect', r));
    expect(await within(relay.stop(), 3000)).toBe('done');
    try { ws.terminate(); raw.destroy(); } catch { /* */ }
  });
});
