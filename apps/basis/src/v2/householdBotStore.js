/**
 * Where a household bot's things live: its lists, chores and appointments are typed items in the household circle's
 * ONE store, each with its noun's verbs over that store (`listsOps`, `tasksOps`, `circleCalendarOps`). One
 * declaration, spread by the box (`bin/device-runner.mjs`) and by every test that composes the bot — so a test can
 * never boot a bot whose chores live somewhere the box's do not.
 *
 * The household's circle id is the BOT's, derived from its key: a circle id is the scope key on every device, so two
 * households under one fixed id would merge on the phone of a person who is in both. Derived, not random, so it is
 * the same after a restore.
 */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The household circle's id for a bot: `household:` and the first 16 hex of its chat key (base64url).
 * @param {string} pubKey  the bot's chat agent's public key
 * @returns {string}
 */
export function householdCircleIdFor(pubKey) {
  if (typeof pubKey !== 'string' || pubKey.length < 11) throw new Error('householdCircleIdFor: the bot\'s key is required');
  // 11 base64url characters carry 66 bits: enough for the first 8 bytes
  let bits = 0n;
  for (const ch of pubKey.slice(0, 11)) {
    const v = B64URL.indexOf(ch);
    if (v < 0) throw new Error('householdCircleIdFor: not a base64url key');
    bits = (bits << 6n) | BigInt(v);
  }
  return `household:${(bits >> 2n).toString(16).padStart(16, '0')}`;
}

export const HOUSEHOLD_BOT_STORE_OPTS = Object.freeze({
  // a function of the bot's key: the agent calls it once its identity is up
  tasksCircleId: householdCircleIdFor,
  calendarInCircle: true,
  tasksInCircle: true,
});
