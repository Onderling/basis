/**
 * shareRecipients — the SHARED (web≡mobile) selector behind the out-of-circle recipient picker
 * (objective L · Phase 2). It turns the Contacten roster rows (`peerToContactRow` / `stoopContactToRow`
 * from `contactsSource.js`) into the recipient rows the picker renders and `shareItemToPublishedKey`
 * targets — pure, no DOM/RN, imported by BOTH shells (invariants #1/#2).
 *
 * KEY SIMPLIFIER: a contact ALREADY carries the published Ed25519 network key on `peerAddr` (or `pubKey`)
 * — the native network address. That key IS exactly the `recipientNetworkKey` `shareItemToPublishedKey`
 * expects (it derives the recipient's sealing key from it). So a "pickable recipient" is simply a contact
 * that has a network key; the picker passes `row.recipientNetworkKey` straight through. No new contact
 * model, no network resolution.
 *
 * A contact WITHOUT a network key (a URL-only A2A bot, say) can't be granted an in-place key — it is
 * EXCLUDED (there is nothing to derive a sealing key from). `recipient` (the ACP grant subject / WebID)
 * defaults to the contact's stable id (`contactId`), which is the WebID for a stoop ContactBook person.
 */

/** The published network key carried on a roster row, or null. Accepts either field name. */
function networkKeyOf(contact) {
  return contact?.recipientNetworkKey ?? contact?.pubKey ?? contact?.peerAddr ?? null;
}

/**
 * Resolve an OUT-OF-CIRCLE recipient's SEALING public key from their WebID — the map a revoke needs to evict
 * exactly the named grantee instead of rotating to the roster and collaterally dropping the others (the
 * confirmed story-1.2 bug).
 *
 * It needs NO stored grant record. `shareToPublishedKey` derived the grantee's sealing key from their
 * published Ed25519 network key at grant time, and that derivation is PURE and deterministic — so re-deriving
 * it from the SAME contact reproduces exactly the key that was granted. The contact roster is the durable
 * source; nothing new has to be persisted or kept in sync.
 *
 * `deriveSealingKey` is INJECTED (`sealingPublicKeyFromNetworkKey` from `@onderling/pod-client`) so this module
 * stays pure and importable by `apps/basis-mobile`, which does not depend on pod-client. A recipient with no
 * contact (or a derivation that throws) yields null — the caller must then fail SAFE, never assume.
 *
 * @param {object} deps
 * @param {() => (Array<object>|Promise<Array<object>>)} deps.contacts  the Contacten roster (thunk — read live).
 * @param {(networkKey: string) => string} deps.deriveSealingKey       `sealingPublicKeyFromNetworkKey`.
 * @returns {(webid: string) => Promise<string|null>}
 */
export function recipientSealingKeyResolver({ contacts, deriveSealingKey } = {}) {
  return async function sealingKeyFor(webid) {
    if (!webid || typeof deriveSealingKey !== 'function') return null;
    let rows = [];
    try { rows = pickableRecipients(typeof contacts === 'function' ? await contacts() : contacts); }
    catch { return null; }
    const match = rows.find((r) => r.id === webid);
    if (!match) return null;
    try { return deriveSealingKey(match.recipientNetworkKey) || null; }
    catch { return null; }                                  // not a valid Ed25519 key → unresolvable, fail safe
  };
}

/**
 * The out-of-circle LINK warning (grants-over-Peer D7). Granting someone access by their published network
 * key is a deliberate 1:1 link: you are choosing to connect your circle-side identity to that external
 * identity, and BOTH sides can see it. That is legitimate and user-chosen — so this is informed consent,
 * NOT a block: nothing is prevented, the person is simply told before they pick.
 *
 * The RULE lives here (invariant #1) rather than in either shell: warn iff the pick would grant by network
 * key. Today every pickable row is network-key-granted by construction, but encoding the rule keeps it
 * correct if the picker later also admits roster-based (already-in-circle) recipients, which carry no new
 * link and must NOT warn.
 *
 * @param {Array<{recipientNetworkKey?: string}>} recipients  rows from `pickableRecipients`
 * @returns {{key: string}|null}  the locale key to render via `t()`, or null when nothing warrants a warning.
 */
export function outOfCircleLinkWarning(recipients = []) {
  const any = (Array.isArray(recipients) ? recipients : []).some((r) => !!networkKeyOf(r));
  return any ? { key: 'circle.share.link_warning' } : null;
}

/**
 * The pickable out-of-circle recipients: the contacts that carry a published network key, mapped to the
 * recipient rows the picker renders + `shareItemToPublishedKey` targets. De-duped by id (a contact merged
 * from two sources appears once). Contacts without a network key are dropped (nothing to grant a key to).
 *
 * @param {Array<object>} contacts  Contacten roster rows (from `contactsSource.js`)
 * @returns {Array<{id:string, name:string, recipientNetworkKey:string, trustLevel?:string}>}
 */
export function pickableRecipients(contacts = []) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c) continue;
    const recipientNetworkKey = networkKeyOf(c);
    if (!recipientNetworkKey) continue;                       // no network key → not grantable → excluded
    // The ACP grant subject: the WebID when the contact is a stoop ContactBook person (contactId === webid),
    // else the stable contact id (which, for a bare peer, IS the network key). Non-empty by construction.
    const id = c.contactId ?? c.id ?? recipientNetworkKey;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = { id, name: c.name ?? c.displayName ?? c.handle ?? id, recipientNetworkKey };
    // Light attestation seam (Phase-3 flavour): surface the contact's trust level when it carries one, so a
    // UI can badge it and a caller MAY gate the share with a `verify` predicate. Omitted when absent.
    if (c.trustLevel != null) row.trustLevel = c.trustLevel;
    out.push(row);
  }
  return out;
}
