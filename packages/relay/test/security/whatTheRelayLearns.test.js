/**
 * LAYER 2 — the adversary harness: enumerate what a relay can derive, then diff it against the claim.
 *
 * `J-B15` asks a person to sit at a relay with full logging and write down everything derivable.
 * That is the right question and the wrong instrument: a human observer cannot demonstrate a
 * negative by doing something, and "we looked and saw nothing" is not evidence. So this file does
 * the walk mechanically.
 *
 * A REAL relay is started on port 0 (the harness every other suite in this package uses) and put
 * through a scripted multi-circle session with real per-circle identities and really sealed
 * payloads. The relay is instrumented from OUTSIDE — a second listener on its own `wss`, a wrapper
 * on each socket's `send`, and a capture of its stdout with verbose hop logging on — so nothing in
 * `packages/relay/src` had to change to be observed. Everything crossing the boundary is recorded:
 * frames both ways, addresses, times, sizes, socket↔address associations, and every byte the relay
 * writes down.
 *
 * That record is then reduced to FACTS and diffed against `DERIVABLE_FACTS` in
 * `whatTheRelayMayLearn.js`. Anything outside the list fails. The list is the privacy claim in
 * executable form, and it is deliberately generous about metadata: a relay knows who talks to whom
 * by address, when, how often and how big, and pretending otherwise would make this guard a lie
 * rather than a test. The claim is about CIRCLES.
 *
 * This file found three things the design document did not have written down. Two are now closed and
 * the tests that demonstrated them assert their closure instead, keeping the attack narrative that
 * says why the guard exists: the `group-publish` frame that named a circle in cleartext, and the
 * plaintext canary that misfired on addresses and printed them in full (both 2026-07-31). The third
 * — the blob gate's durable member list — is still open and still marked ▲ FINDING where it is
 * asserted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  AgentIdentity, SecurityLayer, mkEnvelope, P, circleIdentity, deriveCircleAddress,
  addressPossessionMessage, b64encode,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '../../src/server.js';
import { setVerboseEnabled, findPlaintextLeak, logHop } from '../../src/verbose.js';
import {
  DERIVABLE_FACTS, WIRE_FRAMES, ENVELOPE_HEADER_FIELDS, SEALED_PAYLOAD_KEYS, KNOWN_HOLES,
} from './whatTheRelayMayLearn.js';

/* ── the two circles, and everything about them that must not reach the relay ───────────────────── */

const CIRCLE_X = { id: 'circle-oosterpoort-7f3a91', name: 'Circle circle Oosterpoort' };
const CIRCLE_Y = { id: 'huishouden-de-vries-2b6c04',   name: 'Huishouden De Vries' };
const MESSAGE_TEXT = 'de vergadering is verplaatst naar donderdagavond acht uur';
const MEMBER_NAMES = ['Anna de Boer', 'Bram Jansen', 'Cato Visser'];

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 2_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs}ms)`);
    await new Promise(r => setTimeout(r, 10));
  }
}

/* ── the observation post ───────────────────────────────────────────────────────────────────────
 * Everything the relay could derive, recorded from its own boundary. Deliberately built without
 * touching `packages/relay/src`: if the boundary can only be observed by instrumenting the code
 * under test, the observation is about the instrumentation.
 */
function observe(relay) {
  const record = { sockets: [], frames: [], written: [] };

  relay.wss.on('connection', (socket) => {
    const id = record.sockets.length;
    record.sockets.push({ id, openedAt: Date.now(), closedAt: null });

    socket.on('message', (raw) => {
      const bytes = typeof raw?.length === 'number' ? raw.length : Buffer.byteLength(String(raw));
      let frame; try { frame = JSON.parse(raw); } catch { frame = { type: '<unparseable>' }; }
      record.frames.push({ socketId: id, direction: 'in', at: Date.now(), bytes, frame });
    });

    const originalSend = socket.send.bind(socket);
    socket.send = (data, ...rest) => {
      let frame; try { frame = JSON.parse(data); } catch { frame = { type: '<unparseable>' }; }
      record.frames.push({
        socketId: id, direction: 'out', at: Date.now(),
        bytes: Buffer.byteLength(String(data)), frame,
      });
      return originalSend(data, ...rest);
    };

    socket.on('close', () => {
      const s = record.sockets[id];
      if (s) s.closedAt = Date.now();
    });
  });

  return record;
}

/** Every byte the relay itself wrote down, plus every byte that crossed its boundary. */
const corpus = (record) => JSON.stringify(record.frames) + '\n' + record.written.join('\n');

/* ── clients ────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every per-circle identity this session holds, by address — the harness's own keyring. Registration
 * is challenge-first since 2026-07-31 (Decision 3): the relay hands out a nonce and only routes to an
 * address whose key signed it, so a scripted client has to prove itself exactly as a device does.
 */
const keyring = new Map();
const holds = (identity) => { keyring.set(identity.pubKey, identity); return identity.pubKey; };

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.messages = [];
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      ws.messages.push(msg);
      if (msg.type !== 'challenge') return;
      const identity = keyring.get(msg.address);
      if (!identity) return;                     // not ours to prove, and we do not pretend otherwise
      ws.send(JSON.stringify({
        type: 'register-proof', address: msg.address, nonce: msg.nonce,
        proof: b64encode(identity.sign(addressPossessionMessage(msg.address, msg.nonce))),
      }));
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));

/** A person: a profile seed, and a per-circle signing identity for each circle they are in. */
async function person(circleIds) {
  const profileSeed = new Uint8Array(randomBytes(32));
  const perCircle = {};
  for (const circleId of circleIds) {
    perCircle[circleId] = await circleIdentity(profileSeed, circleId, new VaultMemory());
    holds(perCircle[circleId]);
  }
  return { profileSeed, perCircle, addressIn: (c) => perCircle[c].pubKey };
}

/** A genuinely sealed envelope, from one per-circle identity to another. */
function sealedEnvelope(fromIdentity, toIdentity, payload) {
  const layer = new SecurityLayer({ identity: fromIdentity });
  layer.registerPeer(toIdentity.pubKey, toIdentity.pubKey);
  return layer.encrypt(mkEnvelope(P.OW, fromIdentity.pubKey, toIdentity.pubKey, payload));
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════ */

describe('what a relay learns from a real multi-circle session', () => {
  let relay; let url; let record; let logSpy;

  beforeEach(async () => {
    // Everything the relay can say about itself, turned all the way up: `log: true` for the broker's
    // own lines, verbose mode for the per-hop log AND its plaintext-leak detector. J-B15 says "sit at
    // the relay with full logging"; this is full logging.
    setVerboseEnabled(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    relay = await startRelay({ port: 0, log: true });
    url = `ws://127.0.0.1:${relay.port}`;
    record = observe(relay);
  });

  afterEach(async () => {
    await relay?.stop();
    logSpy?.mockRestore();
    setVerboseEnabled(false);
  });

  /** The scripted session. Anna is in X and Y; Bram in X; Cato in Y and goes offline mid-session. */
  async function walkTheSession() {
    const anna = await person([CIRCLE_X.id, CIRCLE_Y.id]);
    const bram = await person([CIRCLE_X.id]);
    const cato = await person([CIRCLE_Y.id]);

    // Anna: ONE socket, both her per-circle addresses on it (the J-R1 shape, taken knowingly).
    const annaSock = await openClient(url);
    send(annaSock, { type: 'register', address: anna.addressIn(CIRCLE_X.id) });
    send(annaSock, { type: 'register', address: anna.addressIn(CIRCLE_Y.id) });
    const bramSock = await openClient(url);
    send(bramSock, { type: 'register', address: bram.addressIn(CIRCLE_X.id) });
    let catoSock = await openClient(url);
    send(catoSock, { type: 'register', address: cato.addressIn(CIRCLE_Y.id) });
    await waitFor(() => bramSock.messages.some(m => m.type === 'registered')
                     && catoSock.messages.some(m => m.type === 'registered'));

    // One push token for the device, covering every address on it.
    send(annaSock, { type: 'register-push-token', token: 'ExponentPushToken[anna-device]', platform: 'android' });

    // Circle X: a real sealed message that reaches a connected member.
    send(annaSock, {
      type: 'send',
      to: bram.addressIn(CIRCLE_X.id),
      envelope: sealedEnvelope(
        anna.perCircle[CIRCLE_X.id], bram.perCircle[CIRCLE_X.id],
        { subtype: 'circle-chat-message', text: MESSAGE_TEXT, circleName: CIRCLE_X.name },
      ),
    });
    await waitFor(() => bramSock.messages.some(m => m.type === 'message'));

    // Circle Y: Cato goes offline, so the same traffic goes through the hold-and-forward queue and
    // comes back out on reconnect — the path where a relay holds a message rather than passing it.
    catoSock.close();
    await settle(120);
    send(annaSock, {
      type: 'send',
      to: cato.addressIn(CIRCLE_Y.id),
      envelope: sealedEnvelope(
        anna.perCircle[CIRCLE_Y.id], cato.perCircle[CIRCLE_Y.id],
        { subtype: 'circle-chat-message', text: MESSAGE_TEXT, members: MEMBER_NAMES },
      ),
    });
    await settle(80);
    catoSock = await openClient(url);
    send(catoSock, { type: 'register', address: cato.addressIn(CIRCLE_Y.id) });
    await waitFor(() => catoSock.messages.some(m => m.type === 'message'));

    // An adversary move, so a refusal is in the record: Bram speaks as Anna's circle-X address.
    send(bramSock, {
      type: 'send',
      to: cato.addressIn(CIRCLE_Y.id),
      envelope: { _p: 'OW', _from: anna.addressIn(CIRCLE_X.id), payload: { text: 'vertrouw me' } },
    });
    // And the ordinary curiosity: who else is here?
    send(annaSock, { type: 'peer-list' });
    await waitFor(() => bramSock.messages.some(m => m.type === 'error'));
    await settle(120);

    record.written = logSpy.mock.calls.map(c => c.map(String).join(' '));
    for (const s of [annaSock, bramSock, catoSock]) { try { s.close(); } catch { /* */ } }
    await settle(80);
    return { anna, bram, cato };
  }

  /* ── the claim, checked ──────────────────────────────────────────────────────────────────────── */

  it('every fact the relay could derive reduces to one on the allow-list', async () => {
    await walkTheSession();

    const allowed = new Set(DERIVABLE_FACTS.map(f => f.id));
    const observed = new Set();

    expect(record.sockets.length, 'no sockets observed — the harness would pass by seeing nothing')
      .toBeGreaterThan(2);
    observed.add('socket-exists');

    for (const { frame } of record.frames) {
      const spec = WIRE_FRAMES[frame.type];
      expect(spec, `A wire frame crossed the relay boundary that the privacy claim does not account `
        + `for: "${frame.type}". Add it to WIRE_FRAMES with the fact it lets the relay derive — and `
        + `if that fact is "a circle exists", the frame is the problem, not the list.`).toBeTruthy();
      for (const key of Object.keys(frame)) {
        expect(spec.allowedKeys, `frame "${frame.type}" carries an unexpected field "${key}"`)
          .toContain(key);
      }
      observed.add(spec.fact);
    }

    for (const fact of observed) {
      expect(allowed, `derived a fact with no entry in DERIVABLE_FACTS: ${fact}`).toContain(fact);
    }
    // …and the session really did exercise the interesting ones, so a green tick means something.
    for (const fact of ['socket-exists', 'addresses-on-a-socket', 'address-possession',
                        'push-token', 'message-hop', 'peer-list', 'refusal']) {
      expect(observed, `the session never produced "${fact}" — the walk got shorter than the claim`)
        .toContain(fact);
    }
  });

  it('the envelope header the relay reads has no room for a circle', async () => {
    await walkTheSession();

    // The sharpest single line of the claim. A circle id added to the envelope header would be
    // visible to every relay on every path, forever, and is the easiest possible way to lose this
    // property by accident.
    const envelopes = record.frames.map(f => f.frame.envelope).filter(Boolean);
    expect(envelopes.length).toBeGreaterThan(2);
    for (const env of envelopes) {
      for (const key of Object.keys(env)) {
        expect(ENVELOPE_HEADER_FIELDS, `envelope header field "${key}" is not on the claim's list`)
          .toContain(key);
      }
    }
  });

  it('the payload the relay forwards is sealed — it holds ciphertext, not a message', async () => {
    await walkTheSession();

    const sealed = record.frames
      .map(f => f.frame.envelope?.payload)
      .filter(p => p && typeof p === 'object' && p._box);
    expect(sealed.length, 'the session sent no sealed traffic — the assertion below is empty')
      .toBeGreaterThan(1);
    for (const payload of sealed) {
      expect(Object.keys(payload), 'a forwarded payload carries more than the sealed box')
        .toEqual(SEALED_PAYLOAD_KEYS.slice(0, Object.keys(payload).length));
    }
  });

  it('nothing about a circle appears anywhere the relay can see or write', async () => {
    await walkTheSession();

    const seen = corpus(record);
    expect(seen.length, 'nothing was recorded — the leak scan would pass by scanning nothing')
      .toBeGreaterThan(500);

    const mustNotAppear = [
      ['circle X id',     CIRCLE_X.id],
      ['circle Y id',     CIRCLE_Y.id],
      ['circle X name',   CIRCLE_X.name],
      ['circle Y name',   CIRCLE_Y.name],
      ['the message text', MESSAGE_TEXT],
      ...MEMBER_NAMES.map(n => [`the member name "${n}"`, n]),
    ];
    for (const [label, value] of mustNotAppear) {
      expect(seen.includes(value), `${label} crossed the relay boundary or was written to its log`)
        .toBe(false);
    }
  });

  it('the relay\'s own log truncates every address, and never writes a group at all', async () => {
    await walkTheSession();

    // `shortId` truncates to 12 characters + an ellipsis on every `[relay]` line. The log is an
    // operator's record of their own machine's traffic, not a transcript of who exists.
    // (The `[verbose] potential plaintext leak` line used to be the exception — it printed an
    // 80-character excerpt. Since 2026-07-31 its excerpt goes through `shortId` too; see below.)
    const brokerLog = record.written.filter(l => l.startsWith('[relay]'));
    expect(brokerLog.length, 'log: true produced no lines — this assertion would be empty')
      .toBeGreaterThan(4);

    const addressesSeen = new Set(record.frames.flatMap(f => [f.frame.address, f.frame.to]).filter(Boolean));
    expect(addressesSeen.size).toBeGreaterThan(2);
    for (const address of addressesSeen) {
      expect(brokerLog.some(l => l.includes(address)), 'a full address appears in the relay log')
        .toBe(false);
    }
    expect(record.written.some(l => /group=/.test(l)), 'a group id was logged in open mode').toBe(false);
  });

  it('two of a person\'s circles are linked by her socket and her token — and by nothing else', async () => {
    // The concession, stated rather than hidden (J-R1, docs/decisions.md 2026-07-27). Naming it here
    // is what keeps the rest of this file an honest claim instead of a marketing sentence.
    const { anna } = await walkTheSession();
    const x = anna.addressIn(CIRCLE_X.id);
    const y = anna.addressIn(CIRCLE_Y.id);

    const socketsFor = (addr) => new Set(record.frames
      .filter(f => f.frame.type === 'register' && f.frame.address === addr)
      .map(f => f.socketId));
    expect([...socketsFor(x)]).toEqual([...socketsFor(y)]);         // the linkage, demonstrated

    // …and that is the whole of it: the addresses themselves share no derivable relation, and the
    // relay is never told what either of them is FOR.
    expect(x).not.toEqual(y);
    expect(deriveCircleAddress(anna.profileSeed, CIRCLE_X.id)).toEqual(x);
    expect(x.slice(0, 8)).not.toEqual(y.slice(0, 8));
  });

  /* ── the frame that named a circle out loud, and no longer exists ────────────────────────────── */

  it('the wire protocol has no frame that names a circle — `group-publish` is gone', async () => {
    // THE ATTACK THIS CLOSES. `group-publish` was `{ type, groupId, topic?, envelope }`: one frame,
    // fanned out by the relay to every connected member of the named circle. The `groupId` sat in
    // CLEARTEXT on the wire, ahead of any decision the relay took, so a single use told the relay
    // that a named circle exists — the exact sentence the claim denies. It leaked nothing in practice
    // only because no shipped client sent it (`RelayTransport` never had a group-publish path), and
    // "nobody happens to use it" is a convention, not a gate
    // (`docs/conventions/enforceability.md`). The frame's presence in the protocol WAS the hole.
    //
    // Removed 2026-07-31. A broadcast is now N `send` frames from the client, which is the only
    // party entitled to the roster: it costs a round-trip per member and buys the relay's inability
    // to learn a circle id at all.
    const sock = await openClient(url);
    const someone = holds(await AgentIdentity.generate(new VaultMemory()));
    send(sock, { type: 'register', address: someone });
    await waitFor(() => sock.messages.some(m => m.type === 'registered'));
    await settle(60);
    sock.messages.length = 0;
    logSpy.mockClear();

    send(sock, { type: 'group-publish', groupId: CIRCLE_X.id, envelope: { _p: 'OW', _from: someone, payload: {} } });
    await settle(150);
    record.written = logSpy.mock.calls.map(c => c.map(String).join(' '));

    // Nothing answers it: no ack, no fan-out, not even a refusal that would confirm the frame was
    // ever understood. It is an unknown type and falls off the end of the handler.
    expect(sock.messages.filter(m => m.type !== 'peer-list'),
      'the relay still responds to `group-publish` — the frame is back in the protocol').toEqual([]);

    // A client can always volunteer bytes; what it cannot do is get them recorded or acted on. The
    // relay wrote nothing about the circle, and nothing carrying the id left the relay.
    expect(record.written.some(l => l.includes(CIRCLE_X.id)),
      'the circle id reached the relay\'s own log').toBe(false);
    const outbound = record.frames.filter(f => f.direction === 'out');
    expect(JSON.stringify(outbound).includes(CIRCLE_X.id),
      'the circle id was echoed back out across the relay boundary').toBe(false);

    // …and the reintroduction guard is structural, not a comment: an unmapped frame type fails the
    // first test in this file, so bringing the fan-out back fails the harness before it ships.
    expect(WIRE_FRAMES['group-publish']).toBeUndefined();
    expect(WIRE_FRAMES['group-publish-ack']).toBeUndefined();

    try { sock.close(); } catch { /* */ }
    await settle(60);
  });
});

/* ── the plaintext canary: it used to misfire on addresses, and print them in full ──────────────── */

describe('the relay\'s own plaintext canary', () => {
  // Two REAL per-circle addresses from this suite's own runs. They are kept because they are the
  // evidence: under the old canary the first one tripped the alarm and the second did not, on
  // nothing but their vowels.
  const misread = '9rRPAoSHatz_cZEOGdq43yT9a8hp_iuxGDnebv06tI8';
  const quiet   = 'MUFtx5PO-xsSrkMA6QR_PwzxxMG1jegVL9JTxDB0Xmo';

  let logSpy;
  beforeEach(() => {
    setVerboseEnabled(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); setVerboseEnabled(false); });

  it('is silent on ordinary per-circle addresses — no coin flip left in it', () => {
    // WHAT WENT WRONG. `findPlaintextLeak` is the relay's "are we leaking?" canary. It used to flag
    // any run of ≥40 readable characters whose vowel ratio looked like English; a base64 Ed25519
    // pubkey is 43 readable characters, so whether it fired depended on the key material. It called
    // `misread` plaintext and let `quiet` past — a coin flip an operator learns to ignore, and the
    // real leak it exists for then goes past unread with it. Tuning the ratio only moves that line:
    // an address is not distinguishable from prose by entropy.
    //
    // Fixed 2026-07-31 by changing the SIGNAL, not the threshold. Sealing has a shape and it is a
    // contract: `SecurityLayer.encrypt` replaces `payload` with `{_box}` and leaves the routing
    // header cleartext. So the canary now asks "is this the shape a sealed envelope has", which is
    // a question with an answer.
    for (const address of [misread, quiet]) {
      expect(findPlaintextLeak({ _p: 'OW', _from: address, _to: quiet, payload: { _box: 'AAAA' } }),
        'an ordinary sealed envelope must never trip the alarm').toBeNull();
      // Even a bare header with nothing else on it — the shape the old scan choked on.
      expect(findPlaintextLeak({ _from: address })).toBeNull();
    }

    // …and it still catches the thing it exists to catch: readable content where `{_box}` belongs.
    const leak = findPlaintextLeak({ _p: 'OW', _from: misread, payload: { text: MESSAGE_TEXT } });
    expect(leak?.marker, 'the canary went quiet altogether — that is worse than crying wolf')
      .toBe('unsealed-payload');
  });

  it('…and when it fires, the excerpt is truncated like every other line the relay writes', () => {
    // WHAT ELSE WENT WRONG. Every other line the relay writes runs through `shortId` (12 chars +
    // ellipsis). The leak line printed an 80-character excerpt of whatever it had flagged — which,
    // per the test above, was in practice an address. So the alarm leaked while crying wolf: it put
    // a full address into an operator's stdout, defeating the truncation everywhere else.
    logHop({ kind: 'send', from: misread, to: 'someone-else', envelope: { _p: 'OW', _from: misread, payload: { _box: 'x' } } });
    let lines = logSpy.mock.calls.map(c => c.map(String).join(' '));
    expect(lines.some(l => l.includes('potential plaintext leak')),
      'a properly sealed envelope raised the alarm').toBe(false);

    // A real leak — an unsealed payload carrying a message and an address.
    logSpy.mockClear();
    logHop({
      kind: 'send', from: misread, to: 'someone-else',
      envelope: { _p: 'OW', _from: misread, payload: { text: MESSAGE_TEXT, address: quiet } },
    });
    lines = logSpy.mock.calls.map(c => c.map(String).join(' '));
    const leak = lines.find(l => l.includes('potential plaintext leak'));
    expect(leak, 'the real case must still raise the alarm').toBeTruthy();

    // It names WHICH contract broke, and carries no more than a `shortId` of what it found: not the
    // address it was flagged on, and not the message.
    expect(leak).toContain('marker=unsealed-payload');
    expect(leak.includes(misread), 'the excerpt carries the full address into stdout').toBe(false);
    expect(leak.includes(quiet), 'the excerpt carries an address out of the payload').toBe(false);
    expect(leak.includes(MESSAGE_TEXT), 'the excerpt carries the message itself').toBe(false);

    // The hole is closed, so its KNOWN_HOLES entry is gone — a stale warning next to a claim is
    // worse than no warning. This is the assertion that keeps the two in step.
    expect(KNOWN_HOLES.find(h => h.id === 'verbose-log-prints-full-address')).toBeUndefined();
    expect(KNOWN_HOLES.find(h => h.id === 'group-publish-names-a-circle-on-the-wire')).toBeUndefined();
    // …and the biggest of the three: `unproven-registration` — "anyone may register any address" —
    // closed by proof of possession on 2026-07-31 (Decision 3). What is left in its place is the
    // narrower `live-proxy-of-a-registration-challenge`, which is still open and still written down.
    expect(KNOWN_HOLES.find(h => h.id === 'unproven-registration')).toBeUndefined();
    expect(KNOWN_HOLES.find(h => h.id === 'live-proxy-of-a-registration-challenge')).toBeTruthy();
  });
});

/* ── ▲ FINDING: the blob gate keeps a durable member list, under a cross-circle identity ─────────── */

describe('the blob gate is the one place a relay really does hold a roster', () => {
  let relay;
  afterEach(async () => { await relay?.stop(); relay = null; });

  it('is not mounted by default — a relay you start plainly has no ACL at all', async () => {
    relay = await startRelay({ port: 0 });
    expect(relay.blobGate, 'the hole must stay opt-in').toBeUndefined();

    const res = await fetch(`http://127.0.0.1:${relay.port}/blob-gate/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify({ key: 'blob://k', actors: ['a', 'b'] }),
    });
    expect(await res.text()).not.toContain('"ok":true');
  });

  it('▲ when mounted, it records exactly what J-B15 says the relay must never learn', async () => {
    // `blobAclStore.js`'s own header describes the flow as "the uploader grants the CIRCLE MEMBERS
    // at upload time". So the rows for one key are a member list; `actorId` is a WebID, i.e. a
    // stable identifier the same person carries into every circle they upload into; and
    // `SqliteBlobAclStore` makes it survive a restart. That is a roster at the relay, under a
    // cross-circle identity, durable — stronger than anything in `server.js`, and absent from the
    // design document's list of what survives.
    //
    // Demonstrated rather than described, so the entry in KNOWN_HOLES is a measured fact.
    const uploader = 'https://anna.example/profile/card#me';
    const members  = ['https://anna.example/profile/card#me', 'https://bram.example/profile/card#me'];
    relay = await startRelay({
      port: 0,
      blobGate: {
        verifyToken: async (t) => (t === 'anna-token' ? { webId: uploader } : null),
        bucket: { presign: async () => 'https://example.invalid/blob' },
        uploaders: [uploader],
      },
    });

    const res = await fetch(`http://127.0.0.1:${relay.port}/blob-gate/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anna-token' },
      body: JSON.stringify({ key: 'blob://vergaderfoto', actors: members }),
    });
    expect(await res.json()).toEqual({ ok: true, granted: 2 });

    // What the relay now holds: these two people share this blob. Do it for a second blob and the
    // intersection is a circle, without the relay ever being told the word.
    const acl = relay.blobGate.acl;
    for (const member of members) expect(await acl.check(member, 'blob://vergaderfoto')).toBe(true);
    expect(await acl.check('https://dana.example/profile/card#me', 'blob://vergaderfoto')).toBe(false);

    const hole = KNOWN_HOLES.find(h => h.id === 'blob-gate-acl');
    expect(hole, 'this leak must stay written down next to the claim it contradicts').toBeTruthy();
  });
});
