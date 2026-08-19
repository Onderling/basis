/**
 * basis v2 — scope the GUI's DIRECT stoop callSkill to the active circle
 * (shared web + mobile). The per-circle stoop restructure, GUI slice.
 *
 * The dispatch path (slash / AI) already binds the active circle via
 * `scopeReadyDispatch` (router.js): it injects the circle id into the stoop scope
 * key so a post lands in — and a list reads from — the open circle. But the GUI
 * surfaces (the prikbord noticeboard, etc.) call `callSkill('stoop', op, args)`
 * DIRECTLY, bypassing that binding — so without this wrapper every circle's
 * prikbord hits the one shared `cc-default-circle` and they all see each other's
 * posts. This wrapper closes that gap the same way:
 *   • item-creating / mutating stoop ops get the circle id injected as `groupId`
 *     (stoop's per-call scope key — realAgent maps it to `source.targets[]`), so
 *     the post is tagged to / routed to THIS circle (basis is multi-pod:
 *     the scope key is load-bearing for routing, not just a tag), and
 *   • list reads are filtered to the circle with the SAME lenient rule as
 *     `loadCircleItems` (`keepForCircle`): an item with no per-item circle hint is
 *     kept — the op already scoped it — so pre-existing unscoped posts don't vanish.
 *
 * This is the invariant-honoring shape: ONE stoop agent (service-context) with a
 * per-circle scope key threaded through ops — NOT N agents for N circles
 * (CLAUDE.md invariant #6). Pure + transport-free, so mobile reuses it verbatim.
 */
import { openThumbnail } from '@onderling/blob-gateway';
import { itemCircleId } from './circleScope.js';
import { createMediaEmbed } from '../core/handlers/mediaEmbed.js';

/** stoop ops whose created/mutated item belongs to / routes to the active circle. */
export const SCOPED_WRITE_OPS = new Set([
  'postRequest', 'respondToItem', 'cancelRequest', 'markReturned', 'assignLend', 'reportPost',
]);

/** stoop list ops whose `{ items }` are filtered to the active circle. */
export const SCOPED_LIST_OPS = new Set(['listOpen', 'listFeed', 'listMyRequests', 'getBulletin']);

/**
 * Stoop item types that are NOT user-facing noticeboard posts — the membership
 * lifecycle + rules documents (internal bookkeeping), and the circle CHAT lines,
 * which live in the same itemStore purely so a conversation survives a reload.
 * `listOpen` (no intent) returns them all alongside real `request`/`offer` posts;
 * the prikbord is for asks/offers, so it filters these out.
 *
 * `circle-chat-message` earns its place here for the same reason the others do, but
 * the symptom was louder: every line typed in a circle's Conversation also appeared
 * on the Noticeboard — with a "Withdraw" action when it was yours — and, because a
 * chat item carries its circle as `source.circleId` (a hint `itemCircleId` does not
 * read), on EVERY circle's Noticeboard, not just its own.
 */
export const SYSTEM_STOOP_TYPES = new Set([
  'group-rules', 'membership-code', 'membership-redemption', 'circle-chat-message',
]);

/** True when `item` is a real noticeboard post (an ask/offer), not a system item. */
export function isNoticeboardPost(item) {
  if (SYSTEM_STOOP_TYPES.has(item?.type)) return false;
  // The local-first substrate/pseudo-pod collapses every stoop item to `type:'post'`,
  // losing the semantic type — but the original `source` shape survives. Recognise the
  // membership lifecycle + rules documents by their distinctive source fields so they
  // don't surface as noticeboard posts even when the type is flattened.
  //
  // This is not a belt-and-braces branch: basis's own `adaptStoopReply` (realAgent.js)
  // rewrites `type: 'post'` onto EVERY `listOpen` row, so on the live path the type
  // check above never fires and the recognisers below are the whole filter.
  const src = item?.source;
  if (src && typeof src === 'object') {
    if (src.rules != null) return false;                          // group-rules
    if (typeof src.code === 'string' && src.code) return false;   // membership-code
    if (src.redeemedBy != null) return false;                     // membership-redemption
    // circle-chat-message — the only stoop item keyed by a message id (stoop's
    // `broadcastCircleMessage` local mirror + `ingestCircleMessage` receive mirror are
    // the only writers of `source.msgId`; the other circle broadcasts put theirs on the
    // wire `extras`, never on a stored item).
    if (typeof src.msgId === 'string' && src.msgId) return false;
  }
  return true;
}

/**
 * Keep `item` for `circleId` — lenient: an item carrying NO circle hint is kept
 * (the op already scoped it server-side). Mirrors `circleContent.js`'s rule so the
 * GUI and the content loader filter identically. A null circleId keeps everything.
 */
export function keepForCircle(item, circleId) {
  if (!circleId) return true;
  // itemCircleId now reads nested hints too (source.targets[]/source.groupId), so a
  // scoped item is recognised here instead of looking "unscoped". null hint = genuinely
  // unscoped → keep (the op already scoped it server-side).
  const hint = itemCircleId(item || {});
  if (hint == null) return true;
  return hint === circleId;
}

/** Open a list item's sealed `text`/`label` for a current recipient. A non-sealed body
 *  passes straight through (envelope.open is a no-op on plaintext); a body we can't open
 *  (not a recipient / stale key) is left as-is rather than dropped. */
function openItemText(it, strategy) {
  if (!it || typeof it.text !== 'string' || !it.text) return it;
  try {
    const opened = strategy.open(it.text);
    return opened === it.text ? it : { ...it, text: opened, label: opened };
  } catch { return it; }
}

/** Uint8Array → standard base64 (data-URL payload). Web `btoa`, node `Buffer` fallback. */
function bytesToStdB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

/**
 * Seal a picked image attachment through the per-circle media gateway, exactly as
 * `core/handlers/mediaEmbed.js` seals a circle chat image — REUSE, not a second path.
 * The attachment arrives already encoded (`{mime, dataB64, width, height, thumbnail}` from
 * `attachmentEncoder`); a pass-through `encodeImage` hands those bytes + thumbnail to
 * `createMediaEmbed`, which `uploadBlob`s the SEALED bytes + SEALED thumbnail into the
 * circle bucket and returns a canonical `media` item (`snapshot`) whose `source` IS the
 * blob manifest line. That opaque, sealed pointer is what stoop stores + carries — no
 * plaintext bytes and no `data:image` thumbnail ever reach the pod / wire.
 */
async function sealPostAttachment(att, media) {
  const { mediaGateway, localActor, t } = media;
  const embed = await createMediaEmbed({}, {
    file: { dataB64: att.dataB64, type: att.mime, name: att.name },
    mediaGateway,
    // The image is already resized/encoded upstream — pass those values straight through
    // so createMediaEmbed seals the exact bytes + thumbnail (its `dataUrlToB64` handles the
    // `data:` thumbnail URL) rather than re-encoding.
    encodeImage: async () => ({
      mime: att.mime, dataB64: att.dataB64,
      width: att.width, height: att.height, thumbnail: att.thumbnail,
    }),
    localActor, t,
  });
  if (!embed || embed.ok === false || !embed.snapshot) {
    throw new Error(embed?.error || 'media-seal-failed');
  }
  return embed.snapshot;   // canonical media item; source = sealed blob manifest line
}

/**
 * Read-side render helper: open the SEALED inline thumbnail carried on each of an item's
 * sealed attachment pointers (`source.enc.thumb`) into a render-only `data:` URL, using the
 * per-circle content opener — the SAME `openThumbnail` path basis's own circle image
 * chips use. No gate + no fetch (the thumb ships inside the manifest line). The sealed
 * `source` is preserved (full-image open on tap still routes through the gateway). A wrong
 * key (cross-circle) throws in `openThumbnail` → caught → the chip falls back to a
 * placeholder, which is the per-circle no-cross-seal guard made visible.
 */
function openItemAttachmentThumbs(it, opener) {
  const atts = it?.source?.attachments;
  if (!Array.isArray(atts) || !atts.length || typeof opener !== 'function') return it;
  let changed = false;
  const opened = atts.map((att) => {
    const line = att && att.source;
    if (!line || typeof line !== 'object' || !line.enc || att.thumbnail) return att;
    try {
      const bytes = openThumbnail({ line, opener });
      if (!bytes) return att;
      changed = true;
      // Thumbnails are always JPEG (attachmentEncoder). The plaintext data URL lives only
      // in this client-side render copy — never re-serialized to the store/wire.
      return { ...att, thumbnail: `data:image/jpeg;base64,${bytesToStdB64(bytes)}` };
    } catch { return att; }   // wrong key / no thumb → placeholder
  });
  return changed ? { ...it, source: { ...it.source, attachments: opened } } : it;
}

/**
 * Wrap a 3-arg host `callSkill(appOrigin, opId, args)` so stoop ops are scoped to
 * `circleId`. Non-stoop ops and a null circleId pass through untouched.
 *
 * For a SEALED (p2/p3) circle, pass `getSealStrategy` — an async getter resolving the
 * circle's `{seal, open}` content strategy (cached by the caller). When present, a
 * `postRequest` body is SEALED before it reaches the pod (the host stores ciphertext)
 * and list items are OPENED after read — so every GUI reader/writer that routes through
 * this wrapper (prikbord + scherm noticeboard block) is transparently E2E-sealed. A p0/p1
 * circle resolves no strategy → plaintext, unchanged.
 *
 * Image attachments seal the SAME way, through the SAME circle path basis's own
 * circle images use: pass `getMedia` — an async getter resolving `{mediaGateway, localActor,
 * t}` (the per-circle `getCircleMediaComposition` gateway). A `postRequest` carrying
 * `attachments` then routes each picked image through `createMediaEmbed`/`uploadBlob` (seal
 * bytes + thumbnail into the circle bucket) and replaces the inline `{dataB64,thumbnail}`
 * with an opaque `{type:'media', source:<blob line>}` pointer BEFORE it reaches the pod; on
 * read, each sealed inline thumbnail is opened for render via the circle opener. Because
 * this wrapper holds exactly ONE circle's gateway, the seal is per-circle by construction —
 * a wrong-circle opener can't open it (no cross-circle leak). A circle with no media gateway
 * (p0/p1 / unresolved) REFUSES attachments — sealed-only, never a plaintext fallback.
 *
 * @param {(appOrigin:string, opId:string, args?:object)=>Promise<any>} callSkill
 * @param {string|null} circleId
 * @param {(() => Promise<{seal:Function, open:Function}|null>)} [getSealStrategy]
 * @param {(() => Promise<{mediaGateway:object, localActor:string, t?:Function}|null>)} [getMedia]
 * @returns {(appOrigin:string, opId:string, args?:object)=>Promise<any>}
 */
export function scopeStoopCallSkill(callSkill, circleId, getSealStrategy, getMedia) {
  if (typeof callSkill !== 'function' || !circleId) return callSkill;
  return async (appOrigin, opId, args = {}) => {
    if (appOrigin !== 'stoop') return callSkill(appOrigin, opId, args);
    const strategy = (typeof getSealStrategy === 'function'
      && (SCOPED_WRITE_OPS.has(opId) || SCOPED_LIST_OPS.has(opId)))
      ? await getSealStrategy().catch(() => null) : null;
    if (SCOPED_WRITE_OPS.has(opId)) {
      const scoped = { ...args };
      if (scoped.groupId == null) scoped.groupId = circleId;   // don't clobber an explicit scope
      if (strategy && opId === 'postRequest' && typeof scoped.text === 'string' && scoped.text) {
        scoped.text = strategy.seal(scoped.text);             // seal the body at rest
      }
      if (opId === 'postRequest' && Array.isArray(scoped.attachments) && scoped.attachments.length) {
        // Sealed-only: an image attachment must ride the sealed circle-media pointer.
        const media = (typeof getMedia === 'function') ? await getMedia().catch(() => null) : null;
        if (!media || !media.mediaGateway) throw new Error('media-gateway-unavailable');
        const sealed = [];
        for (const att of scoped.attachments) {
          if (att && typeof att === 'object') sealed.push(await sealPostAttachment(att, media));
        }
        scoped.attachments = sealed;
      }
      return callSkill(appOrigin, opId, scoped);
    }
    const res = await callSkill(appOrigin, opId, args);
    if (SCOPED_LIST_OPS.has(opId) && res && Array.isArray(res.items)) {
      let items = res.items.filter((it) => keepForCircle(it, circleId));
      if (strategy) items = items.map((it) => openItemText(it, strategy));
      const media = (typeof getMedia === 'function') ? await getMedia().catch(() => null) : null;
      const opener = media && media.mediaGateway && media.mediaGateway.opener;
      if (opener) items = items.map((it) => openItemAttachmentThumbs(it, opener));
      return { ...res, items };
    }
    return res;
  };
}
