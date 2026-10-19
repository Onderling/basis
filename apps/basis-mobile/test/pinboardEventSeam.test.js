/**
 * The noticeboard's refresh-on-arrival listens where the event is exposed: the AGENT's `onPinboardEvent` (realAgent
 * returns it). The launcher passed `bundle.onPinboardEvent`, which the bundle never had — so on the phone the listener
 * was always absent and a fetched attachment never refreshed the board.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the pinboard event seam on mobile', () => {
  it('reads the agent\'s onPinboardEvent, which realAgent exposes (the bundle has none)', () => {
    expect(src('../src/screens/v2/CircleLauncherScreen.js')).toMatch(/onPinboardEvent=\{bundle\?\.agent\?\.onPinboardEvent\}/);
    expect(src('../../basis/src/core/agent/realAgent.js')).toMatch(/onPinboardEvent: \(event, handler\) =>/);
    expect(src('../src/core/agentBundle.js')).not.toMatch(/onPinboardEvent/);
  });
});
