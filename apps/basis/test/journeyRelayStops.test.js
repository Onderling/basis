/**
 * An in-process journey relay is STOPPED by its `close()` — before, it called a `close` the relay does not have (the
 * relay returns `stop`), so every relay a suite started kept its port open until the process ended.
 */
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { startJourneyRelay } from './support/testRelay.js';

const connects = (url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  const done = (v) => { try { ws.terminate(); } catch { /* */ } resolve(v); };
  ws.once('open', () => done(true));
  ws.once('error', () => done(false));
  setTimeout(() => done(false), 3000);
});

describe('the journey relay', () => {
  it('close() stops it: its port takes no connection afterwards', async () => {
    const r = await startJourneyRelay();
    expect(await connects(r.url), 'running').toBe(true);
    await r.close();
    expect(await connects(r.url), 'stopped').toBe(false);
  });
});
