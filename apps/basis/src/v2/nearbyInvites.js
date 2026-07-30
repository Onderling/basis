/**
 * basis v2 — broadcasting a circle invite into the room (Nearby step H, §5).
 *
 * **This changes the CARRIER, not the object.** An invite is already
 * `{ groupId, code, expiresAt, adminPeerAddr, … }` built by `buildCircleInviteUri` from the rotating
 * membership code, and redeeming one still runs the entire gate — `redeemInviteWithGate`, handle
 * uniqueness, the per-circle address proof. Putting it on a room broadcast instead of a QR code changes how
 * it reaches someone and nothing about what it is. **Join is still a join.**
 *
 * ── This is the one thing in Nearby that discloses a GROUP ───────────────────────────────────────────────
 * Everything else here discloses you: your presence, your ask, your card, your answer. An invite discloses
 * that a circle EXISTS, to everyone in radio range, and that is the point for a street party and a
 * disclosure for a support group. The same act, opposite meanings. So:
 *
 *   • **per-circle, admin-only, OFF by default** — never a global "share my circles" switch, because the
 *     answer is different for each one;
 *   • framed as **publishing**, not sharing. You are putting a circle's existence into a room;
 *   • **short expiry on anything broadcast.** Decision 4 ruled out max-uses on invite codes, so expiry is
 *     the only mitigation we have — and a broadcast invite reaches strangers rather than one scanned QR,
 *     so it gets a much tighter ceiling than the invite itself carries.
 */

/** A broadcast invite expires fast. A QR you hand someone can live for hours; a shout to a café cannot. */
export const BROADCAST_INVITE_MAX_TTL_MS = 15 * 60_000;
export const INVITE_MESSAGE = 'nearby-invite';
export const INVITE_MAX_NAME = 60;
export const INVITE_MAX_URI  = 2048;

/**
 * Per-circle publish allows. Off unless a circle id is explicitly listed — there is deliberately no
 * "publish all my circles", because the decision is per circle and a global switch would answer it wrongly
 * for every circle but the one you were thinking of.
 */
export function invitePublishAllows(stored = {}) {
  const out = {};
  for (const [circleId, value] of Object.entries(stored ?? {})) {
    if (value === true) out[circleId] = true;
  }
  return Object.freeze(out);
}

export function mayPublish(allows, circleId) {
  return !!circleId && invitePublishAllows(allows)[circleId] === true;
}

/**
 * Prepare an invite for broadcast.
 *
 * Takes what `buildCircleInviteUri` produced — which is already admin-gated by the substrate — and clamps
 * it for a room. The clamp is the substance: an invite valid for hours is fine on a QR code you hand to
 * someone and is not fine shouted into a café, so the broadcast copy expires far sooner than the invite it
 * came from.
 *
 * @param {object} a
 * @param {string} a.uri            the `onderling-invite://…` URI from `buildCircleInviteUri`
 * @param {string} a.circleId
 * @param {string} [a.circleName]   what to call it in the room
 * @param {number} [a.expiresAt]    the invite's own expiry, if it has one
 * @param {object} [a.allows]       per-circle publish allows
 * @returns {{ok: boolean, invite?: object, reason?: string}}
 */
export function prepareBroadcastInvite({
  uri, circleId, circleName = '', expiresAt = null, allows = {}, from = null, now = () => Date.now(),
} = {}) {
  if (!mayPublish(allows, circleId)) return { ok: false, reason: 'publish-not-allowed' };
  if (typeof uri !== 'string' || !uri.trim()) return { ok: false, reason: 'no-invite' };
  if (uri.length > INVITE_MAX_URI) return { ok: false, reason: 'invite-too-long' };

  const at = now();
  const ceiling = at + BROADCAST_INVITE_MAX_TTL_MS;
  // The tighter of the two always wins: a short-lived invite is not extended by broadcasting it, and a
  // long-lived one does not get to keep its life once it is in a room.
  const expires = typeof expiresAt === 'number' && Number.isFinite(expiresAt)
    ? Math.min(expiresAt, ceiling)
    : ceiling;
  if (expires <= at) return { ok: false, reason: 'invite-expired' };

  return {
    ok: true,
    invite: Object.freeze({
      uri: uri.trim(),
      circleId,
      circleName: String(circleName ?? '').trim().slice(0, INVITE_MAX_NAME),
      expiresAt: expires,
      from,
      publishedAt: at,
    }),
  };
}

/** Is a broadcast invite still live? */
export function isInviteLive(invite, now = () => Date.now()) {
  if (!invite || typeof invite.expiresAt !== 'number') return false;
  return now() < invite.expiresAt;
}

/**
 * Validate an inbound broadcast invite.
 *
 * Same discipline as an ask: rebuilt not spread, clamped, `from` from the wire. The expiry is capped
 * against OUR clock for the same reason — otherwise a peer advertises a circle in every room they visit,
 * permanently, by claiming a distant expiry.
 *
 * Note what is NOT validated here: whether the invite is genuine, whether the code is current, whether the
 * publisher is really an admin. None of that can be established from a broadcast, and none of it needs to
 * be — **redeeming runs the full gate.** A forged invite fails at redemption, which is where it should.
 */
export function receiveInvite(payload, fromAddress, now = () => Date.now()) {
  if (payload?.subtype !== INVITE_MESSAGE) return null;
  const raw = payload.invite;
  if (!raw || typeof raw !== 'object') return null;

  const uri = typeof raw.uri === 'string' ? raw.uri.trim() : '';
  if (!uri || uri.length > INVITE_MAX_URI) return null;
  const circleId = typeof raw.circleId === 'string' && raw.circleId.length > 0 && raw.circleId.length <= 128
    ? raw.circleId : null;
  if (!circleId) return null;

  // Over-long name ⇒ refuse the whole invite, before anything else is computed.
  if (typeof raw.circleName === 'string' && raw.circleName.trim().length > INVITE_MAX_NAME) return null;

  const at = now();
  const claimed = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0;
  const expiresAt = Math.min(claimed, at + BROADCAST_INVITE_MAX_TTL_MS);
  if (expiresAt <= at) return null;

  return Object.freeze({
    uri,
    circleId,
    // Refused, not shortened — same rule as a room card (S6/J-A14). A circle whose name arrived cut to 60
    // characters is a circle presented under a name nobody chose, and the person deciding whether to join
    // reads it as the real one.
    circleName: typeof raw.circleName === 'string' ? raw.circleName.trim() : '',
    expiresAt,
    // The wire wins — a broadcast must not be able to attribute a circle to someone who did not publish it.
    from: fromAddress ?? null,
    receivedAt: at,
  });
}

/**
 * What a received invite lets you do.
 *
 * Exactly one action, and it is a JOIN — the same join as a scanned QR, running the same gate. There is
 * deliberately no "save for later": a broadcast invite expires in minutes by design, so keeping one would
 * be keeping a dead code and a record of a room you were in.
 */
export function inviteActions(invite, { now = () => Date.now() } = {}) {
  if (!isInviteLive(invite, now)) return { actions: [], note: 'invite-expired' };
  return {
    actions: ['join-published-circle'],
    // Shown to the joiner: this is a real join with a real gate, not a preview.
    note: 'join-is-a-join',
  };
}
