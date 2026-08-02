/**
 * A message the system has given up on must stop looking fine — on BOTH shells.
 *
 * Two hooks, two different facts, one honest outcome:
 *   • `onHoldDropped`  — it never left this device (local hold queue TTL or cap).
 *   • `onUndelivered`  — it left, waited at the relay, and the relay gave up.
 *
 * The reason this is shared code with a test rather than two lines per shell: it WAS two lines in one
 * shell. Mobile consumed both from 2026-07-31 and web consumed neither, so on web a given-up message kept
 * its optimistic state indefinitely — and web is the surface shipping first. Nothing failed, because a
 * report with no listener does not fail; the message just keeps looking fine.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeGiveUpConsumers } from '../../src/v2/deliveryGiveUp.js';

const mapSpy = () => {
  const calls = [];
  return { calls, set: (msgId, state) => calls.push([msgId, state]) };
};

describe('both give-ups land on a state the person can act on', () => {
  it('a dropped HOLD marks the message failed', () => {
    const m = mapSpy();
    const warn = vi.fn();
    makeGiveUpConsumers({ deliveryMap: m, onWarn: warn })
      .onHoldDropped({ msgId: 'm1', reason: 'ttl', addr: 'AAAAbbbbCCCCdddd', ageMs: 90_000 });
    expect(m.calls).toEqual([['m1', 'failed']]);
    expect(String(warn.mock.calls[0][0])).toMatch(/held 90s/);
  });

  it('a relay give-up marks the message failed', () => {
    const m = mapSpy();
    const warn = vi.fn();
    makeGiveUpConsumers({ deliveryMap: m, onWarn: warn }).onUndelivered({ msgId: 'm2', reason: 'expired' });
    expect(m.calls).toEqual([['m2', 'failed']]);
    expect(String(warn.mock.calls[0][0])).toMatch(/relay gave up.*expired/);
  });

  it('the two are told apart in the log, because only one means "we never sent it"', () => {
    const warn = vi.fn();
    const c = makeGiveUpConsumers({ deliveryMap: mapSpy(), onWarn: warn });
    c.onHoldDropped({ msgId: 'a', reason: 'ttl' });
    c.onUndelivered({ msgId: 'b', reason: 'ttl' });
    const [held, relayed] = warn.mock.calls.map((call) => String(call[0]));
    expect(held).not.toBe(relayed);
    expect(relayed).toMatch(/relay/);
  });
});

describe('it cannot make things worse', () => {
  it('ignores a report with no message id', () => {
    const m = mapSpy();
    const c = makeGiveUpConsumers({ deliveryMap: m });
    c.onHoldDropped({});
    c.onUndelivered({});
    c.onHoldDropped();
    expect(m.calls).toEqual([]);
  });

  it('still REPORTS when the delivery map throws', () => {
    // the map failing is exactly when the log is the only record left
    const warn = vi.fn();
    const throwing = { set: () => { throw new Error('map gone'); } };
    expect(() => makeGiveUpConsumers({ deliveryMap: throwing, onWarn: warn })
      .onUndelivered({ msgId: 'm3', reason: 'capacity' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('BOTH shells consume both reports (invariant 2)', () => {
  // Text guard: neither shell file has runtime coverage, and their divergence is precisely how web ended
  // up unable to say a message had been given up on.
  const ROOT = new URL('../../../..', import.meta.url).pathname;
  const shells = {
    web:    'apps/basis/web/v2/circleApp.js',
    mobile: 'apps/basis-mobile/App.js',
  };
  for (const [name, rel] of Object.entries(shells)) {
    it(`${name} builds its give-up consumers from the shared rule`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, `file://${ROOT}`)), 'utf8');
      expect(src).toMatch(/makeGiveUpConsumers\s*\(/);
    });

    it(`${name} does NOT hand-roll its own onHoldDropped/onUndelivered`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, `file://${ROOT}`)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, `${name} defines its own consumer instead of using the shared one`)
        .not.toMatch(/onHoldDropped\s*:\s*\(/);
      expect(src).not.toMatch(/onUndelivered\s*:\s*\(/);
    });
  }
});
