// ownedNodes.js — the headless nodes a person has CLAIMED (a companion), carried in the profile property graph.
//
// A node the person claimed with the code it printed is managed by any of their devices — so the devices must know
// which nodes are theirs: to manage them, and to tell each one when a device is revoked (the root's own tombstone).
// Written under ONE property key as an `{ [address]: record }` map, the same construction as the device delegations:
// it rides the own/inherit property graph and round-trips through export/restore for free.
//
// What this is NOT: the authority. The node keeps its owner (the root) itself; this is the person's own list of where
// they are owner. Pure — web ≡ mobile ≡ box, no I/O.

import { setOwn } from './profileProperties.js';

/** The canonical property key holding the `{ [address]: record }` map. */
export const OWNED_NODES_KEY = 'ownedNodes';

/** A well-formed record: the node's address and when it was claimed; a `label` the person may give it. */
export function isOwnedNodeRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.address !== 'string' || !v.address) return false;
  if (typeof v.claimedAt !== 'string' || !v.claimedAt) return false;
  if (v.label != null && typeof v.label !== 'string') return false;
  return true;
}

/** Read the OWN `{ [address]: record }` map off one registry entry (no inherit chain). */
export function ownedNodesOf(entry) {
  const cur = entry?.properties?.[OWNED_NODES_KEY];
  const map = cur?.mode === 'own' ? cur.value : undefined;
  return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
}

/**
 * Upsert one claimed node as an OWN property. Returns a NEW properties map (other nodes preserved).
 * @param {object} properties
 * @param {{address: string, claimedAt: string, label?: string}} record
 */
export function setOwnedNode(properties, record) {
  if (!isOwnedNodeRecord(record)) throw new TypeError('setOwnedNode: {address, claimedAt} required');
  const cur = properties?.[OWNED_NODES_KEY];
  const curMap = (cur?.mode === 'own' && cur.value && typeof cur.value === 'object' && !Array.isArray(cur.value)) ? cur.value : {};
  const rec = { address: record.address, claimedAt: record.claimedAt, ...(record.label != null ? { label: record.label } : {}) };
  return setOwn(properties ?? {}, OWNED_NODES_KEY, Object.freeze({ ...curMap, [record.address]: Object.freeze(rec) }));
}
