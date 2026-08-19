/**
 * wireChat — peer-to-peer chat over `agent.transport.sendOneWay`.
 *
 * **2026-05-08:** lifted from `apps/stoop/src/chat/wireChat.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Stoop's wireChat.js is now a thin shim that pre-binds Stoop's
 * envelope-type + Phase 39 attachment helpers.
 *
 * Originally Stoop V1 Phase 14 (2026-05-06).
 *
 * Wire shape (the DataPart's `data` field):
 *
 *   {
 *     type:         'p2p-chat' | 'stoop-chat' (legacy),
 *     subtype:      'chat-message' | 'reveal-request' | 'reveal-accept'
 *                    | 'broadcast-post' | 'contact-add-request'
 *                    | 'attachment-request' | 'attachment-response',
 *     threadId:     <string>,           // typically the originating post's id
 *     body:         <string>,           // user-typed message body (subtype: chat-message)
 *     fromWebid:    <string>,
 *     fromStableId: <string | null>,
 *     sentAt:       <ms epoch>,
 *   }
 *
 * Idempotency / dedup: each chat-message also carries a `nonce`
 * (random base64url) so receiver storage can dedupe on resend /
 * relay-replay.  Persistence happens through `item-store`, so chat
 * threads survive restarts and sync to the pod when one is wired.
 *
 * **Envelope types.** New deployments emit `'p2p-chat'`; readers
 * accept BOTH `'p2p-chat'` (new) AND `'stoop-chat'` (legacy) by
 * default so a mixed-version network keeps working. Apps tweak via
 * `emitEnvelopeType` + `acceptedEnvelopeTypes` constructor args.
 *
 * **Attachments.** Optional. When an app passes
 * `attachmentSupport: { attachmentPath, readAttachmentBytesB64,
 * maxBytesPerAttachment }`, the substrate wires the
 * `attachment-request` / `attachment-response` flow and the inline
 * chat-message attachment path. When `attachmentSupport` is absent,
 * those code paths are no-ops.
 */

import nacl from 'tweetnacl';
import { createAddressedDeliver } from '@onderling/item-store';

/** Default envelope type for outbound messages. */
const DEFAULT_EMIT_ENVELOPE_TYPE = 'p2p-chat';

/** Default accepted envelope types (new + legacy). */
const DEFAULT_ACCEPTED_ENVELOPE_TYPES = Object.freeze(['p2p-chat', 'stoop-chat']);

/** Tiny base64 helper — same shape as Attachments.js so we don't
 *  drag a dependency. */
function _b64decode(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function dataArgsOf(parts) {
  if (!Array.isArray(parts)) return null;
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? null;
}

/** Generate a fresh nonce (base64url 12 bytes — short, dedup-only). */
function freshNonce() {
  const bytes = nacl.randomBytes(12);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  const std = (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Wire a chat handler onto the agent.  Returns a controller with
 * `send(...)` for outbound + `detach()` to stop listening.
 *
 * @param {object} args
 * @param {import('@onderling/core').Agent} args.agent
 * @param {import('@onderling/item-store').ItemStore} args.itemStore
 * @param {import('@onderling/identity-resolver').MemberMap} args.members
 * @param {Set<string>} args.muted             local mute set (stableIds + webid fallbacks)
 * @param {string} args.localActor             my webid
 * @param {string | null} args.localStableId   my stableId (from agent.identity.stableId)
 */
export function wireChat({
  agent, itemStore, members, muted, metrics, localActor, localStableId,
  evictionRoster = null,
  dataSource     = null,
  // Connectivity Phase 2 / Wave B — host-injected hold-forward sender (basis's
  // `sa.peer.sendTo(..., {guarantee:'hold-forward'})`). When wired, a 1:1 DM to a
  // briefly-offline peer is HELD locally and flushed on reconnect (the offline-ladder
  // rung-1), the same reliable choke circle broadcasts already ride. `sa.peer.sendTo`
  // passes the wire straight to `tx.sendOneWay`, so the payload is byte-identical to the
  // bare-transport path. Absent → the bare per-peer transport (unchanged: an unreachable
  // peer soft-fails). See `send` below.
  reliableSend   = null,
  // Phase 6 substrate parameters (Tasks V1 lift):
  emitEnvelopeType      = DEFAULT_EMIT_ENVELOPE_TYPE,
  acceptedEnvelopeTypes = DEFAULT_ACCEPTED_ENVELOPE_TYPES,
  attachmentSupport     = null,
}) {
  const acceptedSet = new Set(acceptedEnvelopeTypes);

  // Optional attachment helpers (per-app glue).  When `dataSource` and
  // these are all supplied, the inline-chat-message + attachment-
  // request / -response flows are active.  Otherwise those paths
  // silently no-op.
  const attachmentPath           = attachmentSupport?.attachmentPath ?? null;
  const readAttachmentBytesB64   = attachmentSupport?.readAttachmentBytesB64 ?? null;
  const maxBytesPerAttachment    = attachmentSupport?.maxBytesPerAttachment ?? Infinity;

  /** Track recently-seen nonces so resends don't duplicate items. */
  const seenNonces = new Set();

  // ── The shared addressed-send core (connectivity Phase 2, C3) ───────────────
  //
  // wireChat's outbound SEND + PERSIST + DEDUP now route through the SAME
  // `createAddressedDeliver` primitive that `contactThreadChannel` uses, so the
  // two 1:1 DM paths are ONE implementation. wireChat keeps only its own
  // concerns: the exact wire shape (`buildChatWire`, so `emitEnvelopeType` and
  // every wire field stay byte-identical), the exact persisted item
  // (`buildChatItem`, which also owns the Phase-39 inline-attachment byte-write —
  // the generic core never learns about attachments), and the accepted-types /
  // subtype handling on RECEIVE (`handleIncoming`, below). The shared
  // `seenNonces` set is injected so send-side and receive-side dedup are one set.

  /** Project the outbound envelope onto wireChat's EXACT wire payload. */
  function buildChatWire(env) {
    const ex = (env && typeof env.extras === 'object' && env.extras) || {};
    const payload = {
      type:         emitEnvelopeType,
      subtype:      env.kind,
      threadId:     ex.threadId ?? null,
      body:         env.body ?? null,
      fromWebid:    env.author,
      fromStableId: ex.fromStableId ?? null,
      sentAt:       env.ts,
      nonce:        env.id,
      // Phase 24.6 / 39 — caller-supplied extra wire fields (contact-add-request
      // metadata, `attachment` inline bytes, `attachments` fanout metadata, …).
      ...(ex.wireExtras && typeof ex.wireExtras === 'object' ? ex.wireExtras : {}),
    };
    return { type: 'message', parts: [{ type: 'DataPart', data: payload }] };
  }

  /**
   * Project the outbound envelope onto wireChat's EXACT persisted item — but
   * ONLY for `chat-message` (other subtypes are send-only: return null so the
   * core skips persistence, matching the pre-fold behaviour where reveal /
   * contact-add-request stored nothing on the sender side). Runs AFTER a
   * successful send, so the inline-attachment byte-write (Phase 39) keeps its
   * original ordering: bytes are only written once the message is on the wire.
   */
  async function buildChatItem(env, { to }) {
    if (env.kind !== 'chat-message') return null;
    const ex = (env && typeof env.extras === 'object' && env.extras) || {};
    // Phase 39 — sender stores its own copy of any inline attachment so its
    // thread render shows the image immediately.
    let senderAttachment = null;
    const inline = ex.wireExtras?.attachment;
    if (dataSource && attachmentPath && inline && typeof inline.dataB64 === 'string') {
      const att = inline;
      const time = Date.now().toString(36).padStart(9, '0');
      const rand = Math.random().toString(36).slice(2, 10);
      const attId = `att-${time}-${rand}`;
      const ref = attachmentPath(env.id, attId, att.mime ?? 'image/jpeg');
      try {
        await dataSource.write(ref, _b64decode(att.dataB64));
        senderAttachment = {
          id:        attId,
          mime:      att.mime,
          bytes:     att.bytes ?? Math.floor(att.dataB64.length * 0.75),
          width:     att.width  ?? 0,
          height:    att.height ?? 0,
          thumbnail: att.thumbnail ?? null,
          ref,
        };
      } catch { /* keep the message body even if attachment fails */ }
    }
    return {
      type:       'chat-message',
      text:       env.body,
      visibility: 'household',
      source: {
        threadId:     ex.threadId,
        fromWebid:    env.author,
        fromStableId: ex.fromStableId ?? null,
        toWebid:      ex.toWebid,
        toPubKey:     ex.toPubKey ?? to,
        sentAt:       env.ts,
        nonce:        env.id,
        ...(senderAttachment ? { attachments: [senderAttachment] } : {}),
      },
    };
  }

  const deliverCore = createAddressedDeliver({
    // The addressed send to ONE peer. Route per-peer via `agent.transportFor`
    // (using `agent.transport` directly would pick the primary slot and never
    // cross processes). Tag transport failures so `send()` can reproduce the
    // legacy `{ ok:false, reason:'transport: …' }` return WITHOUT swallowing a
    // later persist error (that still throws, as before).
    send: async (to, wire) => {
      try {
        // Prefer the host-injected hold-forward sender: a briefly-offline peer has the
        // DM HELD + flushed on reconnect (it returns `{held:true}` rather than throwing),
        // so the turn still persists locally and delivers later — the offline-ladder rung-1,
        // mirroring the circle-broadcast reliable choke. Absent → the bare per-peer transport
        // (`agent.transportFor(to).sendOneWay`), where an unreachable peer soft-fails as before.
        if (typeof reliableSend === 'function') {
          return await reliableSend(to, wire, { guarantee: 'hold-forward' });
        }
        const t = await agent.transportFor(to);
        return await t.sendOneWay(to, wire);
      } catch (err) {
        const e = new Error(`transport: ${err?.message ?? err}`);
        e.__wireChatTransport = true;
        throw e;
      }
    },
    toWire:  buildChatWire,
    toItem:  buildChatItem,
    itemStore,
    seenNonces,
    localActor,
    localStableId,
  });

  async function handleIncoming({ from: fromPubKey, parts }) {
    const data = dataArgsOf(parts);
    if (!data || !acceptedSet.has(data.type)) return;

    // Mute filter: drop messages from muted peers.  Mute set holds
    // stableIds (preferred) or webids (back-compat); check both.
    if (muted) {
      if (data.fromStableId && muted.has(data.fromStableId)) return;
      if (data.fromWebid    && muted.has(data.fromWebid))    return;
    }

    // Dedup on nonce.
    if (data.nonce && seenNonces.has(data.nonce)) return;
    if (data.nonce) seenNonces.add(data.nonce);

    if (data.subtype === 'chat-message') {
      // Phase 39 — chat-message may carry an inline attachment with
      // full bytes.  Persist the bytes to a freshly-allocated path
      // BEFORE storing the chat-message item, so the item carries
      // a `ref` from the start (no fetch round-trip needed).
      let storedAttachment = null;
      if (dataSource && attachmentPath && data.attachment && typeof data.attachment === 'object'
          && typeof data.attachment.dataB64 === 'string') {
        const att = data.attachment;
        // Generate an attId locally on the receiver side — chat
        // attachments are 1:1 and the sender doesn't need to know
        // our path.
        const time = Date.now().toString(36).padStart(9, '0');
        const rand = Math.random().toString(36).slice(2, 10);
        const attId = `att-${time}-${rand}`;
        const itemIdStub = data.nonce ?? attId;   // chat items don't pre-exist; use nonce as group key
        const ref = attachmentPath(itemIdStub, attId, att.mime ?? 'image/jpeg');
        try {
          await dataSource.write(ref, _b64decode(att.dataB64));
          storedAttachment = {
            id:        attId,
            mime:      att.mime,
            bytes:     att.bytes ?? Math.floor(att.dataB64.length * 0.75),
            width:     att.width  ?? 0,
            height:    att.height ?? 0,
            thumbnail: att.thumbnail ?? null,
            ref,
          };
        } catch { /* drop attachment, keep message body */ }
      }

      await itemStore.addItems([{
        type:       'chat-message',
        text:       data.body ?? '',
        visibility: 'household',
        source: {
          threadId:     data.threadId,
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          sentAt:       data.sentAt ?? Date.now(),
          nonce:        data.nonce ?? null,
          ...(storedAttachment ? { attachments: [storedAttachment] } : {}),
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:chat-message', {
        threadId: data.threadId, fromWebid: data.fromWebid, body: data.body,
        hasAttachment: !!storedAttachment,
      });
      metrics?.record?.('chat-received');
      return;
    }

    if (data.subtype === 'reveal-request' || data.subtype === 'reveal-accept') {
      // Store as a kind: 'reveal-event' item for audit + UI pickup.
      await itemStore.addItems([{
        type:       'reveal-event',
        text:       `${data.fromWebid ?? '?'} ${data.subtype}`,
        visibility: 'household',
        source: {
          threadId:     data.threadId,
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          subtype:      data.subtype,
          sentAt:       data.sentAt ?? Date.now(),
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:reveal-event', {
        threadId: data.threadId, fromWebid: data.fromWebid, subtype: data.subtype,
      });
      metrics?.record?.(`${data.subtype}-received`);
      return;
    }

    if (data.subtype === 'broadcast-post') {
      // Phase 27.4 — receiver-side filter for direct-fan-out posts
      // (sent via the contact graph rather than the group pubsub).
      // Drop muted senders; drop posts beyond my maxDistanceKm if I
      // know my own location.  Otherwise, mirror as a regular item
      // so the board renders it.
      if (muted && (
        (data.fromStableId && muted.has(data.fromStableId)) ||
        (data.fromWebid    && muted.has(data.fromWebid))
      )) return;

      // silently drop posts from evicted members.
      if (evictionRoster && data.fromWebid && evictionRoster.isEvicted(data.fromWebid)) return;

      // Distance filter: receiver checks against own location.
      if (typeof data.maxDistanceKm === 'number' && members) {
        try {
          const me = await members.resolveByWebid(localActor);
          const sender = await members.resolveByWebid(data.fromWebid);
          const myCell     = me?.location?.cell;
          const senderCell = sender?.location?.cell;
          if (myCell && senderCell) {
            const d = _distanceKm(myCell, senderCell);
            if (d > data.maxDistanceKm) return;
          }
        } catch { /* tolerate failure — better to deliver than to drop */ }
      }

      // Mirror the post into the local item store as a regular
      // typed item with `source.broadcast: true` so the board
      // surfaces it.  Dedupe on data.postId.
      const open = await itemStore.listOpen({});
      if (open.some((i) => i?.source?.requestId === data.postId)) return;

      // Phase 27.7 — decide whether this post is "notify-worthy":
      //   - sender is in my ContactBook at any trust level, OR
      //   - the post's text/category intersects my skills profile.
      // Loose-contact posts that don't match stay silent (mirror
      // only; no banner / notification).
      let isContact = false;
      let matchesSkills = false;
      try {
        const sender = await members?.resolveByWebid(data.fromWebid);
        isContact = sender?.relation === 'contact';
      } catch {}
      try {
        const me = await members?.resolveByWebid(localActor);
        // 2026-05-08: matchesProfile lives in
        // @onderling/identity-resolver since the Phase 3 lift.
        const { matchesProfile } = await import('@onderling/identity-resolver');
        const post = {
          categoryId: data.categoryId ?? null,
          tags:       Array.isArray(data.skillTags) ? data.skillTags : [],
        };
        matchesSkills = matchesProfile(post, me ?? {}).matched === true;
      } catch {}
      const notifyWorthy = isContact || matchesSkills;

      await itemStore.addItems([{
        type:       data.kind ?? 'request',
        text:       data.text ?? '(broadcast)',
        requiredSkills: data.requiredSkills ?? [],
        visibility: 'household',
        source: {
          requestId:    data.postId,
          broadcast:    true,
          via:          'contact-fanout',
          from:         data.fromWebid,
          fromPubKey,
          fromStableId: data.fromStableId ?? null,
          targets:      Array.isArray(data.targets) ? data.targets : [],
          maxDistanceKm: data.maxDistanceKm ?? null,
          categoryId:   data.categoryId ?? null,
          skillTags:    Array.isArray(data.skillTags) ? data.skillTags : [],
          viaAutoMatch: !isContact,    // sender wasn't in my contacts → loose-contact path
          notifyWorthy,
          // Phase 39 — attachment metadata (no `ref` until fetched).
          attachments:  Array.isArray(data.attachments) ? data.attachments : [],
        },
        ...(typeof data.dueAt === 'number' ? { dueAt: data.dueAt } : {}),
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:contact-broadcast', {
        postId: data.postId, fromWebid: data.fromWebid, notifyWorthy,
      });
      metrics?.record?.(notifyWorthy
        ? 'contact-broadcast-received-notify'
        : 'contact-broadcast-received-silent');
      return;
    }

    if (data.subtype === 'attachment-request') {
      // Phase 39 — recipient wants the full bytes for an attachment
      // they only have the thumbnail of.  Look up the ORIGINATING
      // item in our local store; if we're the original author and
      // the bytes are local, ship them back via attachment-response.
      // Other actors silently ignore — only the author serves bytes.
      // Substrate guard: skip the whole flow when an app didn't wire
      // attachment support.
      if (!dataSource || !readAttachmentBytesB64) return;
      if (muted && (
        (data.fromStableId && muted.has(data.fromStableId)) ||
        (data.fromWebid    && muted.has(data.fromWebid))
      )) return;

      const itemId = data.itemId;
      const attId  = data.attId;
      if (typeof itemId !== 'string' || typeof attId !== 'string') return;

      const ours = await itemStore.getById(itemId).catch(() => null);
      // Author check: addedBy must equal localActor (we're the
      // sender of the post).  Mirrored items don't pass.
      if (!ours || ours.addedBy !== localActor) return;
      const attachments = Array.isArray(ours.source?.attachments) ? ours.source.attachments : [];
      const att = attachments.find(a => a?.id === attId);
      if (!att || !att.ref) return;

      const dataB64 = await readAttachmentBytesB64({ dataSource, ref: att.ref }).catch(() => null);
      if (!dataB64) return;

      try {
        // Same per-peer routing as the main send() path — without
        // this, the attachment-response goes via the primary slot
        // and never reaches the requesting peer.
        const t = await agent.transportFor(fromPubKey);
        await t.sendOneWay(fromPubKey, {
          type:  'message',
          parts: [{ type: 'DataPart', data: {
            type:         emitEnvelopeType,
            subtype:      'attachment-response',
            itemId,
            attId,
            mime:         att.mime,
            width:        att.width,
            height:       att.height,
            bytes:        att.bytes,
            dataB64,
            fromWebid:    localActor,
            fromStableId: localStableId ?? null,
            sentAt:       Date.now(),
          }}],
        });
      } catch { /* swallow — recipient retries */ }
      metrics?.record?.('attachment-served');
      return;
    }

    if (data.subtype === 'attachment-response') {
      // Phase 39 — we asked for bytes; the author shipped them.
      // Validate, write to OUR local cache, emit an event the UI
      // listens to so the modal flips from "loading…" to the image.
      // Substrate guard: skip when the app didn't wire attachment support.
      if (!dataSource || !attachmentPath) return;
      const itemId = data.itemId;
      const attId  = data.attId;
      const dataB64 = data.dataB64;
      if (typeof itemId !== 'string' || typeof attId !== 'string'
          || typeof dataB64 !== 'string') return;
      // Defensive size cap on inbound bytes (defence in depth — the
      // sender is supposed to honour the post's max).
      const approxBytes = Math.floor(dataB64.length * 0.75);
      if (approxBytes > maxBytesPerAttachment * 4) return;     // hard cap (4× the soft cap)

      const mime = data.mime ?? 'image/jpeg';
      const ref  = attachmentPath(itemId, attId, mime);
      try {
        const bytes = _b64decode(dataB64);
        await dataSource.write(ref, bytes);
      } catch { return; }

      // Patch the local item (mirrored or own) with the ref so the
      // next render shows the full image.
      const ours = await itemStore.getById(itemId).catch(() => null);
      if (ours) {
        const attachments = Array.isArray(ours.source?.attachments) ? ours.source.attachments : [];
        const idx = attachments.findIndex(a => a?.id === attId);
        if (idx >= 0) {
          const updated = {
            ...ours,
            source: {
              ...(ours.source ?? {}),
              attachments: attachments.map((a, i) => i === idx ? { ...a, ref } : a),
            },
          };
          // Same write-trick as postRequest: rewrite at the item-store path.
          await dataSource.write(`mem://neighbourhood/items/${itemId}.json`, JSON.stringify(updated))
            .catch(() => { /* best-effort */ });
        }
      }
      agent.emit('stoop:attachment-fetched', { itemId, attId, ref });
      metrics?.record?.('attachment-fetched');
      return;
    }

    if (data.subtype === 'contact-add-request') {
      // Phase 24.6 — incoming "I want to add you as a contact" hint.
      // Store as kind: 'contact-request' so the UI can render an
      // accept/decline prompt; agent stays passive otherwise.
      await itemStore.addItems([{
        type:       'contact-request',
        text:       `${data.fromWebid ?? '?'} wants to add you as a contact`,
        visibility: 'household',
        source: {
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          handle:       data.handle      ?? null,
          displayName:  data.displayName ?? null,
          avatarUrl:    data.avatarUrl   ?? null,
          trustOffer:   data.trustOffer  ?? 'bekend',
          sentAt:       data.sentAt ?? Date.now(),
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:contact-request', {
        fromWebid: data.fromWebid, trustOffer: data.trustOffer ?? 'bekend',
      });
      metrics?.record?.('contact-request-received');
    }
  }

  agent.on('message', handleIncoming);

  /**
   * Send a chat-message (or reveal event) to a peer.  Looks up the
   * peer's pubKey via MemberMap when only stableId / webid are
   * supplied.  Stores the local copy on success.
   *
   * @param {object} args
   * @param {string} [args.toStableId]  preferred
   * @param {string} [args.toWebid]     back-compat
   * @param {string} [args.toPubKey]    bypass-the-resolver path (test fixtures)
   * @param {string} args.threadId
   * @param {string} args.body          required for subtype='chat-message'
   * @param {'chat-message' | 'reveal-request' | 'reveal-accept' | 'contact-add-request'} [args.subtype='chat-message']
   * @returns {Promise<{ok: boolean, reason?: string, itemId?: string}>}
   */
  async function send(args) {
    const subtype = args.subtype ?? 'chat-message';
    let toPubKey = args.toPubKey ?? null;
    let toWebid  = args.toWebid  ?? null;

    if (!toPubKey && members) {
      let m = null;
      if (args.toStableId) m = await members.resolveByStableId(args.toStableId);
      if (!m && toWebid)   m = await members.resolveByWebid(toWebid);
      if (m) {
        toPubKey = m.pubKey ?? null;
        toWebid  = toWebid  ?? m.webid;
      }
    }
    if (!toPubKey) return { ok: false, reason: 'recipient-pubkey-unknown' };
    if (subtype === 'chat-message' && (typeof args.body !== 'string' || !args.body)) {
      return { ok: false, reason: 'body-required' };
    }
    // Some subtypes don't ride on a thread (contact-add-request,
    // broadcast-post); reveal/chat do.
    const NO_THREAD = new Set(['contact-add-request', 'broadcast-post']);
    if (!NO_THREAD.has(subtype)
        && (typeof args.threadId !== 'string' || !args.threadId)) {
      return { ok: false, reason: 'threadId-required' };
    }

    // Canonical outbound Envelope for the shared core. `id` is the dedup nonce,
    // `ts` the send time; both are echoed byte-identically onto the wire (via
    // `buildChatWire`) AND the persisted item (via `buildChatItem`), so wire and
    // storage stay consistent exactly as when a single `payload` fed both.
    const envelope = {
      id:     freshNonce(),
      kind:   subtype,
      ts:     Date.now(),
      author: localActor,
      body:   args.body ?? null,
      extras: {
        threadId:     args.threadId ?? null,
        fromStableId: localStableId ?? null,
        toWebid,                 // persist-only routing fields
        toPubKey,
        // Phase 24.6 — extra fields for contact-add-request envelopes.
        // Phase 39 — `attachment` carries inline-bytes chat-image;
        // `attachments` carries metadata-only on a broadcast-post fanout.
        wireExtras: (args.extras && typeof args.extras === 'object') ? args.extras : null,
      },
    };

    // The shared core sends to the one peer (per-peer transport), then persists
    // the durable chat-message item + dedups — for `chat-message`. Other
    // subtypes are send-only (`buildChatItem` returns null).
    let localId = null;
    try {
      const { itemId } = await deliverCore.deliver(envelope, { to: toPubKey });
      localId = itemId ?? null;
    } catch (err) {
      // A tagged transport failure reproduces the legacy soft return; anything
      // else (e.g. a persist failure) propagates, exactly as before the fold.
      if (err && err.__wireChatTransport) return { ok: false, reason: err.message };
      throw err;
    }

    metrics?.record?.(subtype === 'chat-message' ? 'chat-sent' : `${subtype}-sent`);
    return { ok: true, itemId: localId };
  }

  function detach() {
    agent.off?.('message', handleIncoming);
  }

  return { send, detach };
}

// ── Private helpers ─────────────────────────────────────────────────────────
//
// Pre-lift, the distance filter above did
//   `const { distanceKm } = await import('../lib/geo.js');`
// which worked when wireChat lived at `apps/stoop/src/chat/wireChat.js`.
// After the substrate lift the `'../lib/geo.js'` path resolves to a
// non-existent file inside `packages/chat-p2p/`, breaking RN bundling
// (Metro statically follows dynamic `import()` chains).
//
// Inlined here as a private helper so chat-p2p stays self-contained.
// Canonical implementation lives in `apps/stoop/src/lib/geo.js` —
// keep the two in sync (or lift this trio into a tiny `@onderling/cell-grid`
// substrate when a third consumer surfaces; rule-of-two not yet
// triggered, the third caller is mobile's own `lib/geo.js`).

const EARTH_R_KM = 6371;

function _cellCenter(cell) {
  if (typeof cell !== 'string') return null;
  const parts = cell.split(':');
  if (parts.length !== 3) return null;
  const [gridM, row, col] = parts.map(Number);
  if (!Number.isFinite(gridM) || !Number.isFinite(row) || !Number.isFinite(col)) return null;
  const lat = (row * gridM) / 111_000;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const lng = cosLat === 0 ? 0 : (col * gridM) / (111_000 * cosLat);
  return { lat, lng };
}

function _distanceKm(cellA, cellB) {
  if (cellA === cellB) return 0;
  const a = _cellCenter(cellA);
  const b = _cellCenter(cellB);
  if (!a || !b) return Infinity;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_R_KM * c * 10) / 10;
}
