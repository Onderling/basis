/**
 * basis-mobile QR classifiers.
 *
 * Two payload shapes the mobile scanner accepts today (2026-05-27):
 *
 *   - kind 'contact' — `stoop-contact://<base64url-encoded-card>`
 *     (output of /share-my-contact); routes via stoop's
 *     `addContactFromQr` skill.
 *   - kind 'invite'  — `stoop-invite://<base64url-encoded-invite>` OR
 *     a URL with `?invite=<encoded-json>` (output of /create-group);
 *     routes via the joinGroup wizard, which already accepts the URL
 *     verbatim (decodeInvite is in core/wizards/joinGroupState.js).
 *
 * Built on @onderling/react-native/qr's plug-in dispatcher
 * (`classifyQrPayload(text, classifiers)`).  Pure JS, no Expo deps —
 * testable with vitest.
 */

const STOOP_CONTACT_SCHEME = 'stoop-contact://';
const STOOP_INVITE_SCHEME  = 'stoop-invite://';
const PAIR_SCHEME          = 'onderling-pair://';

/**
 * @returns {Array<{kind: string, classify: (text: string) => unknown|null}>}
 */
export function getBasisClassifiers() {
  return [
    { kind: 'contact', classify: _classifyContact },
    { kind: 'invite',  classify: _classifyInvite  },
    { kind: 'pair',    classify: _classifyPair    },
  ];
}

// OBJ-2 device/agent pairing: `onderling-pair://<addr>?name=<label>` (output of the paired-devices QR).
// The owning screen passes the payload to parsePairUri → addHouseholdPeer.
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
  // Also accept URLs with `?invite=<encoded>` query — the form
  // stoop's web onboarding emits.
  if (/[?&]invite=[^&#]+/i.test(text)) return text;
  return null;
}
