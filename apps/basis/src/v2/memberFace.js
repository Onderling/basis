/**
 * WHAT TO PAINT WHERE A PERSON'S FACE GOES — the one answer, for every shell and every row.
 *
 * A face is optional and always has been: most people will not set one, and a row must look deliberate without
 * it rather than like something failed to load. So this returns what to draw, not whether a picture exists.
 *
 * THE PICTURE IS THE PERSONA'S, and there is only one of it. `profilePicture` is a media-typed persona
 * attribute (`@onderling/agent-registry` `mediaProperty.js`): sealed to the owner, re-sealed per circle when
 * it is disclosed, and carried in the release as `personaProperties.profilePicture` on `member-props`. So a
 * face is subject to the same per-circle disclosure as every other attribute — minimum by default, the person
 * is the final editor, and L115's take-back withdraws it like anything else.
 *
 * (A second road briefly existed: an inline `said.avatarThumb` beside the names. It was built, and it was
 * duplication — the decisions entry of 2026-09-22 had already settled that the persona attribute is the
 * picture road. Removed 09-23. If you are about to add a picture field somewhere, it is this one.)
 *
 * The REF is returned, not an image: the thumbnail inside it is sealed, and only a shell holds the circle's
 * media opener to unseal it. The decision is shared; the unsealing is the shell's, which is the same split
 * every media surface here uses.
 */
import { isSealedMediaRef } from '@onderling/agent-registry';

/** Everything a row might call itself, in the order a person would recognise. */
const nameish = (row) => (
  (typeof row?.name === 'string' && row.name) ? row.name
    : (typeof row?.displayName === 'string' && row.displayName) ? row.displayName
      : (typeof row?.said?.displayName === 'string' && row.said.displayName) ? row.said.displayName
        : (typeof row?.handle === 'string' && row.handle) ? row.handle
          : (typeof row?.said?.handle === 'string' && row.said.handle) ? row.said.handle
            : ''
);

/**
 * The picture a row carries, from the RELEASE only.
 *
 * Present on the row at all ⇒ this person disclosed it to this circle: the fold puts only the released
 * properties on a row, so there is no separate "may I show this?" for a shell to get wrong. An unsealed or
 * malformed value is not a picture — never a bare URL, which would turn painting a row into a request to
 * somebody else's server that says who is reading it and when.
 */
const pictureOf = (row) => {
  const p = row?.personaProperties?.profilePicture
    ?? row?.said?.personaProperties?.profilePicture
    ?? row?.profilePicture
    ?? null;
  return isSealedMediaRef(p) ? p : null;
};

/**
 * @param {object} row  a roster row, a Contacten row, or a thread header's subject
 * @returns {{kind: 'picture', picture: object, initial: string, alt: string}
 *          |{kind: 'initial', initial: string, alt: string}}
 */
export function faceOf(row) {
  const s = nameish(row).trim();
  // One whole character, via the spread: `'Émile'[0]` and an emoji name both hand back half of one.
  // A middle dot when there is nothing to take one from: an empty slot reads as "no name yet", where a
  // random glyph would read as a name nobody recognises.
  const initial = s ? [...s][0].toUpperCase() : '·';
  const alt = s || '?';
  const picture = pictureOf(row);
  // The initial rides along even when there IS a picture: the thumbnail has to be unsealed before it can be
  // drawn, and a shell that cannot (no opener, a failed open, a format it lacks) needs the person's own
  // letter to fall back to rather than a hole where somebody was.
  return picture ? { kind: 'picture', picture, initial, alt } : { kind: 'initial', initial, alt };
}

/** True when this row would paint a picture — for a shell deciding whether to reserve the space. */
export const hasFace = (row) => pictureOf(row) !== null;
