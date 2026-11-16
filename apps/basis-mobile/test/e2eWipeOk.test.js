/**
 * The phone walks that DELETE THE APP run on an emulator, or on an agreed test device that the run names in
 * E2E_WIPE_OK. Two locks: the serial must be on the agreed list AND named; Frits's own Fairphone is refused whatever a
 * run says (it is his daily phone).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mayWipe, WIPEABLE_TEST_DEVICES, PERSONAL_PHONES } = require('../e2e/support/wipeOk.js');

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
  it('a device that is not on the agreed list, even when a run names it', () => {
    expect(mayWipe('ZZ0000UNKNOWN', { E2E_WIPE_OK: 'ZZ0000UNKNOWN' })).toBe(false);
  });
  it('the Fairphone, never: not on the list, refused even when named', () => {
    expect(PERSONAL_PHONES).toContain('c53828f5');
    expect(WIPEABLE_TEST_DEVICES).not.toContain('c53828f5');
    expect(mayWipe('c53828f5', { E2E_WIPE_OK: 'c53828f5' })).toBe(false);
  });
  it('no device id: no', () => {
    expect(mayWipe(undefined, { E2E_WIPE_OK: 'RFCT504SRZH' })).toBe(false);
  });
});
