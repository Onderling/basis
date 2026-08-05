/**
 * sharedRefPolicy — the injectable ENFORCEMENT surface for the cross-circle read.
 *
 * `resolveSharedRef` (shareIntoAudience.js) resolves a `shared-ref` back to its source item — the read
 * that CROSSES circles. On the in-memory substrate that read is unguarded (there is no real pod to gate
 * against). On a real pod the source item lives behind ACP/WAC and, if confidential, inside a sealed
 * envelope. This module is the seam that lets `resolveSharedRef` ENFORCE that posture WITHOUT item-store
 * taking a hard dependency on `@onderling/pod-client`: the pod-layer surfaces (`client.sharing`, sealing
 * `open`) are INJECTED; this file only adapts their shapes to a tiny policy contract.
 *
 * The policy contract:
 *   {
 *     // Deny-by-default grant gate. Return truthy to allow the read; falsy/throw ⇒ resolveSharedRef → null.
 *     checkGrant?: ({ ref, recipient, stores }) => boolean | Promise<boolean>,
 *     // Transform the resolved source item → readable item (unseal). Return the item unchanged when
 *     //   there is nothing to open. Throw ⇒ deny (don't leak ciphertext).
 *     open?: (item, { ref, recipient }) => object | Promise<object>,
 *   }
 *
 * Two builders ship here:
 *   • makeSharedRefPolicy — pod-backed: verifies a real ACP/WAC read grant via an injected `sharing`
 *     surface (the `client.sharing.list` shape) and unseals via an injected `open` (the sealing/`open`
 *     shape). No import of pod-client — the surfaces are passed in.
 *   • makePosturePolicy — memory substrate: enforces the ALREADY-MODELED posture floor (the recipient
 *     circle's confidentiality must meet the ref's `posture`). Testable without a live pod.
 */

/**
 * The share postures the substrate recognizes — the confidentiality/exposure policy a circle applies when an
 * item is shared OUT of it (admin-set, per-circle). The first four are shipped:
 *   • `closed`     — external sharing off.
 *   • `copy`       — a fresh sealed COPY is written into the recipient circle (source untouched).
 *   • `trusted`    — copy mechanism; differs only in WHO MAY INITIATE (a member).
 *   • `registered` — copy mechanism; admins-only initiation.
 * and `canonical` is objective L (the deferred "revocable canonical"): NO copy — the item stays canonical in
 * its origin circle and the recipient gets a REVOCABLE KEY GRANT to open it IN PLACE (see
 * `@onderling/pod-client`'s `createCanonicalShare`: grantMember + ACP grant to share, rotateGroupKeyResource +
 * ACP revoke to deny). Enum-only here; the app's circle-policy mirrors this list for its settings surface.
 */
export const SHARE_POSTURES = Object.freeze(['closed', 'copy', 'trusted', 'registered', 'canonical']);

/**
 * True when a posture shares the CANONICAL item in place (grant, not copy) — objective L. Under this posture
 * `shareIntoAudience` writes ONLY the pointer `shared-ref` into the recipient circle (never a duplicated
 * item), and the recipient reads the origin resource through the shared-ref path; access is the revocable
 * key grant. Complement of the copy-reseal postures (`copy` / `trusted` / `registered`).
 */
export const isCanonicalPosture = (p) => p === 'canonical';

/**
 * Walk an item's own string fields and run each through `openText`. `openText` (the sealing/`open` shape)
 * passes non-sealed text through unchanged, so this is safe to run over every string field — plaintext
 * stays plaintext, only sealed envelopes are opened. Returns a NEW item (never mutates the stored one).
 *
 * @param {object} item
 * @param {(text:string)=>string|Promise<string>} openText
 */
export async function unsealItem(item, openText) {
  if (!item || typeof item !== 'object' || typeof openText !== 'function') return item;
  const out = { ...item };
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === 'string') out[k] = await openText(v);
  }
  return out;
}

/**
 * Structural/identity keys that must stay PLAINTEXT when a re-seal walks an item (they drive listing,
 * attribution and shared-ref resolution — `type` feeds `listByType`, `id` is the resource key). Sealing
 * them would make an item unlistable / unresolvable in its own circle. Everything else (the user CONTENT,
 * e.g. `text`/`body`/`title`) is what a recipient re-seal actually needs to protect.
 */
export const SEAL_RESERVED_KEYS = Object.freeze(new Set([
  'id', 'type', 'posture', 'status', 'role',
  'sourceCircle', 'sourceId', 'sourceType', 'sharedBy', 'sharedCopyOf',
  'createdBy', 'addedBy', 'by', 'audience', 'visibility',
]));

/**
 * WRITE-SIDE symmetric companion to `unsealItem` — walk an item's own CONTENT string fields and run each
 * through `sealText` (a per-string sealer, e.g. the injected `recipientStrategy({recipients}).seal`), leaving
 * the reserved structural keys (`SEAL_RESERVED_KEYS`) untouched so the item stays listable/attributable.
 * Returns a NEW item (never mutates the stored one). The crypto is INJECTED — item-store never imports
 * `@onderling/pod-client` (invariant #5); `sealText` carries the recipient public keys in its closure.
 *
 * Read-side symmetry: `unsealItem(item, open)` opens EVERY string field, and a non-sealed field passes
 * through `open` unchanged — so sealing only the content fields here round-trips cleanly (the reserved
 * plaintext keys pass straight through the reader's `open`).
 *
 * @param {object} item
 * @param {(text:string)=>string|Promise<string>} sealText
 * @param {{reserved?:Set<string>}} [opts]
 */
export async function sealItem(item, sealText, { reserved = SEAL_RESERVED_KEYS } = {}) {
  if (!item || typeof item !== 'object' || typeof sealText !== 'function') return item;
  const out = { ...item };
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === 'string' && v.length > 0 && !reserved.has(k)) out[k] = await sealText(v);
  }
  return out;
}

/**
 * Pod-backed enforcement policy. Adapts the injected pod-layer surfaces to the policy contract.
 *
 * @param {object} opts
 * @param {{ list:(o:object)=>Promise<Array<{subject:string,agent?:string,modes:string[]}>> }} opts.sharing
 *        the `client.sharing` surface. We call `sharing.list({ resourceUri, agentsToQuery })`
 *        and require a `read` grant for the recipient (or a public read grant).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  the sealing/`open` shape — opens a sealed
 *        envelope with the reader's key; passes plaintext through. Omit to skip unsealing.
 * @param {string} [opts.recipient]  the WebID/agent asking to read (default recipient for checkGrant).
 * @param {(ref:object, ctx:{stores:object})=>(string|null)} [opts.resourceUriFor]  maps a `shared-ref` to
 *        the source item's pod resource URI (the ACP-controlled target). Defaults to a logical
 *        `sourceCircle/sourceId` — a real pod MUST inject the true storage-layout URI (that derivation is
 *        the pod-storage-tier's job; see the boundary note in the K report).
 * @param {string} [opts.mode='read']  the access mode a grant must include to allow the read.
 * @returns {{ checkGrant: Function, open?: Function }}
 */
export function makeSharedRefPolicy({ sharing, open, recipient, resourceUriFor, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.list !== 'function') {
    throw new Error('makeSharedRefPolicy: a { list } sharing surface (client.sharing) is required');
  }
  const uriFor = typeof resourceUriFor === 'function'
    ? resourceUriFor
    : (ref) => (ref && ref.sourceCircle && ref.sourceId ? `${ref.sourceCircle}/${ref.sourceId}` : null);

  return {
    async checkGrant({ ref, recipient: who = recipient, stores } = {}) {
      // Deny-by-default: no recipient identity to check a grant for ⇒ deny.
      if (!who) return false;
      const resourceUri = uriFor(ref, { stores });
      if (!resourceUri) return false;
      const grants = await sharing.list({ resourceUri, agentsToQuery: [who] });
      if (!Array.isArray(grants)) return false;
      // Allow when the source circle granted this recipient (or the public) the required mode.
      return grants.some((g) =>
        Array.isArray(g?.modes) && g.modes.includes(mode) &&
        (g.subject === 'public' || g.agent === who));
    },
    // `open` is item-level (walks every string field). `openText` exposes the RAW per-text opener so a
    // caller (e.g. slice-3b's `composeReaderOpen`) can combine it with the reader's own per-text opener at
    // the field level — both throw on a foreign sealed field, so the combination stays deny-by-default.
    ...(typeof open === 'function'
      ? { open: (item) => unsealItem(item, open), openText: open }
      : {}),
  };
}

/**
 * WRITE-SIDE companion to `makeSharedRefPolicy` — the injectable grant(+seal) hook a SHARE performs on a
 * pod-backed store. `shareIntoAudience` writes the `shared-ref` (memory op, unchanged) and then, if an
 * `onShare` hook is injected, calls it so the pod layer can make the read ACTUALLY possible: create the
 * ACP read-grant for the recipient on the SOURCE item's resource, and (optionally) re-seal so the recipient
 * can open the envelope. No `@onderling/pod-client` import — the `sharing.grant` + `seal` surfaces are passed in
 * (mirroring how the read policy injects `sharing.list` + `open`).
 *
 * Symmetry with the read gate: the read gate (`makeSharedRefPolicy.checkGrant`) asks "does recipient have a
 * read grant on `resourceUriFor(ref)`?"; this hook is what PUTS that grant there. Same `resourceUriFor`, same
 * `mode` ⇒ a share made by this hook resolves through that gate, and only that recipient's.
 *
 * @param {object} opts
 * @param {{ grant:(o:object)=>Promise<any> }} opts.sharing  the `client.sharing` surface — we call
 *        `sharing.grant({ resourceUri, agent, modes })` once per recipient.
 * @param {(ref:object)=>(string|null)} [opts.resourceUriFor]  maps a `shared-ref` → the source item's pod
 *        resource URI (the ACP target). Defaults to the logical `sourceCircle/sourceId` (a real pod injects
 *        the storage-layout URI from `@onderling/pod-onboarding`'s `sharedRefResourceUri`).
 * @param {string} [opts.mode='read']  the access mode to grant.
 * @param {(item:object, ctx:{recipient:string, recipients:string[], recipientKeys:string[], ref:object})=>object|Promise<object>} [opts.seal]
 *        optional re-seal step. In the group-key posture the recipient already holds the key so no re-seal is
 *        needed (omit); in the recipient-wrap posture, inject a `seal` (e.g. built from
 *        `recipientStrategy({recipients}).seal` via `sealItem`) that returns the item re-sealed to the
 *        recipient(s), and it is written back to the source store so the recipient can open it at rest. The
 *        recipients' SEALING PUBLIC KEYS arrive as `recipientKeys` (resolved by the share op against the
 *        TARGET circle's roster —), so the seal wraps to keys, not WebIDs. Deny-by-default: a seal
 *        that needs keys but gets none should throw ⇒ the share fails.
 * @returns {(ctx:{ref:object, item:object, recipient?:string, recipients?:string[], recipientKeys?:string[], stores:object})=>Promise<void>}
 */
export function makeShareGrantHook({ sharing, resourceUriFor, mode = 'read', seal } = {}) {
  if (!sharing || typeof sharing.grant !== 'function') {
    throw new Error('makeShareGrantHook: a { grant } sharing surface (client.sharing) is required');
  }
  const uriFor = typeof resourceUriFor === 'function'
    ? resourceUriFor
    : (ref) => (ref && ref.sourceCircle && ref.sourceId ? `${ref.sourceCircle}/${ref.sourceId}` : null);

  return async function onShare({ ref, item, recipient, recipients, recipientKeys, stores } = {}) {
    const resourceUri = uriFor(ref);
    if (!resourceUri) throw new Error('makeShareGrantHook: no resource URI for the shared-ref');

    // Who gets the read grant. A circle share resolves to one or more recipient WebIDs at the composition
    // layer (via @onderling/circles) and passes them in; deny-by-default: no recipient ⇒ refuse the share.
    const who = Array.isArray(recipients) && recipients.length ? recipients
      : (recipient ? [recipient] : []);
    if (who.length === 0) throw new Error('makeShareGrantHook: at least one recipient is required to grant');

    for (const agent of who) {
      await sharing.grant({ resourceUri, agent, modes: [mode] });
    }

    // Optional re-seal so the (new) recipient can open the envelope at rest. Group-key postures skip this
    // (recipient already holds the key via the roster). The recipients' SEALING PUBLIC KEYS (,
    // resolved by the share op against the TARGET circle's roster) arrive as `recipientKeys` and are handed
    // to the injected `seal` so it wraps to keys, not WebIDs.
    if (typeof seal === 'function' && item && ref && stores && typeof stores.getStore === 'function') {
      const keys = Array.isArray(recipientKeys) ? recipientKeys.filter(Boolean) : [];
      const sealed = await seal(item, { recipient: who[0], recipients: who, recipientKeys: keys, ref });
      if (sealed && sealed !== item) {
        await stores.getStore(ref.sourceCircle).put({ ...sealed, id: ref.sourceId });
      }
    }
  };
}

/**
 * CANONICAL share hook (objective L) — the WRITE-side companion for the `canonical` posture. Where
 * `makeShareGrantHook` grants a plain ACP read and (optionally) re-seals a COPY, this instead composes the
 * injected `createCanonicalShare` controller (`@onderling/pod-client`) so a share GRANTS the recipient INTO the
 * item's group-key resource (`grantMember` → O(1) key re-wrap) AND lands the ACP read grant — NO copy is
 * written; `shareIntoAudience` still writes ONLY the `shared-ref` pointer. The recipient then opens the
 * CANONICAL resource in place. `revoke` rotates the group key to the remaining recipients + ACP-revokes.
 *
 * No `@onderling/pod-client` import here: the `canonicalShare` controller (with `share`/`revoke`) is INJECTED,
 * exactly as `sharing`/`seal` are injected for the copy postures. item-store only orchestrates the per-
 * recipient loop and the roster bookkeeping the substrate's `grantMember`/`rotate` require.
 *
 * @param {object} opts
 * @param {{ share:Function, revoke:Function }} opts.canonicalShare  a `createCanonicalShare(...)` controller.
 * @param {string[]|(()=>string[]|Promise<string[]>)} [opts.currentRecipients]  the EXISTING roster's sealing
 *        PUBLIC KEYS (the origin circle's members already holding the group key). Passed to `grantMember` so a
 *        grant re-wraps the SAME key to the roster PLUS the new recipient — omitting it would drop the origin
 *        members from the resource. A thunk is resolved at share time (the live roster). Default: none.
 *        ALSO the revoke-side FALLBACK when no `revokeRecipients` is given — so it must NOT include anyone revocable.
 * @param {string[]|(()=>string[]|Promise<string[]>)} [opts.grantRecipients]  GRANT-side base, when it should be
 *        WIDER than the roster: "everyone who currently holds this item's key" (roster ∪ the key resource's own
 *        `recipients`), so an earlier out-of-circle grantee survives a later grant. Defaults to
 *        `currentRecipients`.
 * @param {(revokeeWebids: string[]) => (string[]|Promise<string[]>)} [opts.revokeRecipients]  REVOKE-side base:
 *        given the WebIDs being revoked, return the sealing keys that should KEEP the key — i.e. every current
 *        holder MINUS the revokee(s). Lets a revoke evict exactly the named party instead of rotating to the
 *        roster and collaterally evicting unrelated out-of-circle grantees. Absent → `currentRecipients`.
 * @returns {{ onShare: Function, revoke: Function }}
 */
export function makeCanonicalShareHook({ canonicalShare, currentRecipients, grantRecipients, revokeRecipients, revokedKeysFor } = {}) {
  if (!canonicalShare || typeof canonicalShare.share !== 'function' || typeof canonicalShare.revoke !== 'function') {
    throw new Error('makeCanonicalShareHook: a canonicalShare with { share, revoke } is required');
  }
  const resolveKeys = async (src, arg) => {
    const base = typeof src === 'function' ? await src(arg) : src;
    return Array.isArray(base) ? base.filter(Boolean) : [];
  };
  const rosterKeys = () => resolveKeys(currentRecipients);
  // GRANT-side base — defaults to the roster, but a caller may widen it to "everyone who currently holds this
  // item's key" (roster ∪ the key resource's own recipients) so an EARLIER out-of-circle grantee isn't dropped
  // when a LATER one is granted (grantMember REPLACES the recipient set).
  const grantBaseKeys = () => resolveKeys(grantRecipients ?? currentRecipients);
  // REVOKE-side base — "everyone who currently holds the key, MINUS the party being revoked". It takes the
  // revokee WebIDs because that subtraction needs a WebID→sealing-key resolution the caller owns; a widened
  // base without the subtraction would rotate the key back TO the revokee (a silent-revocation hole), so the
  // two must be computed together or not at all. Absent → the conservative roster-only default, which evicts
  // the revokee but also every OTHER out-of-circle grantee (safe, lossy — that was the only behaviour before).
  const revokeBaseKeys = (who) => resolveKeys(revokeRecipients ?? currentRecipients, who);
  const recipientsOf = (recipient, recipients) =>
    (Array.isArray(recipients) && recipients.length ? recipients : (recipient ? [recipient] : []));

  return {
    // WRITE — grant each recipient a revocable key + ACP read on the CANONICAL resource (no copy).
    async onShare({ ref, recipient, recipients, recipientKeys } = {}) {
      const who = recipientsOf(recipient, recipients);
      if (who.length === 0) throw new Error('makeCanonicalShareHook: at least one recipient is required to grant');
      const keys = Array.isArray(recipientKeys) ? recipientKeys : [];
      // Seed the roster with the origin circle's existing recipients so each grant re-wraps to them + the new
      // recipient; accumulate each newly-granted key so a multi-recipient share doesn't drop earlier grantees.
      const roster = [...(await grantBaseKeys())];
      for (let i = 0; i < who.length; i += 1) {
        const recipientKey = keys[i];
        if (!recipientKey) throw new Error('makeCanonicalShareHook: a sealing public key is required per recipient');
        // Snapshot the roster per grant (a copy, not the mutable accumulator) so the substrate re-wraps the
        // group key to exactly the recipients granted SO FAR + this one.
        await canonicalShare.share({ recipient: who[i], recipientKey, currentRecipients: [...roster], ref });
        roster.push(recipientKey);
      }
    },
    // REVOKE — rotate the group key to the REMAINING recipients (the origin roster keeps access) + ACP-revoke
    // each departing recipient. Forward-secrecy caveat is the substrate's (rotation governs FUTURE content).
    async revoke({ ref, recipient, recipients, remainingRecipients } = {}) {
      const who = recipientsOf(recipient, recipients);
      if (who.length === 0) throw new Error('makeCanonicalShareHook: at least one recipient is required to revoke');
      const explicitRemaining = Array.isArray(remainingRecipients);
      const remaining = explicitRemaining ? remainingRecipients.filter(Boolean) : (await revokeBaseKeys(who));
      // The REMOVE-list — the exact sealing keys being evicted — used ONLY when the app did not override with
      // an explicit keep-list. Given it, the substrate prunes them from the LIVE resource so a concurrent
      // grant survives (revoke-wins without collateral). An explicit `remainingRecipients` from the app still
      // WINS (a deliberate override); and `revokedKeysFor` → null (any revokee's key unresolvable) falls back
      // to the keep-list too — the conservative, still-safe path (unchanged).
      const revokedKeys = (!explicitRemaining && typeof revokedKeysFor === 'function') ? await revokedKeysFor(who) : null;
      for (const agent of who) {
        await canonicalShare.revoke({ recipient: agent, revokedKeys: revokedKeys ?? undefined, remainingRecipients: remaining, ref });
      }
    },
  };
}

/**
 * ONE-CALL pod-tier wiring for the cross-circle share (the composition seam). Binds the
 * WRITE-side grant hook and the READ-side enforcement policy to the SAME `sharing` surface, `resourceUriFor`
 * mapping, and `mode` — so a share made through `onShare` is exactly what `policy.checkGrant` will later
 * accept, and nothing else. The pod-backed composition point injects the live surfaces here and threads the
 * result into `shareIntoAudience(stores, { …, onShare })` + `resolveSharedRef(stores, ref, { policy, recipient })`.
 *
 * No `@onderling/pod-client` import: `sharing` (`{ grant, list }` = `client.sharing`), `open`/`seal` (sealing
 * with key custody), and `resourceUriFor` (from `@onderling/pod-onboarding`'s `sharedRefResourceUri`) are all
 * injected. Deny-by-default is preserved on the read side; the write side refuses a grant-less share.
 *
 * CANONICAL branch (objective L, additive): when a `canonicalShare` controller is injected, the returned
 * object ALSO carries `onShareCanonical` + `revokeCanonical` (from `makeCanonicalShareHook`). The four
 * existing postures are byte-identical — `onShare`/`policy` are unchanged; the canonical hooks are extra
 * fields the caller routes to only for `sharePosture === 'canonical'`.
 *
 * @param {object} opts
 * @param {{ grant:Function, list:Function }} opts.sharing  the `client.sharing` surface.
 * @param {(ref:object)=>(string|null)} opts.resourceUriFor  the canonical source-item URI resolver.
 * @param {string} [opts.recipient]  default recipient WebID (read gate + single-recipient shares).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  sealing open (read side).
 * @param {(item:object, ctx:object)=>object|Promise<object>} [opts.seal]  optional re-seal (write side).
 * @param {{ share:Function, revoke:Function }} [opts.canonicalShare]  a `createCanonicalShare(...)` controller
 *        (objective L). Injected from the SAME pod site; enables the canonical grant/revoke hooks.
 * @param {string[]|(()=>string[]|Promise<string[]>)} [opts.currentRecipients]  origin roster sealing keys for
 *        the canonical hook (see makeCanonicalShareHook). Also the revoke-side default.
 * @param {string[]|(()=>string[]|Promise<string[]>)} [opts.grantRecipients]  optional WIDER grant-side base
 *        (roster ∪ the key resource's current recipients) so earlier out-of-circle grantees aren't dropped.
 * @param {(revokeeWebids: string[]) => (string[]|Promise<string[]>)} [opts.revokeRecipients]  optional precise
 *        revoke-side base (current holders MINUS the named revokee(s)); see makeCanonicalShareHook.
 * @param {string} [opts.mode='read']  the access mode granted + required. Must match on both sides.
 * @returns {{ onShare: Function, policy: { checkGrant: Function, open?: Function }, onShareCanonical?: Function, revokeCanonical?: Function }}
 */
export function makeCircleShareEnforcement({ sharing, resourceUriFor, recipient, open, seal, canonicalShare, currentRecipients, grantRecipients, revokeRecipients, revokedKeysFor, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.list !== 'function') {
    throw new Error('makeCircleShareEnforcement: a { grant, list } sharing surface (client.sharing) is required');
  }
  const out = {
    onShare: makeShareGrantHook({ sharing, resourceUriFor, mode, seal }),
    policy:  makeSharedRefPolicy({ sharing, open, recipient, resourceUriFor, mode }),
  };
  if (canonicalShare) {
    const canon = makeCanonicalShareHook({ canonicalShare, currentRecipients, grantRecipients, revokeRecipients, revokedKeysFor });
    out.onShareCanonical = canon.onShare;
    out.revokeCanonical  = canon.revoke;
  }
  return out;
}

/**
 * Memory-substrate enforcement policy. There is no real pod to grant against, so we enforce the posture
 * that shareIntoAudience already MODELS: the `shared-ref` carries the item's required `posture` (the
 * confidentiality floor), and the recipient circle has its own confidentiality via `postureOf`. The read
 * is allowed only when the recipient meets the floor — the same rule the SHARE op used to refuse a
 * downgrade, now enforced on the READ. Deny-by-default when the floor can't be met.
 *
 * @param {object} opts
 * @param {(circleId:string)=>number} opts.postureOf  the recipient circle's confidentiality.
 * @param {string} [opts.recipient]  the recipient circle id (default for checkGrant).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  optional group opener for sealed content.
 * @returns {{ checkGrant: Function, open?: Function }}
 */
export function makePosturePolicy({ postureOf, recipient, open } = {}) {
  if (typeof postureOf !== 'function') {
    throw new Error('makePosturePolicy: a postureOf(circleId)=>number is required');
  }
  return {
    checkGrant({ ref, recipient: who = recipient } = {}) {
      if (!who) return false;                                  // deny-by-default: no recipient ⇒ deny
      const floor = Number(ref?.posture) || 0;
      const have = Number(postureOf(who)) || 0;
      return have >= floor;
    },
    ...(typeof open === 'function'
      ? { open: (item) => unsealItem(item, open) }
      : {}),
  };
}
