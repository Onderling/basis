/**
 * `--nearby` — the grammar, and the two things it must never get wrong.
 *
 * The flag exists because the companion has been able to join a nearby room since 2026-08-30 and the
 * only way to ask for it was to write a program. On 2026-08-31 the person who wrote that program forgot
 * it existed, which is the real cost of a capability with no door.
 *
 * Two properties matter more than the parsing:
 *   · you cannot publish by accident — `--nearby` alone browses, and announcing is spelled out;
 *   · a value that makes no sense is an ERROR, never a quiet OFF, because "nobody is nearby" and "the
 *     radio never started" look identical from the outside.
 */
import { describe, it, expect } from 'vitest';
import { parseNearbyFlag, parseDuration } from '../src/nearbyFlag.js';

const flag = (...argv) => parseNearbyFlag(argv, {});

describe('--nearby', () => {
  it('is OFF when nothing asks for it — the plugin is never even imported', () => {
    expect(flag()).toEqual({ nearby: false });
    expect(flag('--port=8787')).toEqual({ nearby: false });
  });

  it('browses by default: bare --nearby sees the room and announces nothing', () => {
    expect(flag('--nearby')).toEqual({ nearby: { mdns: true } });
    expect(flag('--nearby=browse')).toEqual({ nearby: { mdns: true } });
    // The property, stated as itself: no spelling of "on" turns publishing on by itself.
    for (const on of ['--nearby', '--nearby=browse', '--nearby=true', '--nearby=1']) {
      expect(flag(on).nearby.publish, `${on} must not announce`).toBeUndefined();
    }
  });

  it('announces only when asked, and can be bounded in time', () => {
    expect(flag('--nearby=publish')).toEqual({ nearby: { mdns: true, publish: true } });
    expect(flag('--nearby=publish:30m')).toEqual({ nearby: { mdns: true, publish: true, publishFor: 1_800_000 } });
    expect(flag('--nearby=publish:90s').nearby.publishFor).toBe(90_000);
    expect(flag('--nearby=publish:2h').nearby.publishFor).toBe(7_200_000);
    expect(flag('--nearby=publish:45').nearby.publishFor, 'a bare number is minutes').toBe(2_700_000);
  });

  it('carries a label through, and only when one is given', () => {
    expect(flag('--nearby', '--nearby-label=laptop-companion').nearby.label).toBe('laptop-companion');
    expect(flag('--nearby').nearby.label).toBeUndefined();
    expect(flag('--nearby-label=x').nearby, 'a label alone does not turn the radio on').toBe(false);
  });

  it('REFUSES a value it does not understand instead of falling back to off', () => {
    const bad = flag('--nearby=shout');
    expect(bad.nearby).toBe(false);
    expect(bad.error, 'the sentence names what was expected and what came').toMatch(/publish/);
    expect(flag('--nearby=publish:soon').error).toMatch(/duration/);
    expect(flag('--nearby=publish:0').error).toMatch(/duration/);
  });

  it('takes the same values from COMPANION_NEARBY, and the flag wins', () => {
    expect(parseNearbyFlag([], { COMPANION_NEARBY: 'publish:10m' }).nearby)
      .toEqual({ mdns: true, publish: true, publishFor: 600_000 });
    expect(parseNearbyFlag([], { COMPANION_NEARBY: 'off' }).nearby).toBe(false);
    expect(parseNearbyFlag(['--nearby'], { COMPANION_NEARBY: 'publish' }).nearby)
      .toEqual({ mdns: true });
  });

  it('parseDuration: units, and a refusal rather than a guess', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('  15 ')).toBe(900_000);
    for (const bad of ['', 'h', '-5m', '1d', 'abc', null, undefined]) expect(parseDuration(bad)).toBeNull();
  });
});
