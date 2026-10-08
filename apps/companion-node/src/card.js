/**
 * The companion as a CONTACT — the card its owner's app (and, through it, a household bot) adds it by.
 *
 * The same card a person hands out (`onderling-contact://…`, stoop's codec — the one encoder and the one decoder): the
 * node's address as its id, key and peer address, the relay it is found on, and — when it holds people's agenda files —
 * `serves`: the public https address its links are served at. A node on a tablet has no port of its own, so that is
 * the RELAY's public address: the relay forwards `/feed/<node>/<id>.<k>.ics` to this node over its live session
 * (`@onderling/relay`'s `feedForward.js`). It is mapped from the relay the node dials (`wss://relay.example` →
 * `https://relay.example`); a node that dials its relay by an inside name (`ws://relay:8787` on the box) says its public
 * address explicitly (`publicUrl`, `COMPANION_PUBLIC_URL`). Everything on the card is public: an address, a relay.
 */
import { encodeContactCard } from '../../stoop/src/lib/contactCard.js';

const CONTACT_SCHEME = 'onderling-contact://';

/** `ws(s)://host[/path]` → `http(s)://host[/path]`; an http(s) URL as it is; anything else null. No trailing slash. */
export function httpFormOf(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  const scheme = { 'ws:': 'http:', 'wss:': 'https:', 'http:': 'http:', 'https:': 'https:' }[u.protocol];
  if (!scheme || u.search || u.hash) return null;
  return `${scheme}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** …and back: the relay URL a client dials at that address. */
function wsFormOf(httpUrl) {
  return httpUrl.replace(/^http(s?):/, 'ws$1:');
}

/**
 * @param {object} a
 * @param {string}  a.address     this node's address
 * @param {string}  a.relayUrl    the relay it dials
 * @param {string}  [a.publicUrl] the relay's public address when `relayUrl` is an inside name
 * @param {boolean} [a.feeds]     whether it serves agenda links (the card then says where)
 * @returns {string} the `onderling-contact://` card
 */
export function companionCard({ address, relayUrl, publicUrl, feeds = false }) {
  const publicHttp = publicUrl ? httpFormOf(publicUrl) : httpFormOf(relayUrl);
  if (publicUrl && !publicHttp) throw new Error('companion: the public address must be an http(s) URL');
  const relay = publicUrl ? wsFormOf(publicHttp) : relayUrl;
  return CONTACT_SCHEME + encodeContactCard({
    webid: address,
    pubKey: address,
    peerAddr: address,
    ...(relay ? { relays: [relay] } : {}),
    ...(feeds && publicHttp ? { serves: publicHttp } : {}),
  });
}
