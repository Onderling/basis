/**
 * basis v2 — circle invite/join glue (OBJ-2 membership, no-pod).
 *
 * v2 builds ON the classic shell: this module is THIN glue over the already-shared
 * membership core (`src/core/wizards/*State.js`) + stoop skills, so web and mobile
 * surface the SAME two operations without re-implementing any logic:
 *
 *   - buildCircleInviteUri  — an admin reads the circle's current membership code
 *     (`stoop.getCurrentMembershipCode`), stamps its peer address, and encodes a
 *     `onderling-invite://…` URI (the QR payload) via the classic `encodeMembershipCodeUrl`.
 *   - joinCircleFromInvite  — a joiner decodes a scanned/pasted invite and runs the
 *     classic `finalSubmit` chain (local redeem → peer-bridge fallback). No pod.
 *
 * `callSkill` here is the RAW 3-arg form `(appOrigin, opId, args)` — the same the
 * classic wizards use. `sendPeerRedeem` is the host's joiner-side peer-redeem sender
 * (request/response correlated by the shell); pass it through unchanged.
 */

import { encodeMembershipCodeUrl } from '../core/wizards/createGroupState.js';
import { isPodUrl } from './connectionPoints.js';
import { initialState, decodeInvite, finalSubmit, existingSelvesFrom, setLinkChoice } from '../core/wizards/joinGroupState.js';

/**
 * Build a `onderling-invite://` URI for an EXISTING circle so the admin can show it as a QR.
 * Admin-gated by the substrate (getCurrentMembershipCode returns {error:'admin-only'} otherwise).
 *
 * the invite optionally EMBEDS the circle's freedom template (`capabilities` +
 * `apps`), symmetric with the embedded rules doc. It lets the joiner review the circle's OPT-OUTABLE
 * capabilities at join (before redeeming) and record their opt-outs — see `circleConsent.js`. Purely
 * additive: an invite built without a policy carries no template and the join consent step is a no-op.
 *
 * Skills→property fold-in phase C — the invite optionally EMBEDS `offeringsMatching: true`, the
 * circle's "this kring is about skills-matching" charter signal (the board-8 circle-offering record,
 * `offeringsMatchingEnabled` in @onderling/kring-host/circleOfferings — readable only on the ADMIN device
 * that builds the invite, so it must ride the invite to reach the joiner pre-join). The join wizard
 * turns it into the visible pre-checked "share skills as category" default. Purely additive: absent
 * on older invites / non-matching circles ⇒ the joiner's default stays withhold.
 *
 * B2 / G13 (Phase 1) — the invite advertises the admin's FULL address set: the
 * canonical `adminPeerAddr` (the Ed25519 pubKey — the relay-routable address, kept
 * for back-compat) PLUS the admin's `adminNknAddr` (the NKN native address) when
 * known. A pure-NKN joiner (no relay up) needs the NKN address to reach the admin
 * for the redeem handshake; an invite that carried only the pubKey addressed a
 * string NKN can't route. Additive: an older invite / relay-only admin simply omits
 * `adminNknAddr` and the joiner falls back to the pubKey as today.
 *
 * @param {{ callSkill:Function, circleId:string, adminPeerAddr?:string|null, adminNknAddr?:string|null,
 *           capabilities?:object|null, apps?:string[]|null, offeringsMatching?:boolean|null }} a
 * @returns {Promise<{uri:string, expiresAt?:number} | {error:string}>}
 */
export async function buildCircleInviteUri({ callSkill, circleId, adminPeerAddr = null, adminNknAddr = null, capabilities = null, apps = null, offeringsMatching = null, podBacked = null, podUrl = null, relayUrl = null } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return { error: 'missing-args' };
  let res;
  try { res = await callSkill('stoop', 'getCurrentMembershipCode', { groupId: circleId }); }
  catch (err) { res = { error: err?.message || 'code-fetch-failed' }; }
  let code = res?.code;
  let expiresAt = res?.expiresAt;
  // B5 — how much of this invite is already spent. An invite surface that cannot say "3 of 6 places
  // used" is exactly how "one code, 300 members" stays invisible to the person holding the code.
  let maxRedemptions  = typeof res?.maxRedemptions === 'number' ? res.maxRedemptions : null;
  let redemptionsUsed = typeof res?.redemptionsUsed === 'number' ? res.redemptionsUsed : null;
  if (!code) {
    // A non-'no-code' error (e.g. admin-only) is terminal — don't try to mint. Otherwise there's simply
    // no ACTIVE code (expired, or the circle predates code-minting) → mint a fresh one (admin-gated;
    // surfaces 'admin-only' itself if the caller can't). So an invite always works for an admin.
    if (res?.error && res.error !== 'no-code') return { error: res.error };
    let rot;
    try { rot = await callSkill('stoop', 'rotateMyGroupCode', { groupId: circleId }); }
    catch (err) { rot = { error: err?.message || 'rotate-failed' }; }
    if (!rot?.code) return { error: rot?.error || 'no-code' };
    code = rot.code; expiresAt = rot.expiresAt;
    // A freshly minted code has admitted nobody yet, and carries its own limit.
    maxRedemptions  = typeof rot.maxRedemptions === 'number' ? rot.maxRedemptions : null;
    redemptionsUsed = 0;
  }
  const invite = {
    groupId: circleId, code, expiresAt,
    ...(adminPeerAddr ? { adminPeerAddr } : {}),
    // B2 — the NKN native address, so a pure-NKN joiner can route the redeem to
    // the admin (the pubKey alone isn't NKN-routable). Additive; absent = pubKey-only.
    ...(adminNknAddr ? { adminNknAddr } : {}),
    // embed the freedom template so the joiner can review + opt out at join.
    ...(capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities) && Object.keys(capabilities).length
      ? { capabilities } : {}),
    ...(Array.isArray(apps) && apps.length ? { apps } : {}),
    // Fold-in phase C — only ever embedded as an explicit true; false/null stays absent.
    ...(offeringsMatching === true ? { offeringsMatching: true } : {}),
    // NKN+pod circle (2026-07-28) — the circle's shared store is its meeting place, and the pod host can
    // see the membership. Embedded so the JOINER is told BEFORE redeeming (J-NP3): the creator accepting
    // that disclosure on the joiner's behalf is exactly the pattern the disclosure model exists to prevent.
    // Same additive rule as offeringsMatching: explicit true or absent, so older invites are unchanged.
    // …and WHERE. The two travel TOGETHER or not at all (2026-07-30). They used to be independent, and the
    // combination that produced was the worst one: the URL failed a stricter gate than the one that stored
    // it, got dropped, and `podBacked: true` stayed — so the joiner was told a pod host could see them and
    // never told which pod. A disclosure you cannot act on is worse than none, because it reads as
    // informed consent. Found walking J-NP1 against a real Community Solid Server (S4, 2026-07-30).
    //
    // `isPodUrl` is now the ONE rule (connectionPoints.js); three places had their own and disagreed.
    ...(podBacked === true && isPodUrl(podUrl) ? { podBacked: true, podUrl } : {}),
    // …and the RELAY endpoint (the same invite-carries-endpoint decision, the relay case): a pasted
    // invite has no deep-link context, so without this the joiner reaches the circle only if their
    // device happens to ride the same default relay. Rule 1 (join populates the connection-point list)
    // needs the url ON the invite. Additive: older invites simply omit it.
    ...(typeof relayUrl === 'string' && /^wss?:\/\/\S+$/.test(relayUrl.trim())
      ? { relayUrl: relayUrl.trim() } : {}),
  };
  return {
    uri: encodeMembershipCodeUrl(invite), expiresAt,
    // Deliberately NOT embedded in the invite object above: how many places a code has left is the
    // ISSUER's business, and putting it on the wire would tell a scanner how full the circle is
    // without telling them anything they need. It rides the RETURN value, for the admin's own screen.
    ...(maxRedemptions  != null ? { maxRedemptions }  : {}),
    ...(redemptionsUsed != null ? { redemptionsUsed } : {}),
  };
}

/**
 * Join a circle from a scanned/pasted invite URI, reusing the classic no-pod join chain.
 *
 * Cross-circle linkability (SENSITIVE — NOTE-identity-and-linkability, Decision B): the join
 * defaults to a FRESH, unlinkable per-circle key. A caller may CONTINUE as an existing self by
 * passing `linkChoice = <sourceCircleId>` PLUS the same two seams the wizards pass — `circleAddressFor`
 * (present that source circle's per-circle key) and `signCircleLink` (prove control of it, signed by
 * the source circle's identity, bound to the joining circle). `circles` scopes the choice: an unknown
 * source id falls back to fresh (deny-by-default). Without the seams the proof is absent and the admin
 * drops the linkage — so an existing-self claim only lands when it is genuinely provable. Fully
 * additive: default args ⇒ exactly the previous fresh-only behaviour.
 *
 * @param {{ inviteUri:(string|object), callSkill:Function, sendPeerRedeem?:Function, handle:string,
 *           shareAddress?:boolean, linkChoice?:string, circles?:Array<{id:string,name?:string}>,
 *           circleAddressFor?:(circleId:string)=>(string|null),
 *           signCircleLink?:(sourceCircleId:string, groupId:string, address:string)=>(any),
 *           onJoined?:(a:{circleId:string})=>(any) }} a
 * @returns {Promise<{ ok:true, circleId:string, message?:string, handle?:string } | { error:string }>}
 */
export async function joinCircleFromInvite({
  inviteUri, callSkill, sendPeerRedeem, handle, shareAddress = true,
  linkChoice = 'fresh', circles = null, circleAddressFor = null, signCircleLink = null,
  dialEndpoint = null, activeEndpointUrl = null, onJoined = null,
} = {}) {
  const h = String(handle ?? '').trim();
  if (!h) return { error: 'handle-required' };
  const state = initialState();
  decodeInvite(inviteUri, state);
  if (state.inviteParseError) return { error: state.inviteParseError };
  if (!state.invite || !state.invite.groupId) return { error: 'bad-invite' };
  state.handle = h;
  state.shareAddress = shareAddress !== false;
  // Wave B — the "continue as an existing self" choice (default fresh/unlinkable). Populate the
  // existing-selves list so setLinkChoice VALIDATES the chosen source circle before honouring it
  // (an unknown/absent choice ⇒ fresh). The signing proof is generated inside finalSubmit from the
  // circleAddressFor + signCircleLink seams; a missing seam ⇒ no proof ⇒ the admin drops the link.
  state.existingSelves = existingSelvesFrom(Array.isArray(circles) ? circles : [], state.invite.groupId);
  setLinkChoice(state, linkChoice);
  const { result, state: out } = await finalSubmit({
    state, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink, dialEndpoint, activeEndpointUrl,
    // Forwarded, not handled here: `finalSubmit` is the choke point the WIZARD also goes
    // through, so the post-join reachability step must fire there or the UI path skips it.
    onJoined,
  });
  if (!result) {
    // Carry the typed reason and the locale key, not just a flattened string. A caller needs to tell
    // "this invite has expired — ask for a fresh one" from "the admin is offline — try again later";
    // until 2026-07-30 both arrived here as a bare `join-failed`.
    return {
      error:    out?.submitError || out?.submitErrorReason || 'join-failed',
      reason:   out?.submitErrorReason ?? 'join-failed',
      ...(out?.submitErrorKey ? { errorKey: out.submitErrorKey } : {}),
    };
  }
  return { ok: true, circleId: result.groupId, message: result.message, handle: result.handle };
}
