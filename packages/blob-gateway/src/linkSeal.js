// linkSeal.js — a blob that opens with the key a LINK carries.
//
// For a reader that is no agent (a calendar app: no key pair, no contact row, it can only fetch a URL), the key travels
// in the link itself: `…/<id>.<k>…`. The writer seals with `k`, the host stores only the envelope, and opens it at serve
// time with the `k` the request brings — so the stored object is ciphertext, as everything in a bucket is.
//
// `k` is a bucket-style random key (`randomKey()`, 128 bits, base64url); the secretbox key (256 bits) is derived from it
// with SHA-256 under a domain tag, so the link stays short and a link key is never a key for anything else.

import { sealTunnelOW, openTunnelOW, hashHex } from '@onderling/core';
import { bytesToB64u } from './bytes.js';

const TAG = 'onderling-link-seal|v1|';

/** The secretbox key a link key opens. */
function boxKey(k) {
  const hex = hashHex(`${TAG}${k}`);
  const u8 = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToB64u(u8);
}

/** Is this a link-sealed envelope (the only thing a host may store for a link)? */
export function isLinkSealed(envelope) {
  if (typeof envelope !== 'string') return false;
  try { const o = JSON.parse(envelope); return o?.v === 1 && typeof o.sealed === 'string' && typeof o.nonce === 'string'; } catch { return false; }
}

/** Seal text to a link key: the envelope (a string) to store. */
export function sealForLink(text, k) {
  if (typeof k !== 'string' || !k) throw new Error('sealForLink: a link key is required');
  const { sealed, nonce } = sealTunnelOW({ key: boxKey(k), innerOW: { text: String(text) } });
  return JSON.stringify({ v: 1, sealed, nonce });
}

/** Open an envelope with a link key: the text, or null (wrong key, not an envelope). */
export function openForLink(envelope, k) {
  if (typeof k !== 'string' || !k || !isLinkSealed(envelope)) return null;
  const { sealed, nonce } = JSON.parse(envelope);
  const inner = openTunnelOW({ key: boxKey(k), sealed, nonce });
  return typeof inner?.text === 'string' ? inner.text : null;
}
