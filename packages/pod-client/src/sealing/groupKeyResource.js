// groupKeyResource.js — versioned group-key distribution for a shared (household) pod.
//
// A key resource carries the CURRENT group key (for one version) sealed to every current member in a single
// recipient-mode envelope — the multi-recipient envelope IS the distribution. It lives on the pod
// (e.g. `/.keys/group-vN.json`), so offline members learn keys by READING the pod (reconnect → read →
// unwrap with the local private key). No out-of-band push.
//
//   • grant (join)  = re-seal the SAME group key to +1 member, same version — O(1), the new member can
//                     read all content under this version. (Or rotate, if forward-join secrecy is wanted.)
//   • revoke (leave) = rotate to a NEW group key + a new version, sealed to the REMAINING members. Forward
//                     secrecy: the departed keep cached old-version ciphertext but can't read new content.
//
// ── HISTORIC-KEY RETENTION (Phase 3) ────────────────────────────────────────────────────────────────────
// On rotate we do NOT discard the outgoing version: it is APPENDED to a `history` array, each entry being
// THAT version's group key still wrapped to THAT version's recipient set. This lets a CURRENT recipient open
// content that was sealed under an OLDER key version (before a rotation they lived through) — WITHOUT
// weakening forward secrecy:
//   • Each version's envelope defines exactly who can unwrap that version's key = who was a recipient AT that
//     version. A recipient revoked at the V→V+1 rotation is ABSENT from V+1's envelope (current `sealed`) and
//     from every later one, so they cannot unwrap the V+1 key and cannot read content sealed under it. Retaining
//     V's envelope gives them only V's key — for V's (pre-revocation) content, which they were already entitled
//     to and could already open. Forward secrecy = "no access to content sealed AFTER revocation" is intact.
//   • Content is NOT tagged with its key version (see `sealWithGroupKey` — a group-key envelope is
//     `{v:2, gk:1, body}` with no version field). Version resolution is therefore by AUTHENTICATED TRIAL:
//     XSalsa20-Poly1305 (secretbox) is authenticated, so a wrong-version key throws on open and never yields a
//     false plaintext. `openSealedAcrossVersions` tries the reader's unwrappable versions newest-first; content
//     sealed under vN opens with the vN key and is rejected by every other version's key. This is deterministic
//     and correct; an explicit version tag would only save the O(versions) trial (see report / flagged option).
//
// Pure (no pod I/O): the control-agent (key-holder) reads/writes the resource; it owns the member roster
// (public keys), since the envelope stores only recipientIds, not the keys.

import { seal, open, generateGroupKey, isSealed, openWithGroupKey } from './envelope.js';

/** Build the key resource for `version`: the group key sealed to every current member's public key.
 *  `history` (optional) carries retained prior versions forward untouched — set only by grant/rotate. */
export function buildGroupKeyResource({ version = 1, groupKey, recipients, history } = {}) {
  const pubs = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean))];
  if (pubs.length === 0) throw new Error('buildGroupKeyResource: at least one recipient public key required');
  if (!groupKey) throw new Error('buildGroupKeyResource: groupKey required');
  // `recipients` (the public keys, additive) is retained so a later BAN can re-seal history to a precise
  // subset (recipients − departed). Pubkeys are public — storing them is not a secrecy leak.
  const res = { v: 1, version, members: pubs.length, recipients: pubs, sealed: seal(groupKey, pubs) };
  if (Array.isArray(history) && history.length) res.history = history;
  return res;
}

/** Unwrap the CURRENT-version group key from a resource with a member's private key. Throws if the caller is
 *  not a recipient of the current version. (For an older version use `unwrapGroupKeyVersion`.) */
export function unwrapGroupKey(resource, privateKey) {
  if (!resource || typeof resource.sealed !== 'string') throw new Error('unwrapGroupKey: invalid key resource');
  return open(resource.sealed, privateKey);
}

/** The current version's envelope + every retained historic one, as `{version, sealed}`, newest-first.
 *  A history entry may carry `extra` — SUPPLEMENTARY single-recipient envelopes wrapping the SAME version's
 *  group key to a recipient granted historic access AFTER the fact (see grantMember `includeHistory`). Each is
 *  yielded as its own `{version, sealed}`, so a reader holding only an `extra` envelope's key still resolves
 *  that version. The original `entry.sealed` is left untouched (its recipients are never dropped). */
function versionEnvelopes(resource) {
  if (!resource || typeof resource.sealed !== 'string') return [];
  const hist = Array.isArray(resource.history) ? resource.history : [];
  const out = [{ version: resource.version, sealed: resource.sealed }];
  for (const h of [...hist].reverse()) {
    if (!h || typeof h.sealed !== 'string') continue;
    out.push({ version: h.version, sealed: h.sealed });
    for (const ex of (Array.isArray(h.extra) ? h.extra : [])) {
      if (typeof ex === 'string') out.push({ version: h.version, sealed: ex });
    }
  }
  return out;
}

/** Unwrap a SPECIFIC version's group key. Gated on membership of THAT version: `open` throws
 *  'not a recipient' if the caller was not a recipient of the requested version's envelope. `version`
 *  defaults to the current version (identical to `unwrapGroupKey`). Throws if the version isn't retained. */
export function unwrapGroupKeyVersion(resource, privateKey, version) {
  if (!resource || typeof resource.sealed !== 'string') throw new Error('unwrapGroupKeyVersion: invalid key resource');
  if (version == null || version === resource.version) return open(resource.sealed, privateKey);
  // EVERY row at that version, not the first. Since two admins can rotate to the same version at once
  // (`keyEventsLog.js`), a version may be retained more than once — with different keys. `.find` took whichever
  // row happened to be first and never tried the second, so content sealed under the other key read as "not a
  // recipient". Same trial-before-throw shape as the `extra` envelopes below, one level out.
  const entries = (Array.isArray(resource.history) ? resource.history : [])
    .filter((h) => h && h.version === version && typeof h.sealed === 'string');
  if (entries.length === 0) throw new Error(`unwrapGroupKeyVersion: version ${version} is not retained`);
  let last = null;
  for (const entry of entries) {
    // The primary envelope first, then any `extra` supplementary envelope (a post-hoc historic grant).
    try { return open(entry.sealed, privateKey); }
    catch (e) {
      last = e;
      for (const ex of (Array.isArray(entry.extra) ? entry.extra : [])) {
        try { return open(ex, privateKey); } catch { /* not this extra either */ }
      }
    }
  }
  throw last;   // not a recipient of the primary OR any extra envelope of any row at this version
}

/** Every group-key version the caller CAN unwrap (current + retained history), as `{version, groupKey}`,
 *  newest-first. A version the caller is NOT a recipient of is silently skipped — so the returned set is
 *  exactly the caller's entitlement (a revoked recipient gets only the pre-revocation versions they held). */
export function readableGroupKeys(resource, privateKey) {
  const out = [];
  for (const env of versionEnvelopes(resource)) {
    try { out.push({ version: env.version, groupKey: open(env.sealed, privateKey) }); }
    catch { /* not a recipient of this version — omit it */ }
  }
  return out;
}

/** Open a group-key-sealed item across retained versions, resolving the version by AUTHENTICATED TRIAL.
 *  Tries the caller's unwrappable keys newest-first; the secretbox auth tag guarantees only the key the
 *  content was sealed under succeeds (any other version throws). Returns plaintext, or throws if no version
 *  the caller holds opens it — which is exactly the forward-secrecy denial for post-revocation content.
 *  Non-sealed text passes through unchanged (mirrors `open`/`openWithGroupKey`). */
export function openSealedAcrossVersions(sealedText, resource, privateKey) {
  if (!isSealed(sealedText)) return sealedText;
  const keys = readableGroupKeys(resource, privateKey);
  if (keys.length === 0) throw new Error('openSealedAcrossVersions: caller holds no group-key version for this resource');
  for (const { groupKey } of keys) {
    try { return openWithGroupKey(sealedText, groupKey); } catch { /* wrong version — try the next */ }
  }
  throw new Error('openSealedAcrossVersions: no retained group-key version the caller holds opens this content');
}

/** grant — add a member to the CURRENT version: a current holder unwraps the group key and re-seals the
 *  SAME key to the expanded roster (same version). `currentRecipients` = the roster's public keys.
 *
 *  Retained history is, BY DEFAULT, carried forward UNTOUCHED — a new member gets the current version only,
 *  never retroactive access to historic (pre-join) versions (the conservative "normal new member" default).
 *
 *  `includeHistory` OPT-IN (default false) — ALSO grant the new recipient the retained historic versions.
 *  For every history entry the GRANTER can unwrap, a SUPPLEMENTARY single-recipient envelope wrapping THAT
 *  version's group key to `newRecipient` is appended to the entry's `extra[]`. The entry's original `sealed`
 *  is never rewritten, so no existing recipient is dropped and forward secrecy is untouched — this only ADDS
 *  the explicitly-opted-in recipient to past versions. History entries the granter cannot unwrap are left
 *  as-is (an honest limitation: the granter can only re-wrap versions it was itself a recipient of; historic
 *  recipient PUBLIC keys are not retained in the resource, only the group key is recoverable per version). */
export function grantMember(resource, { newRecipient, granterPrivateKey, currentRecipients, includeHistory = false }) {
  if (!newRecipient) throw new Error('grantMember: newRecipient public key required');
  const groupKey = unwrapGroupKey(resource, granterPrivateKey);
  const recipients = [...(currentRecipients || []), newRecipient];
  let history = resource.history;
  if (includeHistory && Array.isArray(history) && history.length) {
    history = history.map((h) => {
      if (!h || typeof h.sealed !== 'string') return h;
      let vgk;
      try { vgk = open(h.sealed, granterPrivateKey); }   // this version's group key, if the granter held it
      catch { return h; }                                // granter not a recipient of this version → leave it
      return { ...h, extra: [...(Array.isArray(h.extra) ? h.extra : []), seal(vgk, [newRecipient])] };
    });
  }
  return buildGroupKeyResource({ version: resource.version, groupKey, recipients, history });
}

/** revoke / rotate — a NEW group key + version, sealed to the given roster (omit the departed member to
 *  revoke). The OUTGOING version is APPENDED to `history` (retained, still wrapped to its own recipients) so
 *  remaining recipients can still open pre-rotation content; the revoked recipient — absent from the new
 *  version — cannot open content sealed under it (forward secrecy). `previous` supplies the version to
 *  increment AND the history to extend; pass `null` for a fresh v1 (no history). */
export function rotateGroupKeyResource({ previous = null, recipients, groupKey } = {}) {
  const prev = previous && Number.isInteger(previous.version) ? previous.version : 0;
  let history;
  if (previous && typeof previous.sealed === 'string') {
    const prior = Array.isArray(previous.history) ? previous.history : [];
    // Carry the outgoing version's `recipients` forward so a later BAN can re-seal it precisely.
    history = [...prior, { version: previous.version, members: previous.members, recipients: previous.recipients ?? null, sealed: previous.sealed }];
  }
  return buildGroupKeyResource({ version: prev + 1, groupKey: groupKey || generateGroupKey(), recipients, history });
}

/**
 * BAN re-wrap — re-seal every retained history version to EXCLUDE `excludePubKey`, so a banned member can no
 * longer obtain ANY server-side old-version key (the maximal / "ban" revocation, vs the default "graceful"
 * removal that leaves history intact so the departed keeps what they already had). Remaining recipients keep
 * their access. The controller is always a recipient of every version, so it can unwrap + re-seal each. A
 * history entry with no retained `recipients` (legacy resources) is left untouched — an honest limitation.
 * `extra[]` supplementary envelopes are dropped (one could otherwise re-admit the departed).
 */
export function banFromHistory(resource, { excludePubKey, controllerPrivateKey } = {}) {
  if (!resource || !Array.isArray(resource.history) || resource.history.length === 0) return resource;
  if (!excludePubKey || !controllerPrivateKey) return resource;
  const history = resource.history.map((h) => {
    if (!h || typeof h.sealed !== 'string' || !Array.isArray(h.recipients)) return h; // legacy → can't re-seal precisely
    const remaining = h.recipients.filter((r) => r !== excludePubKey);
    if (remaining.length === h.recipients.length) return h;   // departed wasn't in this version
    if (remaining.length === 0) return null;                  // no one left → drop the version
    let vgk;
    try { vgk = open(h.sealed, controllerPrivateKey); } catch { return h; }   // controller can't unwrap → leave as-is
    return { version: h.version, members: remaining.length, recipients: remaining, sealed: seal(vgk, remaining) };
  }).filter(Boolean);
  const out = { ...resource };
  if (history.length) out.history = history; else delete out.history;
  return out;
}
