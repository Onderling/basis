// The scannable invite: a phone camera opens the HOSTED app with ?join=<invite> (+ the admin's relay).
// The link must point at wherever THIS app is served — a site root, or a path under a site such as
// https://onderling.org/basis/ — so it is derived from the page's own location, never a hardcoded root.
// (2026-09-07: the first hosted build lived under /basis/ and its QR pointed at the site root, which
// is the website, not the app.)

/** The app's own base URL: origin + directory of the page (index.html and any file name stripped). */
export function appBaseUrl(loc) {
  const dir = String(loc.pathname || '/').replace(/[^/]*$/, '');   // drop the last segment when it is a file
  return `${loc.origin}${dir.endsWith('/') ? dir : `${dir}/`}`;
}

/** The deep link for an invite URI, optionally carrying the relay to dial. Same encoding the reader expects. */
export function inviteDeepLink(loc, inviteUri, relayUrl) {
  return `${appBaseUrl(loc)}?join=${encodeURIComponent(inviteUri)}`
    + (relayUrl ? `&relay=${encodeURIComponent(relayUrl)}` : '');
}

/**
 * The READER for everything this file writes — and for the two older invite shapes (2026-09-08).
 *
 * A QR built by `inviteDeepLink` is an ordinary https link carrying `?join=` and maybe `&relay=`. A phone
 * camera opens it in the browser, which is the point; but the NATIVE app's scanner only ever understood
 * `onderling-invite://` and `?invite=`, so scanning the app's own QR with the app did nothing. One reader,
 * both shells, so what one writes the other can always read.
 *
 * @param {string} text  a scanned code, a pasted link, or a bare invite URI
 * @returns {{inviteUri: string, relayUrl: string|null}|null}  null when it is not an invite at all
 */
export function parseInviteDeepLink(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;
  // A bare invite URI (the scheme, or the JSON it wraps) — nothing to unpack, and no relay to learn.
  if (/^onderling-invite[:/]/i.test(raw) || raw.startsWith('{')) return { inviteUri: raw, relayUrl: null };

  const q = raw.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(raw.slice(q + 1).split('#')[0]);
  // `join` is what this file writes; `invite` is the older web-onboarding form. Either is the invite.
  const invite = params.get('join') ?? params.get('invite');
  if (!invite) return null;
  const relay = params.get('relay');
  return {
    inviteUri: invite,
    // Only a websocket endpoint is a relay. A link that names anything else names nothing.
    relayUrl: typeof relay === 'string' && /^wss?:\/\/\S+$/.test(relay.trim()) ? relay.trim() : null,
  };
}
