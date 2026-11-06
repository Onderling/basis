/**
 * MY DEVICES NEVER SHOWS A DEVICE ID. A walk (2026-11-05) read "MIJN APPARATEN: d-da5030131bf443aa00f4ffe043be73a5"
 * where Me, on the same phone, said "this device (SM-A336B)". The list now says what Me says.
 */
import { describe, it, expect } from 'vitest';
import { deviceListWords } from '../../src/v2/mijWords.js';

const t = (k, v = {}) => ({
  'circle.profile.agent_here': 'dit apparaat',
  'circle.profile.agent_device_unnamed': 'een ander apparaat',
  'circle.profile.agent_device': `apparaat: ${v.label}`,
}[k] ?? k);
const ID = 'd-da5030131bf443aa00f4ffe043be73a5';

describe('a device in the list', () => {
  it('this device, unnamed, is "this device (its model)" — the name the phone gives', () => {
    expect(deviceListWords({ deviceId: ID, label: null }, { thisDeviceId: ID, deviceName: 'SM-A336B', t })).toBe('dit apparaat (SM-A336B)');
  });
  it('another unnamed device is "another device", never its id', () => {
    const w = deviceListWords({ deviceId: ID, label: null }, { thisDeviceId: 'd-other', deviceName: 'SM-A336B', t });
    expect(w).toBe('een ander apparaat');
    expect(w).not.toContain('d-');
  });
  it('a device the person named is called that', () => {
    expect(deviceListWords({ deviceId: ID, label: 'box' }, { thisDeviceId: 'd-other', t })).toBe('apparaat: box');
  });
});
