/**
 * The doors at the top of My data — the views that used to sit as a hand-written list on Mij (availability, the
 * connection points, what was shared with me, the people I blocked). Mij keeps ONE door, My data; these are behind
 * it, declared once here and painted by both shells, each id mapped to the view it opens. A shell without a view for
 * an id paints no button for it.
 */
export const MY_DATA_DOORS = Object.freeze([
  Object.freeze({ id: 'availability',      labelKey: 'circle.profile.availability' }),
  Object.freeze({ id: 'connection-points', labelKey: 'circle.nearbyScreen.points_open' }),
  Object.freeze({ id: 'shared-with-me',    labelKey: 'circle.profile.sharedWithMe' }),
  Object.freeze({ id: 'blocked',           labelKey: 'circle.profile.blocked' }),
]);

/**
 * The doors this shell can open, in order.
 * @param {Record<string, Function|undefined>} open   id → what opens it here
 * @returns {Array<{id: string, labelKey: string, open: Function}>}
 */
export function myDataDoorsFor(open = {}) {
  return MY_DATA_DOORS.filter((d) => typeof open[d.id] === 'function').map((d) => ({ ...d, open: open[d.id] }));
}
