/**
 * basis — embed primitive (J7).
 *
 * Embeds are typed payloads carried inside chat messages — a
 * task-card, a file-card (v0.5+), a thread-ref (future).  The card
 * renders inline in the message stream with per-recipient action
 * buttons (gated by the embed-source-app's `appliesTo` rules).
 *
 * Phase v0.5 sub-slice (J7) per `/Project Files/basis/coding-plan.md`.
 *
 * Wire shape (cross-peer delivery comes in v0.5.1 via @onderling/chat-p2p
 * composition; v0.5.0 ships only the local model + renderer):
 *
 *   ChatMessage.embed?: {
 *     kind:        'item-card',     // v1; future: 'file-card'
 *     appOrigin:   string,           // 'tasks-v0', 'household', ...
 *     itemRef:     { app, type, id }, // canonical reference
 *     snapshot:    ItemSnapshot,     // cached display data (works offline)
 *     issuedBy?:   string,           // sender webid (per OQ-5)
 *     claimedBy?:  string,           // recipient webid when claimed
 *     claimedAt?:  number,           // epoch ms
 *   }
 *
 * Per OQ-5 user resolution (2026-05-21):
 *   - Sender ISSUES the embed (`issuedBy` = sender)
 *   - Receiver CLAIMS (`claimedBy = recipient`) — OR
 *   - Sender claims-on-behalf (`claimedBy = sender`) with a
 *     notification signal that the receiver still sees as a card.
 */

/**
 * @typedef {object} ItemSnapshot
 * @property {string}        id
 * @property {string}        type
 * @property {string}        [title]
 * @property {string}        [label]
 * @property {string}        [state]
 * @property {object}        [fields]    // per-app extra data for the card
 */

/**
 * @typedef {object} Embed
 * @property {'item-card'} kind
 * @property {string}      appOrigin
 * @property {{app: string, type: string, id: string}} itemRef
 * @property {ItemSnapshot}                            snapshot
 * @property {string}      [issuedBy]
 * @property {string}      [claimedBy]
 * @property {number}      [claimedAt]
 */

/**
 * Build an embed envelope from a snapshot reply.
 *
 * @param {object} args
 * @param {string} args.appOrigin
 * @param {ItemSnapshot} args.snapshot
 * @param {string} [args.issuedBy]
 * @returns {Embed}
 */
export function buildEmbed({ appOrigin, snapshot, issuedBy }) {
  if (typeof appOrigin !== 'string' || appOrigin === '') {
    throw new TypeError('buildEmbed: appOrigin required');
  }
  if (!snapshot || typeof snapshot !== 'object'
      || typeof snapshot.id !== 'string' || typeof snapshot.type !== 'string') {
    throw new TypeError('buildEmbed: snapshot { id, type } required');
  }
  const embed = {
    kind:      'item-card',
    appOrigin,
    itemRef:   { app: appOrigin, type: snapshot.type, id: snapshot.id },
    snapshot,
  };
  if (issuedBy) embed.issuedBy = issuedBy;
  return embed;
}

/**
 * Mark an embed as claimed.  Returns a NEW embed (immutable update);
 * mirrors the structured-clone-friendly pattern used by Thread
 * messages elsewhere.
 *
 * @param {Embed}  embed
 * @param {string} claimedBy   — webid of the claiming actor
 * @param {number} [claimedAt] — epoch ms (defaults to Date.now())
 * @returns {Embed}
 */
export function claimEmbed(embed, claimedBy, claimedAt) {
  if (!embed || embed.kind !== 'item-card') {
    throw new TypeError('claimEmbed: item-card embed required');
  }
  if (typeof claimedBy !== 'string' || claimedBy === '') {
    throw new TypeError('claimEmbed: claimedBy required');
  }
  return {
    ...embed,
    claimedBy,
    claimedAt: typeof claimedAt === 'number' ? claimedAt : Date.now(),
  };
}

/**
 * Compute which per-recipient actions surface on an embed card.
 * Walks the appOrigin's manifest operations and picks those whose
 * `appliesTo` gate accepts the snapshot.
 *
 * Per OQ-5: claimed embeds expose different actions than unclaimed
 * ones (e.g. a claimed task hides [Adopt] but still surfaces
 * [Mark done]).  The substrate-side `matchesAppliesTo` does the
 * filtering; this helper just wires it.
 *
 * @param {Embed}                                            embed
 * @param {object}                                           manifest
 * @returns {Array<{ opId: string, label: string, callbackData: string }>}
 */
export function actionsFor(embed, manifest) {
  if (!embed || !manifest || !Array.isArray(manifest.operations)) return [];
  // Top-level snapshot.{id,type,state} are canonical; `fields` is
  // extra display/gating data but MUST NOT override the canonical
  // state (caught by v0.5 embed-action tests where fields.state was
  // a stale 'open' while snapshot.state had moved to 'done').
  const item = {
    ...(embed.snapshot.fields ?? {}),
    id:    embed.snapshot.id,
    type:  embed.snapshot.type,
    state: embed.snapshot.state,
  };
  const out = [];
  for (const op of manifest.operations) {
    const ui = op?.surfaces?.ui;
    if (!ui || ui.control !== 'button') continue;
    if (!matchesAppliesTo(op.appliesTo, item)) continue;
    out.push({
      opId:         op.id,
      label:        ui.label ?? op.id,
      callbackData: `${op.id}:${item.id}`,
    });
  }
  return out;
}

/**
 * Local copy of @onderling/app-manifest's matchesAppliesTo helper —
 * imported indirectly via `renderChat.inlineKeyboardFor`, but
 * basis already does the same gating logic inline (see
 * src/web/domAdapter.js' list rendering).  Same shape; pulled here
 * to avoid a circular dep on a private function.
 */
export function matchesAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;
  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    if (!types.includes('*') && !types.includes(item.type)) return false;
  }
  if (appliesTo.kind !== undefined) {
    const kinds = Array.isArray(appliesTo.kind) ? appliesTo.kind : [appliesTo.kind];
    if (!kinds.includes('*') && !kinds.includes(item.kind)) return false;
  }
  if (appliesTo.state !== undefined) {
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    if (!states.includes(item.state)) return false;
  }
  return true;
}
