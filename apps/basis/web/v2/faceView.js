/**
 * The web's way of drawing a face. The DECISION — picture or initial, and which name — is `faceOf` in
 * `src/v2/memberFace.js`, shared with mobile; this file is only the drawing, which is the whole of what a
 * shell decides.
 *
 * One place rather than three, because a Contacten row, a roster row and a thread header show the same person
 * and must show them the same way. Three copies of "an img, or a letter in a circle" is how the same contact
 * ends up looking like two people on two screens.
 *
 * The picture is a SEALED media ref — the persona's `profilePicture`, re-sealed for this circle when it was
 * disclosed — so it has to be opened before it can be drawn. That is the shell's half: the host passes a
 * resolver bound to the circle's media opener (`makeCirclePictureResolver`, the same one the Mij preview and
 * the member card use). No resolver, or an open that fails, and the row keeps the person's initial rather
 * than a hole where somebody was.
 */
import { faceOf } from '../../src/v2/memberFace.js';

/**
 * Fill `el` with this row's face. Clears whatever was there, so it is safe to call on a re-render.
 *
 * @param {HTMLElement} el   the slot — a span or div sized by CSS, not by this
 * @param {object} row       a Contacten row, a roster row, or a thread header's subject
 * @param {object} [opts]
 * @param {(ref: object) => Promise<string|null>} [opts.resolvePicture]  unseal the ref to an object URL
 * @param {string} [opts.fallbackGlyph]  drawn instead of an initial (a bot's 🤖 — it is not a person)
 */
export function paintFace(el, row, { resolvePicture = null, fallbackGlyph = null } = {}) {
  if (!el) return;
  el.replaceChildren();
  el.classList.remove('has-face');
  if (fallbackGlyph) { el.textContent = fallbackGlyph; return; }

  const face = faceOf(row);
  // The initial goes down FIRST, always. A sealed thumbnail takes a moment to open and may not open at all,
  // and a row that shows nothing in the meantime reads as a person who is missing.
  el.textContent = face.initial;
  if (face.kind !== 'picture' || typeof resolvePicture !== 'function') return;

  Promise.resolve(resolvePicture(face.picture)).then((url) => {
    if (!url) return;                       // not openable by this device — the initial stands
    const img = document.createElement('img');
    img.className = 'cc-face__img';
    img.src = url;
    img.alt = '';                           // the name is beside it; a screen reader should not hear it twice
    img.decoding = 'async';
    img.addEventListener('error', () => { el.replaceChildren(); el.classList.remove('has-face'); el.textContent = face.initial; }, { once: true });
    el.replaceChildren(img);
    el.classList.add('has-face');
  }).catch(() => { /* the initial stands */ });
}
