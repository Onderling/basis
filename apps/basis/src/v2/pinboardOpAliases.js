/**
 * The chat-shell names that resolve to a real pinboard op — ONE table, read by the dispatcher (realAgent)
 * and by the circle scope (`circlePinboardScope.js`), so an alias of a circle-scoped op is scoped too.
 */
export const PINBOARD_OP_ALIAS = Object.freeze({
  listFeed:        'listOpen',
  getPinboardProfile: 'getMyProfile',
  getBulletin:     'listOpen',
});
