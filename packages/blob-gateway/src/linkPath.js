// linkPath.js — the path of a link a calendar app fetches: one grammar for whoever builds it and whoever serves it.
//
// Two forms, while the household's companion moves off the public box:
//   `/feed/<id>.<k>.ics`          served by a companion that has a public port of its own (behind Caddy);
//   `/feed/<node>/<id>.<k>.ics`   served by the RELAY, which forwards the request over the companion's live session to
//                                 the node the path names. The node's address is public (it is on the node's card), and
//                                 whoever holds the link already reads the agenda, so the path says nothing more.
// `id` names the file, `k` opens it (`sealForLink`); both are `randomKey()`s. A node is an agent address: an Ed25519
// public key, base64url (43 characters).

/** An id or a key as a link carries them: base64url, at least 128 bits (`randomKey()` gives exactly that). */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
/** A node's address in a link: a 32-byte public key, base64url without padding. */
export const LINK_NODE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The path of a link: `/feed/<id>.<k>.ics`, or with `node` `/feed/<node>/<id>.<k>.ics`.
 * @param {{node?: string|null, id: string, k: string}} a
 */
export function feedLinkPath({ node = null, id, k }) {
  return node ? `/feed/${node}/${id}.${k}.ics` : `/feed/${id}.${k}.ics`;
}

/**
 * A link's path read back: `{node, id, k}` (`node` null for the one-segment form), or null when it is neither form or
 * names a node that is not an address. `id` and `k` are read as base64url words; whether they are a real link's is the
 * server's question (`LINK_TOKEN`), and every answer to it is the same miss.
 * @param {string} pathname
 * @returns {{node: string|null, id: string, k: string}|null}
 */
export function parseFeedLinkPath(pathname) {
  const m = /^\/feed\/(?:([^/]+)\/)?([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.ics$/.exec(String(pathname ?? ''));
  if (!m) return null;
  if (m[1] !== undefined && !LINK_NODE.test(m[1])) return null;
  return { node: m[1] ?? null, id: m[2], k: m[3] };
}
