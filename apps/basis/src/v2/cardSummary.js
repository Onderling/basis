/**
 * cardSummary — the ONE reading of an embed card, for a shell that paints its own.
 *
 * Web renders a card through the shared dom adapter (`renderToDom({kind:'embed-card'})`), which has
 * known every variant since v0.5.5. React Native cannot use that — it paints no DOM — and the choice
 * there is between a second implementation of "what does this card say" and one projection both shells
 * read. The second implementation is how a photo chip and a photo card come to disagree about the same
 * photo, so: this returns the reading, and each shell paints it.
 *
 * Deliberately small. A card's DETAIL is whatever that variant makes a person able to act on — an
 * appointment's time, a file's size, a task's status — and nothing else: the card is a pointer into the
 * app that owns the thing, not a copy of it.
 */

/** The icon each variant wears. Same glyphs as the captions, so a card and its text agree. */
const ICON = Object.freeze({
  'time-card':  '📅',
  'item-card':  '🔗',
  'file-card':  '📎',
  'media-card': '📷',
});

/** Format an ISO instant as a person reads it here. Absent/unparseable → null, never "Invalid Date". */
function when(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * @param {object} card  a `*-card` embed (`{kind, snapshot, itemRef, …}`)
 * @returns {{icon:string, title:string, detail:string, kind:string}|null} null when it is not a card
 */
export function cardSummary(card) {
  if (!card || typeof card !== 'object' || typeof card.kind !== 'string' || !card.kind.endsWith('-card')) {
    return null;
  }
  const snap = card.snapshot && typeof card.snapshot === 'object' ? card.snapshot : {};
  const title = String(snap.title ?? snap.name ?? snap.caption ?? snap.id ?? '').trim();

  let detail = '';
  if (card.kind === 'time-card') {
    const from = when(snap.startAt);
    const to = when(snap.endAt);
    detail = from ? (to ? `${from} → ${to}` : from) : '';
  } else if (card.kind === 'file-card') {
    detail = [snap.mime, Number.isFinite(snap.size) ? `${Math.round(snap.size / 1024)} kB` : null]
      .filter(Boolean).join(' · ');
  } else if (card.kind === 'media-card') {
    detail = [snap.mime, snap.width && snap.height ? `${snap.width}×${snap.height}` : null]
      .filter(Boolean).join(' · ');
  } else {
    // An item: what a person would act on — is it open, and whose is it.
    detail = [snap.status, snap.assignee].filter(Boolean).join(' · ');
  }

  return { kind: card.kind, icon: ICON[card.kind] ?? '🔗', title, detail };
}

export default cardSummary;
