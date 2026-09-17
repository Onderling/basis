/**
 * pairCircleId — the one id two persons derive for their pair roster (`pairRoster.js`), kept as a leaf so the launcher
 * can hide pair circles without importing the create/join machinery.
 */
import { hashHex } from '@onderling/core';

export const PAIR_CIRCLE_PREFIX = 'pair-';

/** The one id both sides derive: the two webids sorted, hashed, 24 hex chars behind the prefix. */
export function pairCircleIdFor(webidA, webidB) {
  if (typeof webidA !== 'string' || !webidA || typeof webidB !== 'string' || !webidB) throw new Error('pairCircleIdFor: two webids required');
  if (webidA === webidB) throw new Error('pairCircleIdFor: a pair needs two different persons');
  const [lo, hi] = [webidA, webidB].sort();
  return PAIR_CIRCLE_PREFIX + hashHex(`onderling-pair-roster-v1|${lo}|${hi}`).slice(0, 24);
}
export function isPairCircleId(id) { return typeof id === 'string' && id.startsWith(PAIR_CIRCLE_PREFIX); }
/** Which of the two founds: the webid that sorts first. */
export function pairFounderOf(webidA, webidB) { return [webidA, webidB].sort()[0]; }

