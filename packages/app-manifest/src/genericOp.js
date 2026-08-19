/**
 * genericOp — the identity codec for a GENERIC (op-less) capability's synthetic op-id (PLAN-capability-arc §1b).
 *
 * A capability declared on a noun with NO implementing op ("declare a noun → get CRUD free") still needs a
 * stable handle so the standard machinery can carry it: the catalogue synthesises a virtual op whose id encodes
 * `(app, atom, noun)`, `renderSlash`/`buildToolDescriptors` project it onto slash + LLM surfaces, the gate
 * authorises it by `(atom × noun)`, and the dispatch waist decodes it back to route to the generic handler
 * (`createGenericAtomHandlers` via a service's `callCapability`). Both the SYNTH side (catalogue) and the DECODE
 * side (real-agent callSkill) key off this one codec so the format can't drift.
 *
 * Format: `__generic__:<app>:<atom>:<noun>` — `__generic__` can't collide with a real op-id, and app/atom/noun
 * are single tokens (no `:`), so a plain split round-trips.
 */
const PREFIX = '__generic__';
const SEP = ':';

/** Encode a generic capability into its synthetic op-id. */
export function encodeGenericOpId(app, atom, noun) {
  return [PREFIX, app, atom, noun].join(SEP);
}

/** True iff `opId` is a synthetic generic op-id (cheap prefix check for the dispatch hot path). */
export function isGenericOpId(opId) {
  return typeof opId === 'string' && opId.startsWith(PREFIX + SEP);
}

/**
 * Decode a synthetic op-id back to `{ app, atom, noun }`, or `null` when it isn't one / is malformed.
 * @returns {{app:string, atom:string, noun:string}|null}
 */
export function decodeGenericOpId(opId) {
  if (!isGenericOpId(opId)) return null;
  const parts = opId.split(SEP);
  if (parts.length !== 4) return null;
  const [, app, atom, noun] = parts;
  return (app && atom && noun) ? { app, atom, noun } : null;
}
