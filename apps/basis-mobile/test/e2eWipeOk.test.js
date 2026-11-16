/**
 * The phone walks that DELETE THE APP run on an emulator, or on an agreed test device that the run names in
 * E2E_WIPE_OK. Two locks: the serial must be on the agreed list AND named; any other phone is refused even when a run
 * names it.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mayWipe, WIPEABLE_TEST_DEVICES } = require('../e2e/support/wipeOk.js');

describe('which device a deleting walk may run on', () => {
  it('an emulator, always', () => {
    expect(mayWipe('emulator-5554', {})).toBe(true);
  });
  it('the agreed test Samsung, only when the run names it', () => {
    expect(WIPEABLE_TEST_DEVICES).toContain('RFCT504SRZH');
    expect(mayWipe('RFCT504SRZH', {})).toBe(false);
    expect(mayWipe('RFCT504SRZH', { E2E_WIPE_OK: 'RFCT504SRZH' })).toBe(true);
    expect(mayWipe('RFCT504SRZH', { E2E_WIPE_OK: 'other, RFCT504SRZH' })).toBe(true);
  });
  it('a personal phone (any serial not on the agreed list) is refused even when a run names it', () => {
    expect(mayWipe('PERSONAL0001', { E2E_WIPE_OK: 'PERSONAL0001' })).toBe(false);
  });
  it('no device id: no', () => {
    expect(mayWipe(undefined, { E2E_WIPE_OK: 'RFCT504SRZH' })).toBe(false);
  });
});
