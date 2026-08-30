/**
 * The chat-shell names that resolve to a real stoop op — ONE table, read by the dispatcher (realAgent)
 * and by the circle scope (`circleStoopScope.js`), so an alias of a circle-scoped op is scoped too.
 */
export const STOOP_OP_ALIAS = Object.freeze({
  listFeed:        'listOpen',
  getStoopProfile: 'getMyProfile',
  getBulletin:     'listOpen',
});
