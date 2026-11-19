/**
 * The relay does not look at a page's Origin (ledger L1035, the circle-tools brief §9): a toolbox's page opened from
 * disk (`file://`) connects with `Origin: null`, and a later origin check on the relay would break every such page
 * without any test failing. Pinned here: a socket with `Origin: null`, one with a foreign origin and one with none are
 * all accepted and can say hello.
 */
import { describe, it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startJourneyRelay } from './support/testRelay.js';

describe('the relay accepts a page from disk', () => {
  let relay;
  afterAll(async () => { await relay?.close?.(); });

  it('Origin: null, a foreign origin, or none: the socket opens', async () => {
    relay = await startJourneyRelay();
    for (const origin of ['null', 'https://boodschappen.example', undefined]) {
      const ws = new WebSocket(relay.url, origin === undefined ? {} : { headers: { Origin: origin } });
      const opened = await new Promise((resolve) => {
        ws.once('open', () => resolve(true));
        ws.once('error', () => resolve(false));
        ws.once('unexpected-response', () => resolve(false));
      });
      expect(opened, `a socket with Origin ${origin ?? '(none)'} is accepted`).toBe(true);
      ws.close();
    }
  });
});
