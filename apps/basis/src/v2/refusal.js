/**
 * refusal — the ONE shape of a "no", and the ONE order in which the checks that can say it are asked.
 *
 * A household bot's action passes several checks, each where it binds (the enforceability rule: a gate sits where a
 * different client could not skip it): the door admits the person, the host gate checks their tier, the door's map
 * says whether the op is on this door at all and for their role, the circle's availability says whether the op can
 * happen here, the op's own rule decides (the tasks app's `rolePolicy`), and the door's settings loosen or tighten
 * that. Later: a grant on the lane, the remit at the realm. Folding them into one function would move each away from
 * where it binds; what is ONE thing is the ORDER and the REASON:
 *   - every check answers `null` (go on) or a refusal `{layer, code, message?}`;
 *   - a composition declares its checks as an ordered list of these layers, and asks them deny-wins: the first no
 *     is the answer, and a later check never re-allows what an earlier one refused.
 * The order is written once in `docs/architecture.md` ("The order, written once"); a fitness test pins `GATE_LAYERS`
 * to it.
 */

/** The layers, in the order they are asked. */
export const GATE_LAYERS = Object.freeze([
  'admission', 'tier', 'door-map', 'door-role', 'availability', 'op-rule', 'door-settings', 'grant', 'remit',
]);

/**
 * A refusal: which layer said no, its code, and (when the check has one) the words for the person.
 * @param {string} layer  one of GATE_LAYERS
 * @param {string} code
 * @param {string} [message]
 */
export function refuse(layer, code, message = null) {
  if (!GATE_LAYERS.includes(layer)) throw new TypeError(`refuse: unknown layer "${layer}"`);
  return Object.freeze({ layer, code: String(code || 'refused'), ...(message ? { message } : {}) });
}

/** Is this a refusal (`{layer, code}` with a known layer)? */
export const isRefusal = (x) => Boolean(x && typeof x === 'object' && GATE_LAYERS.includes(x.layer) && typeof x.code === 'string');

/**
 * Ask the checks in their order; the first refusal is the answer (deny-wins), `null` when every one lets it go on.
 * @param {Array<(input: object) => (object|null|Promise<object|null>)>} checks
 * @param {object} input
 */
export async function firstRefusal(checks, input) {
  for (const check of checks) {
    const r = await check(input);
    if (r) return r;
  }
  return null;
}

/** The words a door says for a refusal: the check's own, else the layer's line for its code. */
export function refusalText(r, t) {
  if (!r) return '';
  if (r.message) return r.message;
  return typeof t === 'function' ? t(`circle.refusal.${r.code}`) : r.code;
}
