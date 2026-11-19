/**
 * Whether THIS DEVICE KIND has a local mesh (ledger L1051): the native mDNS module is in the build. Known at once, at
 * the first frame, before the mesh builder runs (it starts mDNS seconds into a boot, and a slow start held the Nearby
 * tab back ~12 s on a seeded phone). The surface's affordance for "may this shell show Nearby?", so the shell never
 * reaches for a transport or waits for one: the tab shows from the first frame, and its content (the mesh surface's
 * discoverability) says it is starting, or unavailable when mDNS never comes up (Wi-Fi off). Same test as
 * `MdnsTransport.isAvailable()`, without loading the transport.
 */
import { NativeModules } from 'react-native';

/** @returns {boolean} */
export function meshCapable() {
  return Boolean(NativeModules?.MdnsModule);
}
