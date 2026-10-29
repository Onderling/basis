/**
 * A persona's HANDLE: the name it goes by in every circle it joins. An ATTRIBUTE of the persona, not a property under
 * disclosure: it is presented by the persona's own statements (the join's handle, a later member-props), so it is by
 * definition public to whoever the persona joins, and a disclosure policy has nothing to decide about it. It is never
 * part of a release; the release machinery refuses it like a marker. The person sets it (setMyHandle), so it is
 * person-settable through the property ops.
 */

/** The profile key that holds the persona's handle. */
export const HANDLE_KEY = 'handle';

/** Is this key a persona attribute that statements present, so no release ever carries it? */
export function isPresentedAttributeKey(key) {
  return key === HANDLE_KEY;
}
