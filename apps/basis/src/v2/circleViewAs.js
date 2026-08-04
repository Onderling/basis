/**
 * basis v2 — "View as…" reveal/openness projection (shared).
 *
 * A read-only preview of a circle's member directory as a *chosen viewer*
 * would see it — re-running the reveal/openness rules, not new data.  The
 * viewer is a member, a stranger, or an agent; the circle's `revealPolicy`
 * ('open' | 'pairwise') plus each member's own RELEASE decide whether the
 * viewer sees a real name or just a handle.  Pure projection over the
 * member list; web + mobile share this, the renderers are thin.
 *
 * REVEALING IS THE DISCLOSER'S ACT. A name is visible here because its owner
 * released it to this circle (the per-circle persona release, captured at
 * join or a later share) — never because a viewer flipped a preference.
 * For a while this module gated on a `reveals[]` array that was in fact a
 * viewer-side opt-in synthesized at read time, which made "revealed to me"
 * true whenever *I* had opted in — the inverse of the intended consent
 * direction. The viewer-side preference still exists (the Reveals store,
 * a personal "show me names" display toggle) but it is a separate fact
 * with a separate name, and it can only ever NARROW what a release shows.
 */

/** Who you can preview the circle as. */
export const VIEWER_KINDS = ['member', 'stranger', 'agent'];

/**
 * @typedef {object} CircleMember
 * @property {string}   id
 * @property {string}   [handle]          pseudonymous display (always visible)
 * @property {string}   [realName]        the RELEASED name (null when the member released none)
 * @property {boolean}  [released]        the member released their name to this circle
 * @property {string}   [ownDisplayName]  local display-cache name — used ONLY for the viewer's own row
 */

/**
 * Project the directory as `viewer` sees it.  A real name is visible when:
 *   - the row is the viewer themselves (a member always sees their own), OR
 *   - the viewer is a member AND (policy === 'open' OR the row's member RELEASED their name here).
 * Strangers and agents never see real names (openness is member-to-member).
 *
 * @param {object}         [opts]
 * @param {CircleMember[]} [opts.members=[]]
 * @param {{id?: string, kind?: string}} [opts.viewer={}]
 * @param {'open'|'pairwise'} [opts.policy='pairwise']
 * @returns {{ id, handle, realName, revealed, self, displayName }[]}
 */
export function viewAsDirectory({ members = [], viewer = {}, policy = 'pairwise' } = {}) {
  const kind = VIEWER_KINDS.includes(viewer.kind) ? viewer.kind : 'member';
  const viewerId = viewer.id ?? null;
  const isMemberViewer = kind === 'member';
  return (members || [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const self = isMemberViewer && viewerId != null && m.id === viewerId;
      // 'open' widens what a member sees; the release is the member's own standing choice.
      // An 'open' circle only has names to show for members who put one somewhere at all, so the
      // released name is what it shows — openness never conjures a name nobody disclosed.
      const seesRealName = self || (isMemberViewer && (policy === 'open' || m.released === true));
      const handle = m.handle ?? null;
      // Your own row may fall back to the local display cache — your device holds your name
      // whether or not you released it, and hiding you from yourself informs nobody.
      const realName = (m.realName ?? (self ? m.ownDisplayName : null)) ?? null;
      return {
        id:          m.id,
        handle,
        realName: seesRealName ? realName : null,
        revealed:    !!(seesRealName && realName),
        self:        !!self,
        displayName: (seesRealName && realName) ? realName : (handle ?? m.id),
      };
    });
}

/**
 * The reveal-gated LABEL for one roster row — what a members list may actually show.
 *
 * One helper so web and mobile can never diverge on it (invariants #1/#2). The rule: your own row
 * always shows your name, an `open` circle shows RELEASED names to members, and otherwise only the
 * member's own release does.  The row's `realName` is release-sourced (`memberToViewAs`); a raw
 * display-cache name never reaches this function for another member because the projection never
 * carries one.
 *
 * @param {CircleMember} member
 * @param {{viewerId?:string|null, policy?:'open'|'pairwise'}} [opts]
 * @returns {{primary:string, secondary:string|null, revealed:boolean}}
 *   `primary` is always safe to render; `secondary` is the real name ONLY when it may be shown.
 */
export function revealedMemberLabel(member, { viewerId = null, policy = 'pairwise' } = {}) {
  const m = member && typeof member === 'object' ? member : {};
  const self = viewerId != null && m.id === viewerId;
  const revealed = !!(self || policy === 'open' || m.released === true);
  const handle = m.handle ?? null;
  const realName = (m.realName ?? (self ? m.ownDisplayName : null)) ?? null;
  return {
    revealed,
    // Never fall back to the real name for an unreleased member — the id is the honest last resort.
    primary: handle ? `@${handle}` : ((revealed && realName) ? realName : (m.id ?? '')),
    secondary: (revealed && realName && handle) ? realName : null,
  };
}
