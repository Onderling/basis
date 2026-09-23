/**
 * The web's way of drawing a face. The DECISION — picture or initial, and which name — is `faceOf` in
 * `src/v2/memberFace.js`, shared with mobile; this file is only the drawing, which is the whole of what a
 * shell decides.
 *
 * One place rather than three, because a Contacten row, a roster row and a thread header show the same person
 * and must show them the same way. Three copies of "an img, or a letter in a circle" is how the same contact
 * ends up looking like two people on two screens.
 */
import { faceOf } from '../../src/v2/memberFace.js';

/**
 * Fill `el` with this row's face. Clears whatever was there, so it is safe to call on a re-render.
 *
 * @param {HTMLElement} el   the slot — a span or div sized by CSS, not by this
 * @param {object} row       a Contacten row, a roster row, or a thread header's subject
 * @param {object} [opts]
 * @param {string} [opts.fallbackGlyph]  drawn instead of an initial (a bot's 🤖 — it is not a person)
 */
export function paintFace(el, row, { fallbackGlyph = null } = {}) {
  if (!el) return;
  el.replaceChildren();
  el.classList.remove('has-face');
  if (fallbackGlyph) { el.textContent = fallbackGlyph; return; }

  const face = faceOf(row);
  if (face.kind === 'thumb') {
    const img = document.createElement('img');
    img.className = 'cc-face__img';
    img.src = face.thumb;              // inline `data:image/` only — `faceOf` refuses anything fetchable
    img.alt = '';                      // the name is beside it; a screen reader should not hear it twice
    img.decoding = 'async';
    // A picture that will not decode (a truncated statement, a format this browser lacks) must not leave a
    // hole where a person was: fall back to the letter the row would have had.
    img.addEventListener('error', () => { el.replaceChildren(); el.classList.remove('has-face'); el.textContent = face.initial; }, { once: true });
    el.classList.add('has-face');
    el.appendChild(img);
    return;
  }
  el.textContent = face.initial;
}
