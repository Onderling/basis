/**
 * react-native-ble-plx — ABSENT in this app, honestly (batch 7).
 *
 * basis-mobile does not declare the BLE native dep, and the mesh builder's BleTransport import is
 * lazy — it only ever executes when a caller passes `enable.ble: true`, which basis never does
 * (mDNS-only). Metro still RESOLVES the module statically (dynamic import or not), so an absent
 * package is a build failure before any runtime check runs; this stub is what lets the shared
 * builder live in the bundle while BLE stays off. If BLE is ever enabled here: add the real dep,
 * rebuild the dev client, drop this shim — `BleTransport` throws loudly below rather than
 * pretending a radio exists.
 */
export class BleManager {
  constructor() { throw new Error('react-native-ble-plx is not installed in basis-mobile (BLE is off; see src/shims/bleAbsent.js)'); }
}
export const State = Object.freeze({ PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff' });
