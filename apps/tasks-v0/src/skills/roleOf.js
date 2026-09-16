/**
 * The ONE answer to "what is this caller's role in this circle" for every authority gate in this app.
 *
 * Two sources exist, and only one of them is honest in a multi-circle host. The bundle's own `roles` map
 * is composed locally from `members` literals — and a lazily-opened circle inherits the primary circle's
 * members, so on a host it carries this device as admin of every circle it ever touches. A gate reading it
 * refuses nobody local and knows nothing about a promotion made on the circle's signed record. The host's
 * membership head — the fold of the circle's signed statements — is the circle's answer, not the device's.
 *
 * So: a host injects `circleRoleOf(circleId, webid)` and every gate asks it. Without a host reader the
 * declared map is the composition's explicit statement of who runs the circle (a single-circle agent is
 * built with exactly that map), and that is what the gates read. A reader that throws or answers nothing
 * yields `null`, and every gate refuses on `null` — absence never falls through to a yes.
 */

/**
 * @param {((circleId: string, webid: string) => Promise<string|null>)|null} circleRoleOf  the host's reader
 * @returns {(circle: object, webid: string) => Promise<string|null>}
 */
export function makeRoleOf(circleRoleOf = null) {
  if (typeof circleRoleOf === 'function') {
    return async (circle, webid) => {
      if (!circle || typeof webid !== 'string' || !webid) return null;
      const circleId = circle.circleId ?? circle.liveCircle?.circleId ?? circle.id ?? null;
      if (!circleId) return null;
      try {
        const role = await circleRoleOf(circleId, webid);
        return typeof role === 'string' && role ? role : null;
      } catch { return null; }
    };
  }
  return async (circle, webid) => {
    if (!circle || typeof webid !== 'string' || !webid) return null;
    const role = circle.roles?.[webid];
    return typeof role === 'string' && role ? role : null;
  };
}
