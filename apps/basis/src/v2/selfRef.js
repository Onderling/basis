/**
 * WHO I AM IN A CIRCLE, for a lane that signs there. A device can be several people (personas), one self per circle;
 * a lane names, beside the per-circle key that signed a statement, the self that key belongs to. `myRef` is that
 * self: one ref for a device that is one person, or a function of the circle for one that is several.
 *
 * @param {string|((circleId: string) => string|null)} myRef
 * @returns {(circleId: string) => string|null}
 */
export function selfRefIn(myRef) {
  return typeof myRef === 'function' ? (circleId) => myRef(circleId) : () => myRef;
}
