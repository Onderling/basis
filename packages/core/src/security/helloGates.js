/**
 * helloGates.js — ready-made hello-gate predicates.
 *
 * A hello gate is an async function `(envelope) => boolean`. `handleHello`
 * consults the gate before registering the sender's key or sending an ack;
 * on `false` (or thrown error) the HI is silently dropped, so the sender's
 * `sendHello` times out with no way to tell whether we're online but
 * refusing them vs genuinely absent.
 *
 * Install one via `agent.setHelloGate(fn)`. No gate set = accept all
 * (preserves historical behaviour; backward-compatible).
 *
 * See Design-v3 "layered hello" proposal and CODING-PLAN.md Group W.
 */

/**
 * Pre-shared-secret gate.
 *
 * Accepts if `envelope.payload.authToken === secret`.
 *
 * @param {string} secret
 */
export function tokenGate(secret) {
  if (typeof secret !== 'string' || !secret.length) {
    throw new Error('tokenGate requires a non-empty string secret');
  }
  return async function tokenGateFn(envelope) {
    return envelope?.payload?.authToken === secret;
  };
}

/**
 * Group-membership gate.
 *
 * Expects `envelope.payload.authToken` to be a GroupProof (as minted by
 * `GroupManager.issueProof`). Accepts if that proof is valid and belongs
 * to one of `groupIds`.
 *
 * @param {string[]} groupIds
 * @param {import('../permissions/GroupManager.js').GroupManager} groupManager
 */
export function groupGate(groupIds, groupManager) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    throw new Error('groupGate requires a non-empty groupIds array');
  }
  if (!groupManager) {
    throw new Error('groupGate requires a GroupManager');
  }

  return async function groupGateFn(envelope) {
    const proof = envelope?.payload?.authToken;
    if (!proof || typeof proof !== 'object') return false;

    for (const gid of groupIds) {
      try {
        if (await groupManager.verifyProof?.(proof, gid)) return true;
      } catch {
        // verifyProof throwing → fail closed for that group, try next
      }
    }
    return false;
  };
}

/**
 * First-contact RATE bound — caps how fast NEW (not-yet-known) senders can register via hello, so a flood of
 * stranger HIs on a local transport cannot grow the peer graph unboundedly. This bounds a RESOURCE, it is not
 * an authorization gate (who-may-send binds at the receive-path roster-authorize + seal). Composed AND-wise
 * into the always-on stack beside mute-block.
 *
 * A KNOWN peer re-helloing ALWAYS passes — the bound only limits NEW registrations. `isKnown(from)` must read
 * the PEER GRAPH (not the key store): the SecurityLayer auto-registers the HI key BEFORE the gate runs, so a
 * key-store check would see every first contact as already-known and the bound would never engage. A sliding
 * window (`windowMs`) of accepted new-sender hellos is kept; once `maxPerWindow` is reached, further NEW
 * senders are dropped until the window drains. Defaults are generous (normal pairing is 1–2): a flood is 100s.
 *
 * @param {object} a
 * @param {(from:string)=>(boolean|Promise<boolean>)} a.isKnown  true ⇒ already-known peer ⇒ always accept.
 * @param {number} [a.maxPerWindow=32]  max NEW-sender hellos accepted per window.
 * @param {number} [a.windowMs=60000]   the sliding window.
 * @param {()=>number} [a.now=Date.now]
 */
export function firstContactRateGate({ isKnown, maxPerWindow = 32, windowMs = 60_000, now = () => Date.now() } = {}) {
  if (typeof isKnown !== 'function') {
    throw new Error('firstContactRateGate requires an isKnown(from) => boolean|Promise<boolean> predicate');
  }
  const stamps = [];   // timestamps of accepted NEW-sender hellos still inside the window
  return async function firstContactRateGateFn(envelope) {
    const from = envelope?._from;
    try { if (from && (await isKnown(from))) return true; } catch { /* unresolvable ⇒ treat as new */ }
    const t = now();
    while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
    if (stamps.length >= maxPerWindow) return false;    // a flood of new-sender hellos — bound it
    stamps.push(t);
    return true;
  };
}

/**
 * Composition helper — passes if any of the inner gates passes.
 * Short-circuits on the first accept.
 *
 * @param {...((envelope: object) => boolean | Promise<boolean>)} gates
 */
export function anyOf(...gates) {
  return async function anyOfFn(envelope) {
    for (const g of gates) {
      try {
        if (await g(envelope)) return true;
      } catch {
        // One sub-gate throwing doesn't disqualify the composition.
      }
    }
    return false;
  };
}
