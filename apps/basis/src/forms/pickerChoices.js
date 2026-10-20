/**
 * What a picker offers: the reply of the read a field names (`pickerSource: {listOp, appOrigin}`) as `{id, label}[]` —
 * one mapping both shells' forms use. A circle list (`listMyCircles` → `{circles, names}`) offers the circles by the
 * name a person gave them, without the pair circles (a contact's two-person circle is not a circle one picks); any
 * other list (`items`, `entries`, or a bare array) by its id (or webid) and its words.
 */
import { isPairCircleId } from '../v2/pairCircleId.js';

const idOf = (c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id ?? null));

/** @param {unknown} reply @returns {Array<{id: string, label: string}>} */
export function pickerChoices(reply) {
  if (Array.isArray(reply?.circles)) {
    const names = reply.names && typeof reply.names === 'object' ? reply.names : {};
    return reply.circles.map(idOf).filter((id) => typeof id === 'string' && id && !isPairCircleId(id))
      .map((id) => ({ id, label: String(names[id] || id) }));
  }
  const rows = Array.isArray(reply) ? reply : (Array.isArray(reply?.items) ? reply.items : (Array.isArray(reply?.entries) ? reply.entries : []));
  return rows.filter((r) => r && (r.id ?? r.webid) != null)
    .map((r) => ({ id: String(r.id ?? r.webid), label: String(r.label ?? r.text ?? r.title ?? r.name ?? r.id ?? r.webid) }));
}

/**
 * A field's choices, fetched through the shell's waist.
 * @param {(app: string, op: string, args: object) => Promise<unknown>} call
 * @param {string} appOrigin   the field's own app, for a source that names none
 * @returns {(decl: {listOp: string, appOrigin?: string, filter?: object}) => Promise<Array<{id: string, label: string}>>}
 */
export function makePickerFetcher(call, appOrigin) {
  return async (decl) => {
    if (!decl?.listOp || typeof call !== 'function') return [];
    const r = await call(decl.appOrigin ?? appOrigin, decl.listOp, decl.filter && typeof decl.filter === 'object' ? { ...decl.filter } : {});
    return pickerChoices(r);
  };
}

/** One choice is no question: its id; none or several → null (the form asks). */
export function onlyChoice(choices) {
  return Array.isArray(choices) && choices.length === 1 ? choices[0].id : null;
}
