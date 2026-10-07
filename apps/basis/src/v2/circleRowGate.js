/**
 * circleRowGate — a host's rule for running a planned row that lives in a CIRCLE's store.
 *
 * The row runs as `actsAs` only when (1) its author's signature verifies over what it does and as whom, (2) the roster
 * binds the signing key to the author (the host's own key counts for its own rows), (3) it acts as its author — or as
 * the household, when the host signed it itself, and then only to announce — and (4) THIS host may act for that person:
 * on a household bot, a person it is the device for (a bot user whose id, or linked Basis key, is the author). The
 * same answer says which of the host's people the row runs as.
 */
import { verifyIntention } from './intentionSignature.js';
import { HOUSEHOLD_ACTS_AS, ANNOUNCE_OP } from './announceRows.js';

/**
 * @param {object} a
 * @param {string} a.hostRef     this host's member ref (its chat key)
 * @param {(circleId: string) => Promise<{pubKey: string}|null>} a.circleKeyFor   this host's own circle key
 * @param {(b: {author: string, ref: string, circleId: string}) => Promise<boolean>} a.rosterBinding
 * @param {() => Promise<Array<{id: string, pubKey?: string}>>} a.people   the people this host acts for
 */
export function createCircleRowGate({ hostRef, circleKeyFor, rosterBinding, people }) {
  const bindingOk = async (b) => {
    if (b.ref === hostRef) {
      try { if ((await circleKeyFor(b.circleId))?.pubKey === b.author) return true; } catch { /* the roster answers */ }
    }
    return rosterBinding(b);
  };
  /** The person (this host's own id for them) a row acting as `actsAs` runs as, or null when it serves nobody by that name. */
  const callerFor = async (actsAs) => {
    if (!actsAs || actsAs === HOUSEHOLD_ACTS_AS) return null;
    const rows = (await people().catch(() => [])) ?? [];
    return rows.find((r) => r.id === actsAs || (r.pubKey && r.pubKey === actsAs))?.id ?? null;
  };
  return {
    callerFor,
    /** The runner's `mayRun`: true, or why not. */
    async mayRun(o, scope, row) {
      const v = await verifyIntention(row, {
        circleId: scope, bindingOk,
        actsAsAllowed: (actsAs, ref) => actsAs === ref || (actsAs === HOUSEHOLD_ACTS_AS && ref === hostRef),
      });
      if (v !== true) return v;
      if (row.actsAs === HOUSEHOLD_ACTS_AS) return row.op === ANNOUNCE_OP ? true : 'the household acts only to announce';
      return (await callerFor(row.actsAs)) ? true : 'not a person this host acts for';
    },
  };
}
