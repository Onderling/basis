/**
 * WHAT TO PAINT WHERE A PERSON'S FACE GOES — the one answer, for every shell and every row.
 *
 * A face is optional and always has been: most people will not set one, and a row must look deliberate
 * without it rather than like something failed to load. So this returns what to draw, not whether a picture
 * exists, and the caller paints one of two shapes.
 *
 * It lives here rather than in a shell because the DECISION is shared and only the drawing differs — web puts
 * an `<img>` in a `<span>`, mobile an `<Image>` in a `<View>`, the box paints nothing at all. A shell that
 * worked out "picture or initial?" for itself would be a projection in a shell, and the two would drift the
 * first time the rule changed (which is how the same person ended up with two names in Contacten).
 *
 * The initial is a FALLBACK, not a placeholder: it is the person's own first letter, stable across reloads and
 * devices, so a row without a picture still tells you who it is at a glance.
 */

/** Everything a row might call itself, in the order a person would recognise. */
const nameish = (row) => (
  (typeof row?.name === 'string' && row.name) ? row.name
    : (typeof row?.displayName === 'string' && row.displayName) ? row.displayName
      : (typeof row?.said?.displayName === 'string' && row.said.displayName) ? row.said.displayName
        : (typeof row?.handle === 'string' && row.handle) ? row.handle
          : (typeof row?.said?.handle === 'string' && row.said.handle) ? row.said.handle
            : ''
);

/** The face a row carries, from the lane only — never from the private `avatarUrl` cache beside it. */
const thumbOf = (row) => {
  const t = (typeof row?.avatarThumb === 'string' && row.avatarThumb) ? row.avatarThumb
    : (typeof row?.said?.avatarThumb === 'string' && row.said.avatarThumb) ? row.said.avatarThumb
      : (typeof row?.face === 'string' && row.face) ? row.face
        : null;
  // The fold already refused anything that is not a bounded image, but a row can also come from a cache or a
  // test fixture, and a shell must never be handed a `src` it would fetch from somebody else's server.
  return (t && t.startsWith('data:image/')) ? t : null;
};

/**
 * @param {object} row  a roster row, a Contacten row, or a thread header's subject
 * @returns {{kind: 'thumb', thumb: string, alt: string} | {kind: 'initial', initial: string, alt: string}}
 */
export function faceOf(row) {
  const s = nameish(row).trim();
  // A middle dot rather than a letter when there is nothing to take one from: an empty circle reads as "no
  // name yet", where a random glyph would read as a name nobody recognises.
  // One whole character, via the spread: `'Émile'[0]` and an emoji name both hand back half a character.
  const initial = s ? [...s][0].toUpperCase() : '·';
  const alt = s || '?';
  const thumb = thumbOf(row);
  // The initial rides along even when there IS a picture, so a shell whose image fails to decode has the
  // person's own letter to fall back to rather than a hole where somebody was.
  return thumb ? { kind: 'thumb', thumb, initial, alt } : { kind: 'initial', initial, alt };
}

/** True when this row would paint a picture — for a shell deciding whether to reserve the space. */
export const hasFace = (row) => thumbOf(row) !== null;
