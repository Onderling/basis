/**
 * basis v2 — THE WIRE REGISTER (home: Connectivity). Every kind of peer message this build sends or routes, one row per
 * wire subtype: which home it belongs to, the version of its shape, and its fields with the kind of each value. What
 * crosses between two builds is declared here once, so a change to it is a reviewable diff and not a surprise on the
 * other device.
 *
 *   - `home` decides whether the block list is asked: 'direct' (person to person: a blocked address gets none of it and
 *     sends none in), 'circle' (a circle's traffic: folds the same on every member's device, never asks), 'own' (between
 *     this person's own devices: never asks either; a device of mine is never blocked).
 *   - `v` is the version of the row's shape. It may rise only with WIRE_VERSION (protocol/wire.js), or with
 *     `additive: true` and the reason an older build still reads the new shape (the shape guard holds this).
 *   - `fields` name each top-level key and the kind of its value: string · number · boolean · list · object, with `?`
 *     for optional (null counts as absent). One level deep; anything deeper is `object`.
 *   - `blockList: false` marks a direct row that is NOT refused to a blocked address (kept as it was; ruled per row).
 *   - `inMap` marks a row the shells key in a handler map that the block-list fitness tests read; `mapKey` is the name
 *     that map keys it by when it is not the wire value (an imported constant's NAME, or the catch-up trio's role).
 *
 * Under test, the one wire call (`wireSend` in realAgent) refuses a payload whose subtype has no row here or whose keys
 * and kinds are not the row's (test/support/wireShapeCheck.setup.js), so the whole suite walks every real send path
 * against the register. Shell builds do not run the check.
 */

/**
 * The shape check at the one wire call: held here, set only by the test setup (a fitness test pins that no file outside
 * test/ calls the setter), so a shell build has no tap on its sends.
 */
let shapeCheck = null;
/** @param {((payload: object) => void)|null} fn */
export function setWireShapeCheck(fn) { shapeCheck = typeof fn === 'function' ? fn : null; }
/** Called by the wire call with every payload; does nothing unless the test setup set a check. */
export function runWireShapeCheck(payload) { if (shapeCheck) shapeCheck(payload); }
/** Whether a check is set (for the fitness test). */
export const wireShapeCheckSet = () => shapeCheck !== null;

export const WIRE_HOMES = Object.freeze(['direct', 'circle', 'own']);
export const VALUE_KINDS = Object.freeze(['string', 'number', 'boolean', 'list', 'object']);

function row(home, fields, extra = {}) {
  if (!WIRE_HOMES.includes(home)) throw new Error(`wireRegister: unknown home '${home}'`);
  return Object.freeze({ home, v: 1, fields: Object.freeze({ subtype: 'string', ...fields }), ...extra });
}

// The fields a circle lane's statement broadcast and its catch-up carry (chat, items, key, membership, governance,
// report, grants all fold signed statements; the catch-up trio pages them).
const BROADCAST = { circleId: 'string', event: 'object', msgId: 'string?', noWake: 'boolean?', ts: 'number?' };
const CATCHUP_REQUEST = { circleId: 'string', frontier: 'list?', limit: 'number?' };
const CATCHUP_BATCH = { circleId: 'string', statements: 'list', seq: 'number?', more: 'boolean?', done: 'boolean?' };
const CATCHUP_OFFER = { circleId: 'string', count: 'number', approxBytes: 'number' };
// A contact message and its answer (contactThreadChannel.js), the person-to-person thread.
const CONTACT = {
  text: 'string', messageId: 'string', threadId: 'string?', ts: 'number', replyTo: 'string?', card: 'string?',
  sealed: 'object?', auth: 'object?', webid: 'string?', pairInvite: 'string?', pairRequest: 'boolean?', displayName: 'string?',
};
// The device-to-device carries that name a device and when it claimed (primaryDevice.js).
const DEVICE_CLAIM = { deviceId: 'string', at: 'number' };

/** Every wire subtype, by its wire value. */
export const WIRE = Object.freeze({
  // ── direct: a person's messages, files and answers ──────────────────────────────────────────────────────────────
  'contact-msg':           row('direct', CONTACT, { inMap: true }),
  'contact-reply':         row('direct', CONTACT, { inMap: true }),   // read from its receiver (contactThreadChannel.js): no test sends one
  'chat-message':          row('direct', { type: 'string', body: 'string', msgId: 'string?', sentAt: 'number?', threadId: 'string?', nonce: 'string?', fromWebid: 'string?', fromStableId: 'string?' }, { inMap: true }),
  'file-share':            row('direct', { type: 'string', file: 'object', sealed: 'object?', msgId: 'string?', sentAt: 'number?' }, { inMap: true }),
  'shared-copy':           row('direct', { sealed: 'object', itemMeta: 'object', from: 'string' }, { inMap: true }),
  'delivery-receipt':      row('direct', { messageId: 'string' }, { inMap: true }),
  'calendar-invite':       row('direct', { type: 'string', event: 'object', sentAt: 'number' }, { inMap: true }),
  'calendar-rsvp':         row('direct', { type: 'string', eventId: 'string', response: 'string', sentAt: 'number' }, { inMap: true }),
  'calendar-cancel':       row('direct', { type: 'string', eventId: 'string', title: 'string?', sentAt: 'number' }, { inMap: true }),
  // a request to MY invite (not a member yet: not circle traffic) and its answer
  'group-redeem-request':  row('direct', {
    type: 'string', requestId: 'string', code: 'string', groupId: 'string', circleAddress: 'string', circleAddressProof: 'string',
    personKey: 'object', peerDisplay: 'string', shareCard: 'boolean', sentAt: 'number', podWebId: 'string?', profileKind: 'string?', rulesAccepted: 'string?',
  }, { inMap: true }),
  'group-redeem-response': row('direct', {
    type: 'string', requestId: 'string', sentAt: 'number', ok: 'boolean?', error: 'string?', codeId: 'string?', circleAddress: 'string?',
    circleAddressProof: 'string?', confirmedByDisplay: 'string?', joinStatement: 'object?', validUntil: 'number?',
  }, { inMap: true }),
  // the box's doors a person reaches directly, and what the box answers a screen
  'screen-offer':          row('direct', { offer: 'object?', launch: 'object?' }, { inMap: true, mapKey: 'SCREEN_OFFER_SUBTYPE' }),
  'screen-waiting':        row('direct', {}, { inMap: true, mapKey: 'SCREEN_WAITING_SUBTYPE' }),
  'companion-grant':       row('direct', { tokens: 'list' }, { inMap: true, mapKey: 'COMPANION_GRANT_SUBTYPE' }),
  'identity-link-revoke':  row('direct', { revocation: 'object' }, { inMap: true, mapKey: 'IDENTITY_LINK_REVOKE_SUBTYPE' }),
  'screen-nudge':          row('direct', {}),
  'surface-lane-nudge':    row('direct', { laneId: 'string' }),
  // the Nearby room's lines (people in the same room: direct contact)
  'nearby-presence':       row('direct', { presence: 'object' }),
  'nearby-ask':            row('direct', { ask: 'object' }),
  'nearby-answer':         row('direct', { answer: 'object' }),
  'nearby-card':           row('direct', { card: 'object' }),
  'nearby-chat':           row('direct', { message: 'object' }),
  'nearby-invite':         row('direct', { invite: 'object' }),
  'nearby-reach':          row('direct', { msgId: 'string', reach: 'object' }),
  // the answer that this build could not receive a subtype (notUnderstood.js)
  'not-understood':        row('direct', { of: 'string', wire: 'number?' }),
  // ── direct by nature, but NOT refused to a blocked address (`blockList: false`), as before the register: a bot link
  //    and its answer, the person-key chain a contact asks for, the box's answers to a screen, a connection grant.
  //    Whether each should be is its own ruling (the person-key chain may have to reach a blocked co-member).
  'identity-link':         row('direct', { statement: 'object', unlinked: 'boolean?' }, { blockList: false }),
  'person-key-chain-request': row('direct', { since: 'number' }, { blockList: false }),
  'person-key-chain':      row('direct', { current: 'object', links: 'list' }, { blockList: false }),
  'screen-offer-refused':  row('direct', {}, { blockList: false }),
  'screen-step-up':        row('direct', { outcome: 'string', op: 'string?' }, { blockList: false }),
  'surface-grant-offer':   row('direct', { nonce: 'string', tokens: 'list', label: 'string?' }, { blockList: false }),

  // ── circle: a circle's traffic ──────────────────────────────────────────────────────────────────────────────────
  'circle-chat-statement': row('circle', { ...BROADCAST, msgId: 'string', ts: 'number', type: 'string?', fromWebid: 'string?' }, { inMap: true, mapKey: 'CHAT_STATEMENT_BROADCAST' }),
  'circle-key-statement':  row('circle', BROADCAST, { inMap: true, mapKey: 'KEY_STATEMENT_BROADCAST' }),
  'circle-items-broadcast': row('circle', BROADCAST, { inMap: true, mapKey: 'ITEMS_BROADCAST' }),
  'circle-membership-broadcast': row('circle', BROADCAST, { inMap: true, mapKey: 'MEMBERSHIP_BROADCAST' }),
  'circle-report-broadcast': row('circle', BROADCAST, { inMap: true }),
  'circle-governance-broadcast': row('circle', BROADCAST, { inMap: true }),
  'circle-address-announce': row('circle', { type: 'string?', circleId: 'string?', groupId: 'string?', announcements: 'list?', msgId: 'string?', noWake: 'boolean?', ts: 'number?' }, { inMap: true }),
  'circle-recipe-broadcast': row('circle', { circleId: 'string', msgId: 'string', ts: 'number', recipe: 'object' }, { inMap: true }),   // read from its receiver
  'circle-chat-catchup-request': row('circle', CATCHUP_REQUEST, { inMap: true, mapKey: 'catchup:request' }),
  'circle-chat-catchup-batch':   row('circle', CATCHUP_BATCH, { inMap: true, mapKey: 'catchup:batch' }),
  'circle-chat-catchup-offer':   row('circle', CATCHUP_OFFER, { inMap: true, mapKey: 'catchup:offer' }),
  'circle-items-catchup-request': row('circle', CATCHUP_REQUEST, { inMap: true, mapKey: 'catchup:request' }),
  'circle-items-catchup-batch':   row('circle', CATCHUP_BATCH, { inMap: true, mapKey: 'catchup:batch' }),
  'circle-items-catchup-offer':   row('circle', CATCHUP_OFFER, { inMap: true, mapKey: 'catchup:offer' }),
  'circle-key-catchup-request':   row('circle', CATCHUP_REQUEST),
  'circle-key-catchup-batch':     row('circle', CATCHUP_BATCH),
  'circle-membership-catchup-request': row('circle', CATCHUP_REQUEST),
  'circle-membership-catchup-batch':   row('circle', CATCHUP_BATCH),
  'circle-governance-catchup-request': row('circle', CATCHUP_REQUEST),
  'circle-governance-catchup-batch':   row('circle', CATCHUP_BATCH),

  // ── own: between this person's own devices ──────────────────────────────────────────────────────────────────────
  'device-grants-broadcast': row('own', { event: 'object', scope: 'string?' }, { inMap: true, mapKey: 'GRANTS_BROADCAST' }),
  'device-grants-catchup-request': row('own', CATCHUP_REQUEST),
  'device-grants-catchup-batch':   row('own', CATCHUP_BATCH),
  'device-contact-turn':     row('own', { turn: 'object' }),
  'device-circle-joined':    row('own', { circle: 'object' }),
  'device-circle-left':      row('own', { circle: 'object', statement: 'object?' }),
  'device-circles-request':  row('own', {}),
  'device-known-peers':      row('own', { peers: 'list' }),
  'device-known-peers-catchup-request': row('own', {}),
  'device-known-peers-catchup-batch':   row('own', { peers: 'list' }),
  'device-person-key':       row('own', {
    subject: 'string', version: 'number', seed: 'string', linkKeyPub: 'string', links: 'list', previous: 'list', reveals: 'object', selfReveal: 'object',
  }),
  'device-person-key-catchup-request': row('own', {}),
  'device-profile-facts':    row('own', { properties: 'object', disclosure: 'object', keyTimes: 'object', factsAt: 'number' }),
  'device-profile-facts-catchup-request': row('own', {}),
  'own-items-catchup-request': row('own', CATCHUP_REQUEST),
  'own-items-catchup-batch':   row('own', CATCHUP_BATCH),
  'own-items-catchup-offer':   row('own', CATCHUP_OFFER),
  'own-spine-act':           row('own', { lane: 'string', act: 'object', actId: 'string' }),
  'own-spine-ack':           row('own', { actId: 'string', hash: 'string?' }),
  'own-circle-root':         row('own', { profileId: 'string', epoch: 'number', seed: 'string', proofs: 'list' }),
  'own-device-records':      row('own', { circleId: 'string', profileId: 'string', records: 'list' }),
  'own-address-retire':      row('own', { circleId: 'string', profileId: 'string' }),
  'primary-device-carry':    row('own', DEVICE_CLAIM),
  'primary-device-request':  row('own', {}),
  'spine-point-carry':       row('own', DEVICE_CLAIM),
  'spine-point-request':     row('own', {}),
  'roster-seed-request':     row('own', { circleId: 'string', by: 'string', body: 'object', sig: 'string', delegation: 'object' }),
  'roster-seed-batch':       row('own', { circleId: 'string', by: 'string', body: 'object', sig: 'string', delegation: 'object' }),
});

/**
 * A payload with no subtype, named by its one field. Debt, written down: a peer message should say what it is.
 * `__pairReq` is the mutual-pairing ask (realAgent's pairCirclePeer; peerSendGate.js reads it as 'pairing').
 */
export const UNNAMED = Object.freeze({
  __pairReq: Object.freeze({ home: 'direct', v: 1, fields: Object.freeze({ __pairReq: 'object' }) }),
});

/**
 * WHAT ELSE CROSSES BETWEEN TWO BUILDS, AND IS NOT HELD HERE. Each is held by its own file or register; a change to one
 * of them is a wire change all the same (WIRE_VERSION, protocol/wire.js).
 */
export const NOT_HERE = Object.freeze({
  hello: 'held by packages/core/src/protocol/hello.js: the HI payload {pubKey, label, ack, capabilities} and the refusal frame',
  envelope: 'held by packages/core/src/Envelope.js and packages/relay/src/verbose.js ROUTING_HEADER_FIELDS: the signed header',
  skillCalls: 'held by packages/core/src/protocol/taskExchange.js and the apps\' manifest.js: a skill call is an op with its args',
  laneStatements: 'held by packages/item-store/src/entryKinds.js ENTRY_KINDS and each rail\'s *_RAIL_KINDS (from the manifests): the signed statements a broadcast carries in `event` and a batch in `statements`, also stored',
  relayFrames: 'held by packages/relay/src (RelayAgent.js, WsServerTransport.js): the relay\'s own protocol',
  links: 'held by apps/basis/src/v2/scanRoute.js SCAN_SCHEMES / SCAN_TARGETS: invite and QR links',
  podRows: 'held by packages/pod-onboarding and docs/conventions/storage-layout.md: rows in a shared pod',
});

/** The names the read handler maps key the rows of these homes by (unique): the block-list fitness tests' lists. */
export const mapKeysOf = (...homes) => [...new Set(Object.entries(WIRE)
  .filter(([, r]) => r.inMap && homes.includes(r.home)).map(([name, r]) => r.mapKey ?? name))];

/** The rows of one home, by wire value. */
export const wireNamesOf = (home) => Object.keys(WIRE).filter((name) => WIRE[name].home === home);

/** The direct rows refused to a blocked address (every direct row not marked `blockList: false`). */
export const blockedDirectNames = () => wireNamesOf('direct').filter((name) => WIRE[name].blockList !== false);

const kindOf = (v) => (Array.isArray(v) ? 'list' : typeof v);

/**
 * Why this payload's shape is not its row, or null when it is. The A2A message shape (`{type:'message', parts}`) is read
 * at its data part, the same as the block list reads it.
 * @param {unknown} payload
 * @returns {string|null}
 */
export function wireShapeProblem(payload) {
  if (!payload || typeof payload !== 'object') return `a payload that is not an object (${kindOf(payload)})`;
  const inner = (payload.type === 'message' && Array.isArray(payload.parts)) ? payload.parts.find((p) => p?.data)?.data : null;
  const body = inner ?? payload;
  const sub = body?.subtype;
  let r = null;
  let name = sub;
  if (typeof sub === 'string') r = WIRE[sub] ?? null;
  else {
    const keys = Object.keys(body ?? {});
    if (keys.length === 1 && UNNAMED[keys[0]]) { r = UNNAMED[keys[0]]; name = keys[0]; }
    else return `a payload with no subtype (keys: ${keys.sort().join(', ') || 'none'})`;
  }
  if (!r) return `subtype '${sub}' has no row in the wire register`;
  const problems = [];
  for (const [k, v] of Object.entries(body)) {
    const want = r.fields[k];
    if (want === undefined) { problems.push(`'${k}' is not a field of the row`); continue; }
    const optional = want.endsWith('?');
    if (v === null || v === undefined) { if (!optional) problems.push(`'${k}' is required, sent ${v}`); continue; }
    const kind = optional ? want.slice(0, -1) : want;
    if (kindOf(v) !== kind) problems.push(`'${k}' is ${kind}, sent ${kindOf(v)}`);
  }
  for (const [k, want] of Object.entries(r.fields)) {
    if (!want.endsWith('?') && !(k in body)) problems.push(`'${k}' is required and missing`);
  }
  return problems.length ? `'${name}': ${problems.join('; ')}` : null;
}
