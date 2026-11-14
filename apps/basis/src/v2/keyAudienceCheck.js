/**
 * THE KEY'S AUDIENCE FOLLOWS THE MEMBERSHIP (the audience check). Every change that adds someone to a sealed circle's
 * key asks the membership lane first; a REMOVAL that was lost (its rotation never written: a crash, a device offline, a
 * member another instance admitted and this one never knew) leaves its holder in the key file. This round finds such a
 * holder and takes it out. It runs on the KEY OWNER's device only (the producer that holds the circle's root), when the
 * producer starts and after each membership event the router handles.
 *
 * One round, revoke-only, fail-safe:
 *   - the controller key and this device's own key are always kept;
 *   - every other recipient is looked up in THIS device's grant notes (the producer's `keyHolders`: written only when
 *     this device's grant added that key, never re-attributed, removed by its revoke); a link proof does not bind a
 *     person, so an address on a roster row is not used to name a key's holder. A noted person whom the lane holds OUT
 *     (pinboard `memberStatus`) is revoked with a ban, AT MOST ONE per round (a revoke is a rotation), and the status is
 *     asked again inside the write (`stillOut`); in, cannot-place and unnoted ('unmapped', e.g. a holder another
 *     instance granted) are kept and counted;
 *   - if the read cannot answer, nothing is revoked this round, and the round says so;
 *   - a recipient-sealed (p3) circle is skipped OUT LOUD, once per circle per start: its outside grantees have no record
 *     to tell them from a lost removal.
 * The round's line carries counts only (no keys, no names): found, kept, revoked, unmapped, cannot-place.
 * Holders another instance granted stay unmapped until the link proof binds the person (its own row).
 */
import { log as structuredLog } from '@onderling/logger';
import { processRefusalLog } from './refusalLog.js';
import { memberStatusReader } from './circlePodProducer.js';

const skippedOutLoud = new Set();   // circles whose p3 skip was said this start

/**
 * @param {object} a
 * @param {string} a.circleId
 * @param {object} a.producer        the circle's producer (controlAgent, ownsRoot, controllerPublicKey, sealingIdentity, persist)
 * @param {string} a.storagePosture  'p2' is checked; 'p3' is skipped out loud; anything else is not sealed
 * @param {(circleId: string, webid: string) => Promise<'in'|'out'|null>} a.memberStatusOf  the lane's answer (pinboard memberStatus)
 * @param {{note: Function}} [a.refusals]
 * @param {{info: Function, warn: Function}} [a.log]
 * @returns {Promise<{checked: boolean, revoked: number, reason?: string, counts?: object}>}
 */
export async function checkKeyAudience({ circleId, producer, storagePosture, memberStatusOf, refusals = null, log = structuredLog } = {}) {
  const ca = producer?.controlAgent;
  if (!circleId || !ca || producer?.ownsRoot !== true) return { checked: false, revoked: 0, reason: 'not-the-key-owner' };
  if (storagePosture === 'p3') {
    if (!skippedOutLoud.has(circleId)) {
      skippedOutLoud.add(circleId);
      (refusals ?? processRefusalLog()).note({ tag: 'key', lane: 'key', check: 'audience', reason: 'audience-not-checked' });
    }
    return { checked: false, revoked: 0, reason: 'recipient-sealed' };
  }
  if (storagePosture !== 'p2') return { checked: false, revoked: 0, reason: 'not-group-key' };
  let cur = null;
  try { cur = await ca.keyStore?.read?.(); } catch { cur = null; }
  const recipients = Array.isArray(cur?.recipients) ? cur.recipients : [];
  if (!recipients.length) return { checked: false, revoked: 0, reason: 'no-key-file' };
  let own = null;
  try { own = (await producer.sealingIdentity?.publicKey?.()) ?? null; } catch { own = null; }
  const keep = new Set([producer.controllerPublicKey, own].filter(Boolean));
  const ask = recipients.filter((k) => !keep.has(k));
  const counts = { found: recipients.length, kept: recipients.length - ask.length, revoked: 0, unmapped: 0, cannotPlace: 0 };
  if (!ask.length) { log?.info?.('key', 'audience-round', counts); return { checked: true, revoked: 0, counts }; }
  // the person each key was granted for, by this device; a person asked once per round
  const notes = producer.keyHolders;
  const people = [...new Set(ask.map((k) => notes?.of?.(k)).filter(Boolean))];
  const status = new Map();
  try {
    for (const p of people) status.set(p, await memberStatusOf(circleId, p));
  } catch {
    log?.warn?.('key', 'audience-round-unread', { found: counts.found });
    return { checked: false, revoked: 0, reason: 'cannot-read' };
  }
  let toRevoke = null;
  for (const k of ask) {
    const person = notes?.of?.(k) ?? null;
    const st = person ? status.get(person) : null;
    if (!person) { counts.kept += 1; counts.unmapped += 1; continue; }
    if (st === 'out' && !toRevoke) { toRevoke = { key: k, person }; continue; }   // one rotation per round
    counts.kept += 1;
    if (st !== 'in' && st !== 'out') counts.cannotPlace += 1;
  }
  if (toRevoke) {
    try {
      const r = await ca.revokeRecipient({
        publicKey: toRevoke.key, policy: 'ban',
        // asked again on every compute of the write: a holder re-admitted since the read is not rotated out
        stillOut: async () => (await memberStatusOf(circleId, toRevoke.person)) === 'out',
      });
      if (r?.rotated) { counts.revoked = 1; await notes?.forget?.(toRevoke.key); await producer.persist?.(); }
      else counts.kept += 1;
    } catch (err) {
      counts.kept += 1;
      log?.warn?.('key', 'audience-revoke-failed', { code: String(err?.code ?? 'error') });
    }
  }
  log?.info?.('key', 'audience-round', counts);
  return { checked: true, revoked: counts.revoked, counts };
}

/**
 * One round for a circle, as a shell composes it: its producer, its posture, the read over the waist. The seam both
 * shells call after a producer's roster seed and that the router calls after each membership event it handles.
 */
export function runKeyAudienceCheck({ circleId, producer, callSkill }) {
  return checkKeyAudience({ circleId, producer, storagePosture: producer?.storagePosture, memberStatusOf: memberStatusReader(callSkill) })
    .catch(() => ({ checked: false, revoked: 0, reason: 'threw' }));
}
