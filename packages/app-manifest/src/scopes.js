/**
 * WHERE an op (or a noun's generic atoms) is offered, declared ONCE on the op or noun: `scopes`, any of
 *   own     the person's own "+" (their own things, their own assistant thread)
 *   circle  a circle's composer and its bot (the default when nothing is declared)
 *   contact a contact thread
 * Read by every projection that offers an op: the model's tools (`renderChat`), the "/" list and the gate phrases
 * (`renderSlash`, `renderGate`), and the buttons (`renderAttachments`). A button may only NARROW it
 * (`surfaces.attach.buttonIn`, a subset); no surface names a place of its own: the validator refuses that, so a place
 * is decided in one spot and an app that declares an own-scope op appears in the "+" with no shell code.
 */

export const SCOPE_PLACES = Object.freeze(['own', 'circle', 'contact']);

const places = (list) => (Array.isArray(list) ? list.filter((x) => SCOPE_PLACES.includes(x)) : []);

/** The places an op or noun is offered: its declared `scopes`, else a circle. */
export function opScopes(holder) {
  const s = places(holder?.scopes);
  return s.length ? s : ['circle'];
}

/** Is it offered in `scope`? No scope asked (a caller that does not filter): yes, as before the declaration. */
export function inScope(holder, scope) {
  return !scope || opScopes(holder).includes(scope);
}

/** Where its BUTTON shows: `attach.buttonIn` narrowed to the op's places, else the op's places. */
export function buttonScopes(holder, attach) {
  const all = opScopes(holder);
  const b = places(attach?.buttonIn).filter((x) => all.includes(x));
  return b.length ? b : all;
}
