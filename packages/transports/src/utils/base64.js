/**
 * Standard base64 (btoa/atob, WITH padding) — the encoding used at the mDNS/BLE NATIVE BOUNDARY.
 *
 * ⚠ NOT interchangeable with `@onderling/core`'s `crypto/b64.js`, which is base64URL without padding.
 * The Kotlin side decodes standard base64, so swapping the two silently breaks the wire — a frame that
 * decodes to garbage rather than an error. Keep them separate on purpose.
 *
 * Lives here rather than in the React Native package because the mDNS transport's routing layer is
 * platform-neutral and a Node backend needs the same encoding; `@onderling/react-native`'s
 * `utils/base64.js` re-exports these so BleTransport keeps one source.
 */
export function b64Encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
