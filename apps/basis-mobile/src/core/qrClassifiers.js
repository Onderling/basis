/**
 * basis-mobile QR classifiers.
 *
 * Two payload shapes the mobile scanner accepts today (2026-05-27):
 *
 *   - kind 'contact' — `onderling-contact://<base64url-encoded-card>`
 *     (output of /share-my-contact); routes via stoop's
 *     `addContactFromQr` skill.
 *   - kind 'invite'  — `onderling-invite://<base64url-encoded-invite>`, a URL
 *     with `?invite=<encoded-json>` (output of /create-group), or the app's own
 *     deep link `…?join=<encoded>&relay=<ws url>` (2026-09-08). The last one is
 *     what the app's OWN invite QR contains, and until this the native scanner
 *     could not read it: it matched `?invite=` only. The scanned relay is dialled
 *     BESIDE the device's own; the reader is shared with web (`inviteDeepLink.js`).
 *
 * Built on @onderling/react-native/qr's plug-in dispatcher
 * (`classifyQrPayload(text, classifiers)`).  Pure JS, no Expo deps —
 * testable with vitest.
 */

import { parseInviteDeepLink } from '../../../basis/src/v2/inviteDeepLink.js';
import { enrollOfferFromLink } from '../../../basis/src/v2/enrollOffer.js';

const STOOP_CONTACT_SCHEME = 'onderling-contact://';
const STOOP_INVITE_SCHEME  = 'onderling-invite://';
const PAIR_SCHEME          = 'onderling-pair://';

/**
 * @returns {Array<{kind: string, classify: (text: string) => unknown|null}>}
 */
export function getBasisClassifiers() {
  return [
    { kind: 'contact', classify: _classifyContact },
    { kind: 'invite',  classify: _classifyInvite  },
    { kind: 'pair',    classify: _classifyPair    },
    { kind: 'enroll',  classify: _classifyEnroll  },
  ];
}

// Adding a device of your OWN. Both carriers go through the SHARED reader, which takes the raw
// `onderling-enroll://` code and the clickable `#enroll=` link alike — so the box printing a link and
// a person scanning a code end up in the same place. It classifies LAST because it is the narrowest:
// nothing else answers to that scheme or that hash key.
//
// Until this, mobile accepted an offer only by PASTE. A scanned code and a tapped link both fell to
// 'unknown' — the same shape as the invite-link bug this file's header records, on the flow a person
// adding their second device is most likely to use.
function _classifyEnroll(text) {
  if (typeof text !== 'string') return null;
  const parsed = enrollOfferFromLink(text);
  return parsed.ok ? parsed.uri : null;
}

// OBJ-2 device/agent pairing: `onderling-pair://<addr>?name=<label>` (output of the paired-devices QR).
// The owning screen passes the payload to parsePairUri → addCirclePeer.
function _classifyPair(text) {
  return typeof text === 'string' && text.startsWith(PAIR_SCHEME) ? text : null;
}

function _classifyContact(text) {
  return typeof text === 'string' && text.startsWith(STOOP_CONTACT_SCHEME)
    ? text
    : null;
}

function _classifyInvite(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith(STOOP_INVITE_SCHEME)) return text;
  // Every link form goes through the SHARED reader, so what one shell writes the other can read. It
  // returns the invite URI plus the relay the link names; the scan handler dials that relay and hands
  // the URI to the wizard, which is what `decodeInvite` has always expected.
  return parseInviteDeepLink(text);
}
