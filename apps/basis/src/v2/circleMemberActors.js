/**
 * circleMemberActors — resolve a circle's roster to media-grant ACTOR ids.
 *
 * The media blob ACL grants/reads on the capability-token SUBJECT, which is a
 * member's **signing** pubKey (`AgentIdentity.pubKey`) — see
 * `src/v2/circleMediaGateway.js` (remote mode grants `memberActors`) and
 * `@onderling/blob-gateway` (`capabilityVerifier` → `{ webId: subject }`, `podAcl`
 * matches `g.agent === webId`). So `memberActors` MUST be each member's signing
 * pubKey.
 *
 * The circle roster (`controlAgent.members()` / stoop `listGroupMembers`) carries
 * **sealing** keys + WebIDs — and sealing is a ONE-WAY ed2curve derivation of the
 * signing key (non-invertible), so the roster itself cannot yield it. The signing
 * key lives in the `MemberMap`: `members.resolveByWebid(webid).pubKey` — the SAME
 * resolution the circle/chat fan-out uses (`wireChat.send`'s `toPubKey`). We reuse
 * it here; no second source, no guessing.
 *
 * A member whose `pubKey` doesn't resolve (a code-redeemer before the redeem-time
 * signing-key capture, or before a card exchange) is DROPPED and counted — an
 * honest `unresolved` gap, never a fabricated actor. Those members simply can't
 * be granted media reads yet (they also can't receive fan-out today — same root
 * cause, same fix). NEVER pass a sealing key or a WebID as an actor: it would
 * grant the wrong id and every read would deny.
 *
 * KEY-SPACE BINDING: the signing key is read from the SAME bound membership record
 * (`membershipRecord`) that carries the member's sealing key + circle address — the
 * trail row `deriveRoster` projects. So a member present in the roster (bound for
 * sealing) resolves for signing from that one record, WITHOUT a second (lossy)
 * MemberMap lookup drifting out of step. The MemberMap is only the FALLBACK for a
 * legacy roster row that lacks its own captured signing key; the bound record wins.
 */

import { membershipRecord } from '@onderling-app/stoop/lib/membershipRecord';

/** Extract the WebID from a roster entry (tolerates {webId}/{webid}/string). */
function webidOf(entry) {
  if (typeof entry === 'string') return entry;
  return entry?.webId ?? entry?.webid ?? null;
}

/**
 * @param {{ resolveByWebid: (webid:string) => Promise<{pubKey?:string}|null>|{pubKey?:string}|null }} members
 *   the circle's MemberMap (webid → signing pubKey).
 * @param {Array<{webId?:string, webid?:string}|string>} roster  the circle roster.
 * @returns {Promise<{ actors: string[], unresolved: number }>}
 *   `actors` = deduped signing pubKeys to grant; `unresolved` = roster members
 *   with no resolvable signing key (surface this — they're not yet media-reachable).
 */
export async function circleMemberActors(members, roster = []) {
  if (!members || typeof members.resolveByWebid !== 'function' || !Array.isArray(roster)) {
    return { actors: [], unresolved: Array.isArray(roster) ? roster.length : 0 };
  }
  const actors = new Set();
  let unresolved = 0;
  for (const entry of roster) {
    const webid = webidOf(entry);
    if (!webid) { unresolved += 1; continue; }
    // The bound membership record FIRST: the signing key is read from the SAME roster row that
    // carries this member's sealing key + circle address (the trail projection), so signing can't
    // drift out of step with sealing. Only when that row lacks a captured signing key do we fall
    // back to the (lossy) MemberMap cache.
    let pubKey = membershipRecord(entry).signingPubKey;
    if (!pubKey) {
      try {
        const resolved = await members.resolveByWebid(webid);
        pubKey = (resolved && typeof resolved.pubKey === 'string' && resolved.pubKey.length > 0)
          ? resolved.pubKey
          : null;
      } catch {
        pubKey = null; // a resolver throw is a non-resolution, not a crash
      }
    }
    if (pubKey) actors.add(pubKey); else unresolved += 1;
  }
  return { actors: [...actors], unresolved };
}
