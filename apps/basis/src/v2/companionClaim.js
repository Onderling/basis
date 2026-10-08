/**
 * companionClaim — the string a companion prints when it waits for its owner, as the owner's app reads it.
 *
 * Started unclaimed, a companion prints `Claim: <CODE>@<its address>`; the owner pastes that (or just the part after
 * "Claim:") into their app, which signs the claim with this device's delegation key and hands it to the node. The
 * code alone is not enough: the app must know which node to ask. Shared by every shell.
 */

/** The outcomes of a claim, as the app words them (`circle.companionClaim.outcome_<outcome>`). */
export const COMPANION_CLAIM_OUTCOMES = Object.freeze([
  'ok', 'bad-claim', 'no-device-key', 'unreachable', 'already-owned', 'invalid-code', 'stale', 'unsigned',
]);

/**
 * Read a pasted claim: `ABCD-EFGH@<address>`, with or without the `Claim:` label, case and spaces as typed.
 * @param {string} text
 * @returns {{code: string, node: string}|null}
 */
export function parseCompanionClaim(text) {
  const s = String(text ?? '').trim().replace(/^claim:\s*/i, '');
  const m = /^([A-Za-z0-9]{4})\s*-?\s*([A-Za-z0-9]{4})\s*@\s*([A-Za-z0-9_-]{16,})\s*$/.exec(s);
  if (!m) return null;
  return { code: `${m[1].toUpperCase()}-${m[2].toUpperCase()}`, node: m[3] };
}
