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
