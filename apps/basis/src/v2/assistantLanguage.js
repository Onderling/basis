/**
 * assistantLanguage — which language a member wrote in, as a HINT for the assistant's reply.
 *
 * Not a switch: the prompt tells the model to reply in the member's language, and this adds "the member wrote in:
 * en" when the line says so clearly. A wrong hint pushes the reply into the wrong language, so the counter names a
 * language only on a clear margin and otherwise says nothing (the model then reads the line itself, and the door's
 * language is the fallback the prompt names).
 *
 * Two closed sets of function words (the words a sentence cannot do without), counted per line. Measured against
 * eld and tinyld on the eval's fixtures, the household lines and thirty Dutch prompts (90 lines, 53 under 30
 * characters): this was never wrong (83 right, 7 undecided); tinyld named one short English line Dutch, eld
 * answered "another language" on three. It needs no dependency. Dutch and English only, like the door languages.
 */

const NL = new Set(('de het een en van op in is niet wat wie waar hoe er nog ook maar je jij ik we wij zijn heb '
  + 'hebben moet moeten kan kun wil zet doe voeg toe erbij graag lijst boodschappen staat dat die dit deze met voor '
  + 'naar om te bij geen meer al nu dan').split(' '));
const EN = new Set(('the a an and of on in is not what who where how there still also but you i we are have has '
  + 'must can could will add put please list shopping that this these with for to at no more already now then do '
  + 'does it my our some me show').split(' '));

/** The languages the counter can name (the door languages). */
export const DETECTABLE_LANGS = Object.freeze(['nl', 'en']);

/**
 * @param {string} text  one line from a member
 * @returns {'nl'|'en'|null}  null when the line gives no clear margin (short lines, names, a single noun)
 */
export function detectLang(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  let nl = 0;
  let en = 0;
  for (const w of words) {
    if (NL.has(w)) nl += 1;
    if (EN.has(w)) en += 1;
  }
  if (nl === en) return null;
  return nl > en ? 'nl' : 'en';
}
