/**
 * targetResolver.js — Pinboard V2 Phase 27.2 (2026-05-07).
 *
 * Pure functions: given a list of `Target` entries + the local
 * MemberMap + ContactBook, resolve to a Set of recipient WebIDs.
 * Used by:
 *   - Sender-side filter in `postRequest` (build the fan-out roster
 *     + drop muted + drop out-of-range).
 *   - Receiver-side check in `substrateMirror` / `contactFanout`
 *     (is THIS post addressed to me?).
 *
 * Target shapes (functional design § 4f):
 *
 *   {kind: 'group',     groupId}
 *   {kind: 'contacts',  minTrust: 'bekend' | 'vertrouwd'}
 *   {kind: 'tag',       tag: '<my-personal-label>'}
 *
 * The resolver is sender-perspective: when Anne posts targeting
 * `{kind: 'tag', tag: 'koor'}`, only HER contacts with that tag are
 * recipients.  The post envelope carries the tag verbatim so
 * receivers can verify they were *intended* recipients (not just
 * accidentally subscribed to a topic).
 */


const VALID_KINDS = new Set(['group', 'contacts', 'tag']);
const VALID_TRUST = new Set(['bekend', 'vertrouwd']);

/**
 * @typedef {object} Target
 * @property {'group'|'contacts'|'tag'} kind
 * @property {string} [groupId]   when kind === 'group'
 * @property {'bekend'|'vertrouwd'} [minTrust]   when kind === 'contacts'
 * @property {string} [tag]       when kind === 'tag'
 */

/** Validate a Target shape; returns null on success, error string otherwise. */
export function validateTarget(t) {
  if (!t || typeof t !== 'object') return 'target must be an object';
  if (!VALID_KINDS.has(t.kind)) return `unknown target kind '${t.kind}'`;
  if (t.kind === 'group'    && (typeof t.groupId !== 'string' || !t.groupId)) return 'group target needs groupId';
  if (t.kind === 'contacts' && !VALID_TRUST.has(t.minTrust)) return 'contacts target needs minTrust (bekend|vertrouwd)';
  if (t.kind === 'tag'      && (typeof t.tag !== 'string' || !t.tag)) return 'tag target needs tag';
  return null;
}

/**
 * Resolve a set of targets to a recipient WebID set, sender-side.
 *
 * @param {Target[]} targets
 * @param {object} ctx
 * @param {import('@onderling/identity-resolver').MemberMap} ctx.members
 * @param {object} [ctx.contacts]   ContactBook (optional — required when
 *                                  any target is contacts/tag/list)
 * @param {string} [ctx.selfWebid]  exclude self from the recipient set
 * @returns {Promise<{recipients: Set<string>, errors: string[]}>}
 */
export async function resolve(targets, { members, contacts, selfWebid } = {}) {
  const errors = [];
  const recipients = new Set();
  if (!Array.isArray(targets) || targets.length === 0) {
    return { recipients, errors: ['targets must be a non-empty array'] };
  }
  if (!members) return { recipients, errors: ['members (MemberMap) required'] };

  for (const t of targets) {
    const err = validateTarget(t);
    if (err) { errors.push(err); continue; }

    if (t.kind === 'group') {
      const all = await members.list();
      for (const m of all) {
        if (m.relation === 'group-member' && m.webid && m.webid !== selfWebid) {
          recipients.add(m.webid);
        }
      }
    }
    else if (t.kind === 'contacts') {
      if (!contacts) { errors.push('contacts target needs ContactBook'); continue; }
      const list = await contacts.listContactsByMinTrust(t.minTrust);
      for (const c of list) if (c.webid !== selfWebid) recipients.add(c.webid);
    }
    else if (t.kind === 'tag') {
      if (!contacts) { errors.push('tag target needs ContactBook'); continue; }
      const list = await contacts.listContactsByTag(t.tag);
      for (const c of list) if (c.webid !== selfWebid) recipients.add(c.webid);
    }
  }

  return { recipients, errors };
}

/**
 * Receiver-side check: am I (selfWebid) addressed by this post's
 * targets, given my MemberMap entry + contacts knowledge of the
 * sender?
 *
 * Uses the SENDER's perspective: the post carries the targets the
 * sender chose; we need to determine whether *we* satisfy any of
 * those targets *as the sender saw us*.  Since we don't know what
 * the sender's MemberMap said about us, we do the receiver-friendly
 * thing: match if any target *could* include us based on
 * conservatively-permissive assumptions.
 *
 * - 'group': we are addressed iff we are a member of `groupId`.
 *   The receiver knows their own groups via their MemberMap (via
 *   their own role in the group config); for the simple case we
 *   accept any 'group' target referencing a group we're in.
 * - 'contacts' / 'tag': the sender-side knows; receiver
 *   can't re-validate this without seeing the sender's data.  We
 *   accept iff the sender is in OUR ContactBook (some basis for
 *   trusting they targeted us specifically).
 *
 * @param {Target[]} targets
 * @param {object} ctx
 * @param {string} ctx.selfWebid     receiver's own WebID
 * @param {string|null} [ctx.senderWebid]
 * @param {string|null} [ctx.activeGroupId]   the group the receiver is in
 * @param {object} [ctx.contacts]    receiver's ContactBook
 * @returns {Promise<boolean>}
 */
export async function isAddressedToMe(targets, { selfWebid, senderWebid, activeGroupId, contacts } = {}) {
  if (!Array.isArray(targets) || targets.length === 0) return true;   // legacy posts (no targets) reach everyone
  for (const t of targets) {
    if (validateTarget(t)) continue;
    if (t.kind === 'group' && t.groupId === activeGroupId) return true;
    if (t.kind === 'contacts' || t.kind === 'tag') {
      // Conservative: accept iff sender is in our ContactBook.
      // (Receiver can't replay the sender's resolve(); good-enough
      // for V2. adds signed-target proofs.)
      if (!contacts || !senderWebid) continue;
      const all = await contacts.listContacts();
      if (all.some(c => c.webid === senderWebid)) return true;
    }
  }
  return false;
}

/**
 * Filter mute set out of a recipient set.  `mutedSet` may contain
 * webids and/or stableIds (Phase 11 dual-key).  We drop webids
 * directly + drop any webid whose MemberMap entry has a stableId
 * in the mute set.
 *
 * @param {Set<string>} recipients
 * @param {Set<string>} muted
 * @param {object} members
 * @returns {Promise<Set<string>>}
 */
export async function filterMuted(recipients, muted, members) {
  if (!muted || muted.size === 0) return recipients;
  const out = new Set();
  for (const w of recipients) {
    if (muted.has(w)) continue;
    const m = await members.resolveByWebid(w);
    if (m?.stableId && muted.has(m.stableId)) continue;
    out.add(w);
  }
  return out;
}
