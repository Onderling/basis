/**
 * Household substrate-mirror — cross-device household-item fan-out.
 *
 * OBJ-2 S2: now a THIN wrapper over the shared generic `wireItemMirror`
 * (`@onderling/notify-envelope`), which tasks-v0 also uses. Household-specific bits:
 * the envelope `kind` ('household-item'), the per-circle URI namespace, and the
 * draft reconstruction (generic item fields only — no tasks-specific
 * dependencies/requiredSkills/approval/reviewLog). Action inference uses the
 * shared default (no reviewLog branch — household has none).
 *
 * `itemStore` is the RAW `@onderling/item-store` ItemStore (reach it via
 * `InMemoryStore.substrate`).
 *
 * @param {object} args
 * @param {import('@onderling/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope
 * @param {object} args.pseudoPod
 * @param {string} args.circleId
 * @param {Array<{pubKey:string}>} [args.peers]
 * @param {string} [args.selfPubKey]
 * @returns {Promise<{
 *   addPeer:(pubKey:string)=>Promise<void>, removePeer:(pubKey:string)=>void,
 *   stop:()=>Promise<void>, listPeers:()=>string[], getPeers:()=>string[],
 *   urlFor:(itemId:string)=>string,
 *   publishItem:(item:object, opts?:object)=>Promise<void>,
 *   publishItemRemoved:(originalId:string, opts?:object)=>Promise<void>,
 * }>}
 */
import { wireItemMirror } from '@onderling/notify-envelope';

/** Reconstruct an `addItems` draft from a synced household-item payload. */
function householdDraft(payload, fromPubKey) {
  return {
    type: payload.type ?? 'task',
    text: payload.text ?? '(synced)',
    ...(payload.dueAt !== undefined ? { dueAt: payload.dueAt } : {}),
    ...(payload.notes ? { notes: payload.notes } : {}),
    ...(payload.embeds ? { embeds: payload.embeds } : {}),
    ...(payload.visibility ? { visibility: payload.visibility } : {}),
    source: {
      synced:       true,
      syncedFromId: payload.id,
      fromPubKey,
      ...(payload.source ?? {}),
    },
  };
}

export async function wireHouseholdSubstrateMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  circleId,
  peers = [],
  selfPubKey = null,
}) {
  const mirror = await wireItemMirror({
    itemStore,
    notifyEnvelope,
    pseudoPod,
    scopeId:    circleId,
    kind:       'household-item',
    uriPrefix:  (id) => `/household/circles/${id}/items/`,
    toDraft:    householdDraft,
    scopeField: 'circleId',
    peers,
    selfPubKey,
  });
  // Preserve household's vocabulary on the surface (publishItem / publishItemRemoved).
  const { publish, publishRemoved, ...rest } = mirror;
  return { ...rest, publishItem: publish, publishItemRemoved: publishRemoved };
}
