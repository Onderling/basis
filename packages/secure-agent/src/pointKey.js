/**
 * The ONE comparison form of a connection point (a relay url).
 *
 * A circle's scope names its relays as the points recorded at join or by hand; a relay socket knows the url it
 * dialled. Both are typed or copied by people and by code, so the same relay arrives under several spellings: a
 * trailing slash, an upper-case host, the scheme's default port written out, or the http(s) form of the ws(s) url.
 * Compared as raw strings, a circle's traffic then silently skips its own relay (the scope reads "not one of my
 * points") and either holds or rides something else. Every comparison of a point against a socket goes through here.
 *
 * What it does NOT do: resolve names. A domain and its IP address, or `localhost` and `127.0.0.1`, stay different
 * points; knowing they are one host needs a lookup this layer must not make. A harness that reaches one relay under
 * two names (the Android emulator sees the host as 10.0.2.2) must use the same name everywhere.
 *
 * @param {unknown} url
 * @returns {string} the comparison key; '' for no value; an unparseable value keyed to itself, trimmed
 */
export function pointKey(url) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { return s; }
  const scheme = u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol;
  const defaultPort = scheme === 'wss:' ? '443' : scheme === 'ws:' ? '80' : '';
  const port = u.port && u.port !== defaultPort ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `${scheme}//${u.hostname.toLowerCase()}${port}${path}${u.search}`;
}

/** Do `a` and `b` name the same connection point? Two empty values never do. */
export function samePoint(a, b) {
  const ka = pointKey(a);
  return ka !== '' && ka === pointKey(b);
}
