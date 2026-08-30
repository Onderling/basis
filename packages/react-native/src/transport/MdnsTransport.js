/**
 * MdnsTransport (Android) — the routing layer from `@onderling/transports`, with the Android backend
 * injected.
 *
 * Everything that is not Android lives in `@onderling/transports/mdns`: the pubKey ↔ connection maps, the
 * tiebreaker, the `_mdns_hello` handshake, the discoverability states, and the wire contract those imply.
 * This file supplies the two platform pieces — the compiled native module and its event emitter — and the
 * availability guard the mesh builder calls before constructing anything.
 *
 * ── The backend ──────────────────────────────────────────────────────────────
 * `MdnsModule.kt` does all mDNS (DNS-SD via Android `NsdManager`) and TCP socket work, including framing
 * (4-byte big-endian length prefix + `DataInputStream.readFully`), so each `MdnsDataReceived` event carries
 * exactly one complete message.
 *
 * ── Dependencies ─────────────────────────────────────────────────────────────
 * No npm peer dependencies — requires MdnsModule.kt + MdnsPackage.kt to be compiled into the Android app
 * (already registered in MainApplication.kt). react-native-zeroconf and react-native-tcp-socket are not
 * used.
 *
 * ── To disable ───────────────────────────────────────────────────────────────
 * The mesh builder already guards on `MdnsTransport.isAvailable()`, which is false wherever the native
 * module is not compiled in — iOS included. Skip the mdns block in the builder to disable it deliberately.
 *
 * The import path here is the SUBPATH (`/mdns`) rather than the package barrel on purpose: the barrel
 * reaches RelayTransport and therefore `ws`, which has no business in a Metro bundle.
 */
import { NativeModules, NativeEventEmitter } from 'react-native';
import { MdnsTransport as MdnsRouter, SERVICE_TYPE } from '@onderling/transports/mdns';

const MdnsNative  = NativeModules.MdnsModule ?? null;
const mdnsEmitter = MdnsNative ? new NativeEventEmitter(MdnsNative) : null;

export { SERVICE_TYPE };

export class MdnsTransport extends MdnsRouter {
  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   * @param {string} [opts.hostname]  — mDNS service name (defaults to pubKey slice)
   */
  constructor({ identity, hostname = null } = {}) {
    if (!MdnsNative) throw new Error(
      'MdnsTransport: MdnsModule native module not found. '
      + 'Is MdnsPackage registered in MainApplication.kt?'
    );
    super({ identity, hostname, native: MdnsNative, emitter: mdnsEmitter });
  }

  /**
   * Returns false if the native module is not compiled into the app. Use this to skip instantiation
   * during development, or on platforms where MdnsModule.kt is not available (there is no iOS module).
   */
  static isAvailable() {
    return MdnsNative !== null;
  }

  /**
   * Does the compiled native module have the split (browse without publishing), or only the combined
   * `start()`? Static because callers ask before constructing; the instance method on the router answers
   * the same question for whichever backend it was given.
   */
  static supportsSplit() {
    return typeof MdnsNative?.startAdvertising === 'function'
        && typeof MdnsNative?.startDiscovery   === 'function';
  }
}
