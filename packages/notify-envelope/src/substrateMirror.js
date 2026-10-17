/**
 * wireItemMirror — the generic item-store substrate mirror (OBJ-2 S2).
 *
 * The single shared core behind tasks-v0's `wireTasksSubstrateMirror` and
 * household's `wireHouseholdSubstrateMirror`, which were ~identical copies. It
 * wires a per-scope "publish on write, mirror on receive" flow over a
 * `@onderling/notify-envelope` + `@onderling/pseudo-pod` pair so an item written on
 * device A shows up in device B's `@onderling/item-store` ItemStore. The
 * app-specific bits are injected, so behaviour is unchanged per app:
 *   - `kind` / `removedKind` — the envelope kinds ('task', 'household-item', …)
 *   - `uriPrefix`            — the per-scope URI namespace (string or fn(scopeId))
 *   - `toDraft`              — reconstruct an `addItems` draft from a synced payload
 *   - `inferAction`          — map a local→next transition to a sync action tag
 *   - `scopeField`           — optional metadata field stamped on published envelopes
 *
 * It is transport-agnostic: it doesn't know whether the notify-envelope's
 * transport is the in-process bus or basis's secure-mesh wire.
 *
 * `itemStore` is the RAW ItemStore (substrate API: addItems / applySync /
 * removeSync / listOpen / listClosed), NOT a legacy adapter.
 *
 * (Pinboard's mirror is intentionally NOT built on this — it has a different shape:
 * kind 'request', a backfill model, evictionRoster + agentRegistry, add-only.)
 *
 * @param {object} args
 * @param {import('@onderling/item-store').ItemStore} args.itemStore
 * @param {object} args.notifyEnvelope
 * @param {object} args.pseudoPod
 * @param {string} args.scopeId                 circle/circle id (URI namespace)
 * @param {string} args.kind                    envelope kind for item writes
 * @param {string} [args.removedKind]           envelope kind for hard-deletes (default `${kind}-removed`)
 * @param {string|((scopeId:string)=>string)} args.uriPrefix
 * @param {(payload:object, fromPubKey:string|null)=>object} args.toDraft
 * @param {(local:object, next:object)=>string} [args.inferAction]
 * @param {string|null} [args.scopeField]       e.g. 'circleId' | 'circleId' — stamped on published envelopes
 * @param {Array<{pubKey:string}>} [args.peers]
 * @param {string|null} [args.selfPubKey]
 * @returns {Promise<{
 *   addPeer:(pubKey:string)=>Promise<void>, removePeer:(pubKey:string)=>void,
 *   stop:()=>Promise<void>, listPeers:()=>string[], getPeers:()=>string[],
 *   urlFor:(itemId:string)=>string,
 *   publish:(item:object, opts?:object)=>Promise<void>,
 *   publishRemoved:(originalId:string, opts?:object)=>Promise<void>,
 * }>}
 */
export async function wireItemMirror({
  itemStore,
  notifyEnvelope,
  pseudoPod,
  scopeId,
  kind,
  removedKind,
  uriPrefix,
  toDraft,
  inferAction = defaultInferAction,
  scopeField = null,
  peers = [],
  selfPubKey = null,
}) {
  if (!itemStore?.addItems)      throw new Error('wireItemMirror: itemStore required');
  if (!notifyEnvelope?.subscribe) throw new Error('wireItemMirror: notifyEnvelope required');
  if (!pseudoPod?.write)         throw new Error('wireItemMirror: pseudoPod required');
  if (typeof kind !== 'string' || !kind)     throw new Error('wireItemMirror: kind required');
  if (typeof toDraft !== 'function')          throw new Error('wireItemMirror: toDraft required');
  if (typeof scopeId !== 'string' || !scopeId) throw new Error('wireItemMirror: scopeId required');

  const removed = removedKind ?? `${kind}-removed`;
  const prefix  = typeof uriPrefix === 'function' ? uriPrefix(scopeId) : uriPrefix;
  if (typeof prefix !== 'string' || !prefix) throw new Error('wireItemMirror: uriPrefix required');

  // ── (task-claim-partition) — claim-conflict surface ───────────────
  // A partition→merge that double-claims the same task must NOT silently
  // last-writer-wins the `assignee`. Concurrent claim-vs-claim collisions are
  // captured here as first-class, human-resolvable records instead of being
  // overwritten. Everything else (normal claim-onto-open, complete, causal
  // reassign, body updates, revoke) keeps its exact prior behaviour.
  //
  // Keyed by the LOCAL item id. Each record carries both claimants' full task
  // snapshots (`local` + `incoming`) so NO work is lost — the loser's product
  // is retrievable from the record (and, when versioning is attached, from the
  // pseudo-pod version history too).
  /** @type {Map<string, object>} */
  const claimConflicts = new Map();

  function recordClaimConflict(local, incoming) {
    if (!local || typeof local.id !== 'string') return;
    const taskId = local.id;
    const prev = claimConflicts.get(taskId);
    claimConflicts.set(taskId, {
      taskId,
      syncedFromId:     local?.source?.syncedFromId ?? incoming?.id ?? null,
      text:             local.text ?? incoming?.text ?? null,
      // Preserve the FIRST-seen local snapshot (our own work product) across
      // repeated collision signals; always take the latest incoming.
      local:            prev?.local ?? local,
      incoming,
      base:             prev?.base ?? null,
      localAssignee:    local.assignee ?? null,
      incomingAssignee: incoming?.assignee ?? null,
      at:               Date.now(),
    });
  }

  const recipients = new Set();
  function addPeerSync(pubKey) {
    if (!pubKey || typeof pubKey !== 'string') return;
    if (selfPubKey && pubKey === selfPubKey) return;
    recipients.add(pubKey);
  }
  for (const p of peers) addPeerSync(p?.pubKey);

  // Receive handler — turn an inbound payload into a local item. Dedupe on
  // `payload.id` via the `source.syncedFromId` marker stashed at first-receive.
  async function mirror(payload, fromPubKey) {
    if (!payload || typeof payload.id !== 'string' || !payload.id) return;

    const open    = await itemStore.listOpen();
    const closed  = await itemStore.listClosed();
    const matches = (i) => i?.source?.syncedFromId === payload.id;
    const existing = open.find(matches) ?? closed.find(matches);

    if (existing) {
      // SURGICAL claim-vs-claim guard. When an inbound sync would
      // overwrite a locally-claimed task's `assignee` with a DIFFERENT,
      // concurrently-minted claimant, DO NOT overwrite: record a
      // claim-conflict (keeping both sides) and return. This is the ONLY
      // branch that diverges from the prior behaviour; every other sync falls
      // straight through to `applySync` exactly as before.
      if (isConcurrentClaimCollision(existing, payload)) {
        recordClaimConflict(existing, payload);
        return;
      }
      const action = inferAction(existing, payload);
      try {
        await itemStore.applySync({
          syncedFromId: payload.id,
          nextState:    stripIdentity(payload),
          action,
        }, {
          remoteActor: payload.completedBy
                    ?? payload.assignee
                    ?? payload.addedBy
                    ?? (fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : null),
        });
      } catch (_err) { /* swallow — best-effort sync */ }
      return;
    }

    const draft = toDraft(payload, fromPubKey);
    await itemStore.addItems([draft], {
      actor:          payload.addedBy ?? `pubkey:${(fromPubKey ?? '').slice(0, 12) || 'broadcast'}`,
      actionOverride: 'sync',
    });
  }

  function urlFor(itemId) {
    return `pseudo-pod://${pseudoPod.deviceId ?? 'self'}${prefix}${itemId}`;
  }

  const unsubscribe = notifyEnvelope.subscribe({
    kind,
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(prefix)) return;
      mirror(envelope.payload, envelope.fromActor ?? null).catch(() => { /* UI reflects next sync */ });
    },
  });

  const unsubscribeRemoved = notifyEnvelope.subscribe({
    kind: removed,
    callback: (envelope) => {
      const ref = envelope?.ref;
      if (typeof ref !== 'string' || !ref.includes(prefix)) return;
      const originalId = envelope?.payload?.originalId;
      if (typeof originalId !== 'string' || !originalId) return;
      const fromPubKey = envelope.fromActor ?? null;
      itemStore.removeSync({ syncedFromId: originalId }, {
        remoteActor: fromPubKey ? `pubkey:${fromPubKey.slice(0, 12)}` : null,
      }).catch(() => { /* swallow */ });
    },
  });

  // Q-D auto-heal — a peer wrote an older `_v`; republish our fresher copy.
  function _onStalePeer(event) {
    const uri = event?.uri;
    if (typeof uri !== 'string' || !uri.includes(prefix)) return;
    const stalePeer = event.fromActor;
    if (typeof stalePeer !== 'string' || stalePeer.length === 0) return;
    if (typeof event.localBytes === 'undefined' || event.localBytes === null) return;
    if (selfPubKey && stalePeer === selfPubKey) return;
    notifyEnvelope.publish({
      type:       kind,
      ref:        uri,
      payload:    event.localBytes,
      etag:       event.localEtag ?? null,
      _v:         event.localV,
      recipients: [stalePeer],
      ...(selfPubKey ? { fromActor: selfPubKey } : {}),
    }).catch(() => { /* best-effort heal */ });
  }
  const unsubscribeStale = pseudoPod.on?.('stale-peer', _onStalePeer) ?? null;

  // consume `concurrent-write` (fires when a peer write lands at
  // the SAME logical `_v` as ours with different bytes — the shared-URI
  // topology signal of a genuine concurrent edit). For a claim-vs-claim
  // collision this records the same conflict the receive-path guard does
  // (idempotent — keyed by task id), so central-pod / same-URI setups surface
  // the double-claim too. Non-claim concurrent writes are left untouched
  // (the pseudo-pod already snapshots the loser to history).
  function _onConcurrentWrite(event) {
    const uri = event?.uri;
    if (typeof uri !== 'string' || !uri.includes(prefix)) return;
    const localItem = _asItem(event.localBytes);
    const peerItem  = _asItem(event.peerBytes);
    if (isConcurrentClaimCollision(localItem, peerItem)) {
      recordClaimConflict(localItem, peerItem);
    }
  }
  const unsubscribeConcurrent = pseudoPod.on?.('concurrent-write', _onConcurrentWrite) ?? null;

  async function addPeer(pubKey) { addPeerSync(pubKey); }
  function removePeer(pubKey)   { if (typeof pubKey === 'string') recipients.delete(pubKey); }
  async function stop() {
    try { unsubscribe(); } catch { /* swallow */ }
    try { unsubscribeRemoved(); } catch { /* swallow */ }
    if (typeof unsubscribeStale === 'function') { try { unsubscribeStale(); } catch { /* swallow */ } }
    if (typeof unsubscribeConcurrent === 'function') { try { unsubscribeConcurrent(); } catch { /* swallow */ } }
    recipients.clear();
  }
  function listPeers() { return [...recipients]; }
  function getPeers()  { return [...recipients]; }

  // ── — claim-conflict read + clear surface ───────────────────────
  /** Every open claim-conflict record (newest snapshot per task). */
  function listClaimConflicts() { return [...claimConflicts.values()]; }
  /** One record by local task id, or `null`. */
  function getClaimConflict(taskId) { return claimConflicts.get(taskId) ?? null; }
  /** Clear a resolved conflict (called by `resolveClaim` after it writes the
   *  causally-later claim). Returns `true` when a record was removed. */
  function clearClaimConflict(taskId) { return claimConflicts.delete(taskId); }

  async function publish(item, opts = {}) {
    if (!item?.id || recipients.size === 0) return;
    try {
      const uri = urlFor(item.id);
      const { etag, _v } = await pseudoPod.write(uri, item);
      await notifyEnvelope.publish({
        type:       kind,
        ref:        uri,
        payload:    item,
        etag,
        _v,
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        ...(scopeField ? { [scopeField]: scopeId } : {}),
      });
    } catch (_err) { /* best-effort */ }
  }

  async function publishRemoved(originalId, opts = {}) {
    if (typeof originalId !== 'string' || !originalId) return;
    if (recipients.size === 0) return;
    try {
      const uri = urlFor(originalId);
      await notifyEnvelope.publish({
        type:       removed,
        ref:        uri,
        payload:    { originalId },
        recipients: [...recipients],
        ...(opts.fromActor ?? selfPubKey ? { fromActor: opts.fromActor ?? selfPubKey } : {}),
        ...(scopeField ? { [scopeField]: scopeId } : {}),
      });
    } catch (_err) { /* best-effort */ }
  }

  return {
    addPeer, removePeer, stop, listPeers, getPeers, urlFor, publish, publishRemoved,
    listClaimConflicts, getClaimConflict, clearClaimConflict,
  };
}

/**
 * (task-claim-partition) — is this inbound sync a CONCURRENT
 * claim-vs-claim collision (as opposed to a normal claim, a causal reassign,
 * a completion, a body update, or a revoke)?
 *
 * True iff BOTH sides carry a live (uncompleted) claim, the claimants DIFFER,
 * and the incoming claim did NOT causally branch from our current assignee
 * (`incoming.claimBase !== local.assignee`). A fresh `claim` carries no
 * `claimBase` (it branched from the unassigned task) → a genuine double-claim
 * trips this; a causal `reassign` stamps `claimBase = the superseded assignee`
 * → it does NOT trip this and flows through to `applySync` unchanged.
 *
 * Deliberately narrow: any missing/empty assignee, equal assignees, a
 * completed side, or a matching causal base all return `false`, preserving
 * the exact prior behaviour for every non-collision sync.
 */
export function isConcurrentClaimCollision(local, incoming) {
  if (!local || !incoming) return false;
  if (local.completedAt || incoming.completedAt) return false;
  const a = local.assignee;
  const b = incoming.assignee;
  if (!a || !b) return false;
  if (a === b) return false;
  const incomingBase = incoming.claimBase ?? null;
  if (incomingBase === a) return false;   // causal supersede — let it through
  return true;
}

/** Coerce pseudo-pod displaced bytes (object or JSON string) to an item. */
function _asItem(bytes) {
  if (bytes == null) return null;
  if (typeof bytes === 'object') return bytes;
  if (typeof bytes === 'string') { try { return JSON.parse(bytes); } catch { return null; } }
  return null;
}

/**
 * Default action inference (household / tasks-without-reviewLog). Tasks injects
 * its own variant with the submit/approve/reject reviewLog branch.
 */
export function defaultInferAction(local, next) {
  if (!local.completedAt && next.completedAt)        return 'complete';
  if (local.assignee && !next.assignee)              return 'revoke';
  if (!local.assignee && next.assignee)              return 'claim';
  if (local.assignee && next.assignee && local.assignee !== next.assignee) return 'reassign';
  return 'update';
}

/** Strip identity fields before applySync merges the rest into the local item. */
export function stripIdentity(payload) {
  const { id: _id, _etag: _etag, addedAt: _addedAt, ...rest } = payload;
  return rest;
}
