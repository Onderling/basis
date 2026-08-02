/**
 * Sender binding — one rule, asked at every boundary that can answer it.
 *
 * An envelope's `_from` is a CLAIM. No transport writes it, no transport checks it, and a signature only
 * proves that someone holds a key — never that the key belongs at the address the envelope names. So a
 * peer who can reach you at all can speak as anyone you have already keyed. The fix at this layer is to
 * ask the boundary the one question it can actually answer: *who does the connection say this is?* — and
 * refuse the envelope when the claim disagrees.
 *
 * ── Why this lives in the kernel ────────────────────────────────────────────────────────────────
 * The RULE is transport-agnostic: compare a claimed sender against an authenticated one and produce a
 * verdict. It is pure — no adapter import, no network, no I/O — so it sits next to `Transport.js`, the
 * port it belongs to (invariant 5: `apps/` → substrates → `core`; concrete adapters live outside).
 *
 * Exactly ONE thing is per-transport: **where the authenticated sender comes from**. That is the port
 * (`authenticatedSender` below), and every transport-specific detail lives on the far side of it — nkn's
 * `__N__.` sub-client prefix and its encrypted-only `src` authentication stay in the nkn adapters
 * (`@onderling/transports/src/nknSenderBinding.js`); the relay's per-socket registration set stays in the
 * relay. Nothing nkn-shaped or ws-shaped is allowed in this file.
 *
 * ── Second line, NOT the wall ───────────────────────────────────────────────────────────────────
 * Every use of this rule is a SECOND line of defence, and the limits are structural rather than
 * incidental:
 *   • it only covers boundaries that authenticate. A transport that cannot answer returns `null` and the
 *     envelope passes UNCHECKED — a hole, which is why absence has to be announced (see
 *     `createSenderBinding`) rather than silently skipped.
 *   • a hostile relay sits OUTSIDE the relay's own check, because the relay is the thing checking.
 *   • it binds a sender to a connection, never to a key.
 * The primary defence is the circle layer — sealing plus roster-authorised senders — which is a separate
 * build. This makes cheap remote impersonation expensive; it is not the boundary.
 */

/**
 * The per-transport port: given whatever the transport handed us for an inbound frame, who does the
 * transport itself say the sender is?
 *
 * Three answers, three different meanings — the distinction is the whole design, so keep it:
 *
 *   `'<address>'` / `['<a>', '<b>']`
 *        The connection is authenticated to speak as these addresses (one, or a set — a relay socket
 *        legitimately owns many per-circle aliases). An EMPTY array is a real answer too: "authenticated,
 *        and authenticated as nobody", so every claim mismatches.
 *
 *   `null` / `undefined`
 *        This transport has NO authenticated sender to offer, structurally. The envelope passes, and the
 *        caller is expected to say so out loud — see `createSenderBinding`. Explicit absence beats silent
 *        absence: an unchecked path that nobody announces reads exactly like a checked one.
 *
 *   `{ refuse: '<reason>' }`
 *        This particular frame carries no usable authentication and must not be trusted — e.g. an
 *        unencrypted nkn frame, where `src` is an unverified protobuf field an attacker sets to match
 *        `_from`. Checking such a frame would be the vacuous check this work exists to remove, so it is
 *        dropped instead of "checked".
 *
 * @callback AuthenticatedSender
 * @param   {*} raw — whatever the transport received (an nkn message, a socket's registration state, …)
 * @returns {string|string[]|null|undefined|{refuse: string}}
 */

/**
 * Is this inbound envelope allowed to speak as the sender it claims?
 *
 * @param   {*}      raw       — the transport's raw inbound frame, passed straight to the port
 * @param   {object} envelope  — the parsed envelope carrying the claim (`_from`)
 * @param   {AuthenticatedSender} authenticatedSender — the per-transport port
 * @returns {{ok: boolean, reason: string, claimed: string|null, authenticated: string|string[]|null}}
 *          `reason` is one of: `bound` · `sender-mismatch` · `no-transport-sender` · `no-claimed-sender`,
 *          or whatever reason the port refused with.
 */
export function senderVerdict(raw, envelope, authenticatedSender) {
  const claimed = typeof envelope?._from === 'string' && envelope._from ? envelope._from : null;

  const answer = authenticatedSender(raw);

  // The port refused this frame outright — it could not authenticate the sender at all.
  if (answer && typeof answer === 'object' && !Array.isArray(answer) && answer.refuse) {
    return { ok: false, reason: String(answer.refuse), claimed, authenticated: null };
  }

  // Structural absence: nothing to compare against. A hole, deliberately passed rather than pretended.
  if (answer === null || answer === undefined || answer === '') {
    return { ok: true, reason: 'no-transport-sender', claimed, authenticated: null };
  }

  // No claim to disagree with. An envelope with no `_from` is useless to an impersonator anyway — the
  // receiving `SecurityLayer` rejects it with UNKNOWN_SENDER long before an application sees it — and
  // refusing them would break legitimate senders that hand the wire a bare payload object.
  if (!claimed) {
    return { ok: true, reason: 'no-claimed-sender', claimed, authenticated: normalise(answer) };
  }

  const owned = Array.isArray(answer) ? answer : [answer];
  if (!owned.includes(claimed)) {
    return { ok: false, reason: 'sender-mismatch', claimed, authenticated: normalise(answer) };
  }
  return { ok: true, reason: 'bound', claimed, authenticated: normalise(answer) };
}

/** Keep a single-address answer a string in the verdict; a set stays a set. */
function normalise(answer) {
  return Array.isArray(answer) && answer.length === 1 ? answer[0] : answer;
}

/**
 * Wrap `senderVerdict` so a transport that CANNOT authenticate says so — once, loudly — instead of
 * quietly delivering unchecked envelopes forever.
 *
 * The failure this exists to prevent: an adapter wires up the check, its port returns `null` on every
 * frame (wrong library, a test double, a transport that genuinely has no sender authentication), and the
 * code reads as protected while nothing is being compared. One warning per transport instance is enough
 * to make that visible in a log without drowning the receive path.
 *
 * @param   {object}   opts
 * @param   {string}   opts.transportName        — named in the warning, so the log says WHICH transport
 * @param   {AuthenticatedSender} opts.authenticatedSender
 * @param   {(msg: string) => void} [opts.onUnauthenticated] — called once, on the first unchecked frame
 * @returns {(raw: *, envelope: object) => {ok: boolean, reason: string, claimed: string|null, authenticated: string|string[]|null}}
 */
export function createSenderBinding({ transportName, authenticatedSender, onUnauthenticated }) {
  let announced = false;
  return function check(raw, envelope) {
    const verdict = senderVerdict(raw, envelope, authenticatedSender);
    if (verdict.reason === 'no-transport-sender' && !announced) {
      announced = true;
      onUnauthenticated?.(
        `${transportName}: inbound frames carry no authenticated sender — envelope \`_from\` is a claim `
        + 'this transport cannot check, and is being delivered UNCHECKED',
      );
    }
    return verdict;
  };
}
