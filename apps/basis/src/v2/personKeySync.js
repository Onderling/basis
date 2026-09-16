/**
 * personKeySync — a person's own devices hand each other the CURRENT person key.
 *
 * The person key rotates only in a ceremony (the phrase), which runs on ONE device. The others cannot derive
 * the new version — they never hold the root — so the ceremony hands them the seed: over the one sibling carry
 * (siblingCarry.js), to each surviving proven device address, after the revoked device's addresses were retired
 * in the same ceremony so it is no longer a sibling. The wire is the secure send, which seals every payload to the
 * recipient device's per-circle key; a revoked device holds its own keys, not a survivor's, and cannot open it.
 *
 * THE GATE IS THE ROOT, NOT THE SENDER'S ADDRESS. A hand-over carries the ceremony's reveal — the root's public key
 * plus its signature over (circle, this kind, the person, version, the key the seed derives) — one per circle the
 * person is in, and a receiver admits it when ONE reveal verifies against its own per-circle commitment
 * (identity/ceremonyCommitment.js), which every device of the person can compute from the root's public key. So
 * a hand-over is admitted from whichever address carried it, and refused from anyone who did not hold the phrase
 * at that moment: a revoked device cannot mint one (the same trust the root-revealed person-key statement has).
 * The sibling-address gate would have been weaker AND racy: the same ceremony retires addresses, and a survivor's
 * roster may fold that retire before its gate has read the hand-over's sender (measured 2026-09-16).
 *
 * A landed key is stored through the monotonic vault write (a lower version never lands) and takes effect at
 * once. A sibling offline during the ceremony gets it by hold-forward, or asks on connect
 * (`requestFromSiblings`, the same connect-time kick the grants lane and the known-peers sync have); the answer
 * carries the same reveals, kept beside the key.
 */
import { makeSiblingCarry } from './siblingCarry.js';
import { b64encode, b64decode, verifyCeremonyReveal, personKeyFacts, personKeyPubKeyB64 } from '@onderling/core';

export const PERSON_KEY_CARRY = 'device-person-key';
export const PERSON_KEY_CATCHUP_SUBTYPES = Object.freeze({ request: 'device-person-key-request' });

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings  the person's other proven device addresses
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer
 * @param {() => ({ version: number, seed: Uint8Array, reveals?: Object<string, object> } | null)} a.current  this device's
 *   current key, with the ceremony's reveals per circle when it was handed one (a re-derived key has none to pass on)
 * @param {(k: { version: number, seed: Uint8Array, reveals: Object<string, object> }) => Promise<boolean>} a.store  the
 *   monotonic write; true when it landed
 * @param {string} a.selfPubKey  the person (the profile's chat pubKey — the subject every reveal names)
 * @param {(circleId: string) => (string|null)} a.ownCommitmentFor  this person's ceremony commitment in a circle
 * @param {(info: { from: string, version: number }) => void} [a.onLanded]
 * @param {(reason: string, from: string) => void} [a.onRefused]
 */
export function createPersonKeySync({ siblings, sendToPeer, current, store, selfPubKey, ownCommitmentFor, onLanded = null, onRefused = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('personKeySync: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('personKeySync: `sendToPeer` is required');
  if (typeof current !== 'function') throw new Error('personKeySync: `current` is required');
  if (typeof store !== 'function') throw new Error('personKeySync: `store` is required');
  if (typeof selfPubKey !== 'string' || !selfPubKey) throw new Error('personKeySync: selfPubKey required');
  if (typeof ownCommitmentFor !== 'function') throw new Error('personKeySync: `ownCommitmentFor` is required');
  const refuse = (reason, from) => { try { onRefused?.(reason, from); } catch { /* observability never throws */ } };
  const { carry } = makeSiblingCarry({ siblings, sendToPeer, onWarn: (m) => console.warn(m.replace('[sibling-carry]', '[person-key]')) });

  async function fromOwnDevice(fromAddr) {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  }
  const wireOf = (k) => (k && k.reveals && Object.keys(k.reveals).length
    ? {
      subtype: PERSON_KEY_CARRY, version: k.version, seed: b64encode(k.seed), reveals: k.reveals,
      // the chain and the older seeds ride along: a survivor answers a contact's pull, and opens what was sealed to an older version
      links: Array.isArray(k.links) ? k.links : [],
      previous: (Array.isArray(k.previous) ? k.previous : []).map((p) => ({ version: p.version, seed: b64encode(p.seed) })),
      // the link key's PUBLIC half — a sibling builds cards and answers pulls with it; its seed never travels
      ...(typeof k.linkKeyPub === 'string' && k.linkKeyPub ? { linkKeyPub: k.linkKeyPub } : {}),
    }
    : null);
  const parse = (payload) => {
    if (!Number.isInteger(payload?.version) || payload.version < 1 || typeof payload?.seed !== 'string') return null;
    if (!payload.reveals || typeof payload.reveals !== 'object') return null;
    let seed = null;
    try { seed = b64decode(payload.seed); } catch { return null; }
    if (!(seed instanceof Uint8Array) || seed.length !== 32) return null;
    const previous = [];
    for (const p of Array.isArray(payload.previous) ? payload.previous : []) {
      try { const ps = b64decode(p.seed); if (Number.isInteger(p.version) && ps instanceof Uint8Array && ps.length === 32) previous.push({ version: p.version, seed: ps }); } catch { /* skip */ }
    }
    return {
      version: payload.version, seed, reveals: payload.reveals, links: Array.isArray(payload.links) ? payload.links : [], previous,
      ...(typeof payload.linkKeyPub === 'string' && payload.linkKeyPub ? { linkKeyPub: payload.linkKeyPub } : {}),
    };
  };
  /** ONE reveal that verifies against this person's own commitment in that circle admits the hand-over. */
  const rootSpoke = (k) => {
    let pubKey = null;
    try { pubKey = personKeyPubKeyB64(k.seed); } catch { return false; }
    const facts = personKeyFacts({ version: k.version, pubKey });
    for (const [circleId, reveal] of Object.entries(k.reveals)) {
      let commitment = null;
      try { commitment = ownCommitmentFor(circleId); } catch { commitment = null; }
      if (!commitment) continue;
      if (verifyCeremonyReveal(reveal, { circleId, kind: PERSON_KEY_CARRY, subject: selfPubKey, authorRef: selfPubKey, commitment, facts })) return true;
    }
    return false;
  };

  return {
    subtypes: { carry: PERSON_KEY_CARRY, ...PERSON_KEY_CATCHUP_SUBTYPES },

    /** The ceremony's act: hand the current key to every surviving sibling (best-effort; catch-up is the floor). */
    async carryCurrent({ exclude = [] } = {}) {
      const wire = wireOf(current());
      if (!wire) return { attempted: 0, skipped: 'no-key-or-no-reveals', outcomes: [] };
      return carry(wire, { exclude });
    },

    /** CATCH-UP: ask every sibling for its current key; any one answer at or above mine is enough. */
    async requestFromSiblings() {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { requested: 0 }; }
      let requested = 0;
      for (const addr of addrs) {
        try { await sendToPeer(addr, { subtype: PERSON_KEY_CATCHUP_SUBTYPES.request }, { guarantee: 'hold-forward' }); requested += 1; } catch { /* next sibling */ }
      }
      return { requested };
    },

    handlers: {
      [PERSON_KEY_CARRY]: async (fromAddr, payload) => {
        if (payload?.subtype !== PERSON_KEY_CARRY) return;
        const k = parse(payload);
        if (!k) { refuse('malformed', fromAddr); return; }
        if (!rootSpoke(k)) { refuse('no-root-reveal', fromAddr); return; }
        let landed = false;
        try { landed = await store(k); } catch { refuse('store-failed', fromAddr); return; }
        if (landed) { try { onLanded?.({ from: fromAddr, version: k.version }); } catch { /* observability never throws */ } }
      },
      [PERSON_KEY_CATCHUP_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== PERSON_KEY_CATCHUP_SUBTYPES.request) return;
        if (!(await fromOwnDevice(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        const wire = wireOf(current());
        if (!wire) return;
        try { await sendToPeer(fromAddr, wire, { guarantee: 'hold-forward' }); } catch { /* the asker retries on its next connect */ }
      },
    },
  };
}
