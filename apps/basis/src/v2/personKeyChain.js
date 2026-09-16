/**
 * personKeyChain — a contact learns my CURRENT person key by PULLING the chain, never by being pushed it.
 *
 * Circles learn a member's person key root-revealed, per circle (the person-key statement). A contact who shares no
 * circle learns it from the card (the Hi between persons) and, after a rotation, by asking: "since version n, what
 * changed?" — answered with the chain of links from n up, each signed by the person's LINK KEY (root-derived, its seed
 * in hand only inside a ceremony — never by version n's seed, which a revoked device holds), verified at the asker's
 * end against the link key it PINNED from the card and from the version it already holds (core verifyPersonKeyChain).
 * Pushing a new key to a bare address would hand the rotation to whoever holds that address — a thief's relay
 * registration included — which is why a contact asks and verifies, and never takes a key on the wire's word. What
 * a thief on that address can still do is stay silent: the asker then keeps the version it has (stated window).
 *
 * When to ask: a direct message arrives sealed FROM a version newer than the one on record for that contact. Then the
 * next message to them can seal to their current key. A request is answered only for a CONTACT (the asker's address
 * is on the contact book, or shares a circle) — the chain is the person's cross-circle identity.
 */
export const PERSON_KEY_CHAIN_SUBTYPES = Object.freeze({ request: 'person-key-chain-request', reply: 'person-key-chain' });

/**
 * @param {object} a
 * @param {() => ({ current: { version: number, pubKey: string }, links: object[] } | null)} a.chain  my chain
 * @param {(addr: string) => Promise<boolean>} a.isContact  whether an address belongs to someone I know
 * @param {(webid: string) => Promise<{ version: number, pubKey: string } | null>} a.known  what I hold for a contact
 * @param {(webid: string, claimed: object, links: object[]) => Promise<object|null>} a.adopt  record (verified by the callee)
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer
 * @param {(info: object) => void} [a.onRefused]
 */
export function createPersonKeyChain({ chain, isContact, known, adopt, sendToPeer, onRefused = null } = {}) {
  for (const [k, v] of Object.entries({ chain, isContact, known, adopt, sendToPeer })) if (typeof v !== 'function') throw new Error(`personKeyChain: ${k} is required`);
  const refuse = (reason, from) => { try { onRefused?.({ reason, from }); } catch { /* observability never throws */ } };
  const asked = new Map();   // addr → last ask (ms), so a burst of sealed messages is one ask

  return {
    subtypes: PERSON_KEY_CHAIN_SUBTYPES,
    /** Ask a contact for the links since the version I hold. */
    async requestFrom(addr, sinceVersion = 0) {
      const last = asked.get(addr) ?? 0;
      if (Date.now() - last < 5_000) return { asked: false, reason: 'recently' };
      asked.set(addr, Date.now());
      try { await sendToPeer(addr, { subtype: PERSON_KEY_CHAIN_SUBTYPES.request, since: sinceVersion }, { guarantee: 'hold-forward' }); return { asked: true }; }
      catch (err) { return { asked: false, reason: err?.message ?? String(err) }; }
    },
    handlers: {
      [PERSON_KEY_CHAIN_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== PERSON_KEY_CHAIN_SUBTYPES.request) return;
        if (!(await isContact(fromAddr))) { refuse('not-a-contact', fromAddr); return; }
        const mine = chain();
        if (!mine?.current) return;
        const since = Number.isInteger(payload.since) ? payload.since : 0;
        const links = (mine.links ?? []).filter((l) => l && l.version > since);
        try { await sendToPeer(fromAddr, { subtype: PERSON_KEY_CHAIN_SUBTYPES.reply, current: mine.current, links }, { guarantee: 'hold-forward' }); }
        catch { /* the asker asks again on its next sealed message */ }
      },
      [PERSON_KEY_CHAIN_SUBTYPES.reply]: async (fromAddr, payload) => {
        if (payload?.subtype !== PERSON_KEY_CHAIN_SUBTYPES.reply) return;
        if (!(await isContact(fromAddr))) { refuse('not-a-contact', fromAddr); return; }
        const base = await known(fromAddr);
        if (!base) { refuse('no-known-version', fromAddr); return; }   // a chain needs a base; the card gives it
        try { await adopt(fromAddr, payload.current, Array.isArray(payload.links) ? payload.links : []); } catch { /* kept what was known */ }
      },
    },
  };
}
