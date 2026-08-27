/**
 * Portable embed-card button computation — the basis-side adapter onto the projector's item-row rule.
 *
 * It walks the embed's appOrigin manifest for `surfaces.ui.control === 'button'` ops whose `appliesTo`
 * matches the embed's snapshot, and returns `{label, callbackData, opId, itemId}` per button; the
 * caller picks how to render (DOM button, RN Pressable, …) and how a tap dispatches.
 *
 * ── WHY THIS IS NOW FOUR LINES ───────────────────────────────────────────────────────────────────
 * It used to walk the operations itself and carry its own copy of the `appliesTo` predicate — a
 * second implementation of the rule the chat keyboard already had, and the rule the whole "every op
 * reachable by chat or an inline menu" guarantee runs on. The two copies had already drifted: this
 * one never honoured the `'*'` wildcard, and it treated an op with NO `appliesTo` as belonging on
 * every row, so a single noticeboard post offered 27 buttons — `removeMember` and
 * `restoreFromMnemonic` among them. Both faults are fixed where the rule lives, in `itemRowButtons`.
 *
 * State guard, kept here because it is genuinely this adapter's job: the canonical state is
 * `snapshot.state`, never `snapshot.fields.state` — the same item merge as `apps/basis/src/embed.js`.
 */
import { itemRowButtons } from '@onderling/app-manifest';

/**
 * @typedef {object} EmbedButton
 * @property {string} label
 * @property {string} callbackData   '<opId>:<itemId>' (web's onButtonTap shape)
 * @property {string} opId
 * @property {string} itemId
 *
 * @param {object} args
 * @param {Object<string, object>}    args.manifestsByOrigin
 * @param {object}                    args.embed     `{appOrigin, snapshot, ...}` envelope
 * @returns {EmbedButton[]}
 */
export function computeEmbedButtons({ manifestsByOrigin, embed } = {}) {
  if (!manifestsByOrigin || !embed?.appOrigin) return [];
  const manifest = manifestsByOrigin[embed.appOrigin];
  if (!manifest) return [];
  const snap = embed.snapshot ?? {};
  const item = {
    ...(snap.fields ?? {}),
    id:    snap.id,
    type:  snap.type,
    state: snap.state,
  };
  return itemRowButtons(manifest, item)
    .map(({ opId, label, callbackData }) => ({ label, callbackData, opId, itemId: String(item.id ?? '') }));
}
