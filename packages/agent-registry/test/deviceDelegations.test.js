// The enrolled-devices property map — set/read/tombstone semantics (add-a-device bookkeeping).
import { describe, it, expect } from 'vitest';
import {
  DEVICE_DELEGATIONS_KEY, isDeviceDelegationRecord, normaliseDeviceDelegation,
  deviceDelegationsOf, deviceDelegationOf, setDeviceDelegation,
} from '../index.js';

const rec = (deviceId, extra = {}) => ({
  profileId: 'default', deviceId, pubKey: `pk-${deviceId}`, by: 'root-pk', sig: `sig-${deviceId}`, ...extra,
});

describe('deviceDelegations property map', () => {
  it('set → read roundtrip; other devices preserved', () => {
    let props = {};
    props = setDeviceDelegation(props, 'dev-1', rec('dev-1', { label: 'telefoon' }));
    props = setDeviceDelegation(props, 'dev-2', rec('dev-2'));
    const entry = { properties: props };
    expect(Object.keys(deviceDelegationsOf(entry)).sort()).toEqual(['dev-1', 'dev-2']);
    expect(deviceDelegationOf(entry, 'dev-1').label).toBe('telefoon');
    expect(deviceDelegationOf(entry, 'dev-3')).toBeNull();
  });

  it('a re-set REPLACES the record (signed statement, no facet merge)', () => {
    let props = setDeviceDelegation({}, 'dev-1', rec('dev-1', { label: 'oud' }));
    props = setDeviceDelegation(props, 'dev-1', rec('dev-1'));
    expect(deviceDelegationOf({ properties: props }, 'dev-1').label).toBeUndefined();
  });

  it('the tombstone patch: {revoked:true} alone flips the flag, keeps the signed fields', () => {
    let props = setDeviceDelegation({}, 'dev-1', rec('dev-1'));
    props = setDeviceDelegation(props, 'dev-1', { revoked: true });
    const after = deviceDelegationOf({ properties: props }, 'dev-1');
    expect(after.revoked).toBe(true);
    expect(after.sig).toBe('sig-dev-1');
  });

  it('rejects invalid records loudly (restore data must not silently vanish)', () => {
    expect(() => setDeviceDelegation({}, 'dev-1', { deviceId: 'dev-1' })).toThrow();
    expect(() => setDeviceDelegation({}, 'dev-1', { revoked: true })).toThrow();   // tombstone needs an existing record
    expect(() => setDeviceDelegation({}, '', rec('x'))).toThrow();
    expect(isDeviceDelegationRecord(rec('dev-1'))).toBe(true);
    expect(isDeviceDelegationRecord({ ...rec('dev-1'), sig: 7 })).toBe(false);
    expect(normaliseDeviceDelegation({ ...rec('dev-1'), unknown: 'x' }).unknown).toBeUndefined();
  });

  it('reads tolerate an absent/foreign-shaped property', () => {
    expect(deviceDelegationsOf({})).toEqual({});
    expect(deviceDelegationsOf({ properties: { [DEVICE_DELEGATIONS_KEY]: { mode: 'own', value: [] } } })).toEqual({});
  });
});
