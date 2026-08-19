/**
 * embedChips — surface the canonical cross-object `embeds:[{type,ref}]` field
 * (packages/item-types) as small display chips on a card.
 *
 * `embeds` lets any item reference any other (a stoop post → a task, a task → a
 * calendar event, …); it's live on tasks/stoop/folio. This is the read side for
 * UI: normalize an item's embeds into display-ready chips. PURE + shared
 * web↔mobile (the shells render the chips with their own primitives).
 *
 * Phase 1 surfaces the reference itself (type + the embed's own label, or a
 * shortened ref). Resolving the ref to a LIVE title/card (cross-app, cross-pod
 * via Tasks `getItemTree`, with a placeholder on PERMISSION_DENIED) is a
 * follow-up — see REMAINING-WORK "Surface embeds[] on more cards".
 */

/** Emoji per known canonical type; 🔗 for anything else (forward-compatible). */
export const EMBED_TYPE_ICON = Object.freeze({
  'task':           '✅',
  'calendar-event': '📅',
  'request':        '🙋',
  'offer':          '🎁',
  'note':           '📝',
  'chat-message':   '💬',
});

/** The locale key for a type's human label (renderer falls back to the raw type). */
export function embedTypeLabelKey(type) {
  return `circle.embed.type.${type}`;
}

// embed `type` → the screen surface that hosts that item (S6.B panel). Tapping a
// chip opens this panel — "go to where the item lives". Types without a screen
// (request/offer/note today) render a non-tappable chip.
const EMBED_TYPE_SCREEN = Object.freeze({
  'task':           'tasks',
  'calendar-event': 'calendar',
});

/** The screen a chip of this type opens, or null (→ non-tappable chip). */
export function screenForEmbedType(type) {
  return EMBED_TYPE_SCREEN[type] ?? null;
}

/** Last meaningful segment of a ref (urn:dec:item:T2 · https://pod/…/X.json · pseudo-pod://…), truncated. */
export function shortRef(ref) {
  const s = String(ref ?? '');
  if (!s) return '';
  const tail = s.split(/[/:#]/).filter(Boolean).pop() || s;
  return tail.replace(/\.json$/i, '').slice(0, 28);
}

/**
 * Normalize an item's `embeds` (top-level OR stoop-legacy `source.embeds`) into
 * display-ready chips. Drops malformed entries (need both `type` and `ref`).
 *
 * @param {object} item  a post/task/message carrying `embeds` or `source.embeds`
 * @returns {{type:string, ref:string, icon:string, label:string|null}[]}
 */
export function embedChipsOf(item) {
  const raw = Array.isArray(item?.embeds)
    ? item.embeds
    : (Array.isArray(item?.source?.embeds) ? item.source.embeds : []);
  return raw
    // Valid when it has a `type` AND either a `ref` (the canonical reference) OR an
    // inline `object` payload (the item's data carried inline — no resolution needed).
    .filter((e) => e && typeof e === 'object' && e.type
      && ((e.ref != null && e.ref !== '') || (e.object && typeof e.object === 'object')))
    .map((e) => {
      // `denied` (embedResolve): an ACP-protected cross-pod ref you can't read →
      // a 🔒 placeholder chip, non-tappable (nothing to open).
      const locked = !!e.denied;
      return {
        type:  String(e.type),
        ref:   String(e.ref ?? ''),
        icon:  locked ? '🔒' : (EMBED_TYPE_ICON[e.type] ?? '🔗'),
        // Display label, best → worst: a RESOLVED live title (embedResolve) → the
        // embed's own stored label → null (renderer falls back to a short ref).
        label: pickLabel(e),
        // whether `label` is a resolved live title (vs a stored label / null).
        resolved: !!(e.title && String(e.title).trim()),
        // a locked chip is informational only — the renderers don't make it tappable.
        locked,
      };
    });
}

function pickLabel(e) {
  if (e.title && String(e.title).trim()) return String(e.title).trim();          // resolved live title
  const o = (e.object && typeof e.object === 'object') ? e.object : null;          // inline object payload
  const fromObj = o && (o.title ?? o.text ?? o.name ?? o.label);
  if (typeof fromObj === 'string' && fromObj.trim()) return fromObj.trim();
  if (typeof e.label === 'string' && e.label.trim()) return e.label.trim();        // stored label
  return null;
}
