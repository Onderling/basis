/**
 * btoa/atob-based base64 helpers that work in React Native without Buffer.
 * Used by BleTransport (chunked GATT framing) and MdnsTransport (send/receive).
 *
 * The implementation moved to `@onderling/transports/utils/base64` when the mDNS routing layer became
 * platform-neutral: it is part of the NATIVE BOUNDARY contract, so the Android backend and a Node one must
 * encode identically. Re-exported here so BleTransport's import is unchanged and there is one source.
 *
 * ⚠ Standard base64 WITH padding — not `@onderling/core`'s base64url. Swapping them breaks the wire
 * silently.
 */
export { b64Encode, b64Decode } from '@onderling/transports/utils/base64';
