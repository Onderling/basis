import { describe, it, expect } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
// the stores here seal at rest (ledger L1083): a content key is published, as after a boot
setShellContentSeal(groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url') }));
import {
  DEFAULT_AVAILABILITY, normalizeAvailability, mergeAvailability, isPushSuppressed,
  createAvailabilityStore, localStorageAvailabilityIo,
} from '../../src/v2/memberAvailability.js';

describe('memberAvailability · normalize', () => {
  it('fills defaults + coerces booleans + validates times', () => {
    expect(normalizeAvailability()).toEqual(DEFAULT_AVAILABILITY);
    const a = normalizeAvailability({
      holiday: { active: 1, until: '2026-06-09' },
      quietHours: { enabled: 1, from: '9', to: '25:00', weekends: 1 },
    });
    expect(a.holiday).toEqual({ active: true, until: '2026-06-09' });
    expect(a.quietHours.enabled).toBe(true);
    expect(a.quietHours.from).toBe('22:00'); // invalid '9' → default
    expect(a.quietHours.to).toBe('07:30');   // invalid '25:00' → default
    expect(a.quietHours.weekends).toBe(true);
  });
});

describe('memberAvailability · merge', () => {
  it('deep-merges holiday + quietHours independently', () => {
    const base = normalizeAvailability({ holiday: { active: true } });
    const next = mergeAvailability(base, { quietHours: { enabled: true } });
    expect(next.holiday.active).toBe(true);
    expect(next.quietHours.enabled).toBe(true);
  });
});

describe('isPushSuppressed', () => {
  it('holiday: suppressed within the until window, not after', () => {
    const a = { holiday: { active: true, until: '2026-06-09' } };
    expect(isPushSuppressed(a, new Date('2026-06-05T12:00:00'))).toBe(true);
    expect(isPushSuppressed(a, new Date('2026-06-10T12:00:00'))).toBe(false);
  });
  it('holiday with no end date is always suppressed', () => {
    expect(isPushSuppressed({ holiday: { active: true } }, new Date())).toBe(true);
  });
  it('overnight quiet hours wrap midnight', () => {
    const a = { quietHours: { enabled: true, from: '22:00', to: '07:30' } };
    expect(isPushSuppressed(a, new Date('2026-06-05T23:00:00'))).toBe(true);
    expect(isPushSuppressed(a, new Date('2026-06-05T06:00:00'))).toBe(true);
    expect(isPushSuppressed(a, new Date('2026-06-05T12:00:00'))).toBe(false);
  });
  it('weekends-all-day suppresses midday on a weekend', () => {
    const a = { quietHours: { enabled: true, from: '22:00', to: '07:30', weekends: true } };
    const d = new Date('2026-06-01T12:00:00');
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1); // next Saturday, midday
    expect(isPushSuppressed(a, d)).toBe(true);
  });
  it('default availability suppresses nothing', () => {
    expect(isPushSuppressed(DEFAULT_AVAILABILITY, new Date('2026-06-05T12:00:00'))).toBe(false);
  });
});

describe('availability store', () => {
  it('get defaults, update merges + persists', async () => {
    let saved = null;
    const store = createAvailabilityStore({ load: async () => saved, save: async (a) => { saved = a; } });
    expect(await store.get()).toEqual(DEFAULT_AVAILABILITY);
    const after = await store.update({ holiday: { active: true, until: '2026-06-09' } });
    expect(after.holiday.active).toBe(true);
    expect(saved).toEqual(after);
  });

  it('localStorageAvailabilityIo round-trips under basis.availability', async () => {
    const map = new Map();
    const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
    const io = localStorageAvailabilityIo(storage);
    await io.save({ quietHours: { enabled: true } });
    expect(await io.load()).toEqual({ quietHours: { enabled: true } });
    expect(map.has('basis.availability')).toBe(true);
  });
});
