/**
 * FUZZ: the codes a person scans or pastes, and a card that rides a message — each read from bytes someone else made.
 * A deterministic, seeded mutator (the same cases every run) throws string mutations of a valid code, and STRUCTURAL
 * mutations of its JSON body (a wrong type in a field, a huge value, an own `__proto__` key), at every decoder. Properties:
 *   - a decoder returns (an answer or a refusal) or throws an Error — never a non-Error, never a hang;
 *   - an accepted answer has the types its contract promises;
 *   - nothing reaches Object.prototype, and a decoded object carries no prototype the input chose.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { encodeEnrollOffer, parseEnrollOffer, ENROLL_SCHEME } from '../src/v2/enrollOffer.js';
import { encodePairingOffer, parsePairingOffer } from '../src/v2/connectionPairing.js';
import { decodeContactCard, CONTACT_SCHEME } from '../src/v2/contactCardLink.js';
import { parseLinkOffer, LINK_OFFER_SCHEME } from '../src/v2/identityLink.js';
import { parseCompanionClaim } from '../src/v2/companionClaim.js';
import { encodeScreenLink, parseScreenLink, encodeScreenStartLink, parseScreenStartLink, encodeScreenLaunchLink, parseScreenLaunchLink } from '../src/v2/botScreens.js';
import { encodeContactCard } from '@onderling-app/pinboard/lib/contactCard';
import { CONNECT_SCHEME } from '../src/v2/connectionPairing.js';
import { parseLinkStartLink } from '../src/v2/identityLink.js';
import { decodeInvite } from '../src/core/wizards/joinGroupState.js';
import { openRecoveryFile, RECOVERY_FILE_KIND } from '../src/v2/registryCarrier.js';

const CASES = 500;
const ADDR = 'A'.repeat(43);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ODD = ['', '=', '+', '/', ' ', '\n', '\u0000', 'é', '\u{1F600}', '%', '.', '"', '{}', 'null', '://', '@'];
function mutate(s, r) {
  const i = Math.floor(r() * (s.length + 1));
  const ch = () => (r() < 0.8 ? B64[Math.floor(r() * B64.length)] : ODD[Math.floor(r() * ODD.length)]);
  switch (Math.floor(r() * 7)) {
    case 0: return s.slice(0, i) + ch() + s.slice(i + 1);
    case 1: return s.slice(0, i) + ch() + s.slice(i);
    case 2: return s.slice(0, i) + s.slice(i + 1);
    case 3: return s.slice(0, i);
    case 4: return s.repeat(1 + Math.floor(r() * 40));
    case 5: return ODD[Math.floor(r() * ODD.length)];
    default: return s + s.slice(0, Math.max(1, i));
  }
}
const WEIRD = () => [null, 0, -1, 1e308, true, '', 'x'.repeat(100_000), [], [null], {}, { a: { b: { c: [] } } }, JSON.parse('{"__proto__":{"polluted":1}}')];
/** One structural mutation: a random path of the object gets a value of the wrong kind, or an own `__proto__` key. */
function mutateStructure(obj, r) {
  const clone = JSON.parse(JSON.stringify(obj));
  const paths = [];
  const walk = (o, p) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { paths.push([...p, k]); walk(o[k], [...p, k]); } };
  walk(clone, []);
  if (!paths.length || r() < 0.15) return JSON.parse(`{"__proto__":{"polluted":1},${JSON.stringify(clone).slice(1)}`);
  const path = paths[Math.floor(r() * paths.length)];
  let o = clone; for (const k of path.slice(0, -1)) o = o[k];
  const w = WEIRD(); o[path.at(-1)] = w[Math.floor(r() * w.length)];
  return clone;
}
const b64json = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const b64jsonRaw = (json) => Buffer.from(json).toString('base64url');

function call(fn) {
  const t0 = Date.now();
  let v;
  try { v = fn(); } catch (e) {
    if (!(e instanceof Error)) throw new Error(`threw a non-Error: ${String(e)}`);
    v = { threw: true };
  }
  expect(Date.now() - t0, 'a decoder took over a second').toBeLessThan(1000);
  return v;
}

afterEach(() => { expect({}.polluted, 'Object.prototype was polluted').toBeUndefined(); });

describe('fuzz: enrol offer', () => {
  const valid = encodeEnrollOffer({ relays: ['wss://relay.example'], circles: [{ id: 'c1', handle: 'Huis', address: ADDR, member: true, others: ['wss://b'] }] });
  it('the valid one parses', () => { expect(parseEnrollOffer(valid)).toMatchObject({ ok: true }); });
  it('string and structural mutations: a refusal or a well-typed offer', () => {
    const r = rng(11);
    const body = { v: 1, r: ['wss://relay.example'], c: [{ id: 'c1', h: 'Huis', a: ADDR, m: 1, o: ['wss://b'] }] };
    for (let n = 0; n < CASES; n++) {
      const input = n % 2 ? mutate(valid, r) : ENROLL_SCHEME + b64json(mutateStructure(body, r));
      const v = call(() => parseEnrollOffer(input));
      if (v?.ok) {
        expect(Array.isArray(v.relays) && v.relays.every((x) => typeof x === 'string')).toBe(true);
        for (const c of v.circles) {
          expect(typeof c.id === 'string' && typeof c.address === 'string' && typeof c.member === 'boolean').toBe(true);
          expect(c.others.every((x) => typeof x === 'string')).toBe(true);
          expect(Object.getPrototypeOf(c)).toBe(Object.prototype);
        }
      }
    }
  });
});

describe('fuzz: connection pairing offer', () => {
  const valid = encodePairingOffer({ viewPubKey: ADDR, relayUrl: 'wss://relay.example', nonce: 'n0nce', label: 'Telefoon' });
  it('the valid one parses', () => { expect(parsePairingOffer(valid)?.ok ?? parsePairingOffer(valid)).toBeTruthy(); });
  it('string mutations: a refusal or an answer, never a crash', () => {
    const r = rng(12);
    for (let n = 0; n < CASES; n++) call(() => parsePairingOffer(mutate(valid, r)));
  });
});

describe('fuzz: contact card', () => {
  const card = { webid: ADDR, pubKey: ADDR, handle: 'anna', displayName: 'Anna', peerAddr: ADDR, relays: ['wss://relay.example'], personKey: { version: 1, pubKey: ADDR, linkKeyPub: ADDR } };
  const valid = CONTACT_SCHEME + encodeContactCard(card);
  it('the valid one decodes', () => { expect(decodeContactCard(valid)).toMatchObject({ webid: ADDR, displayName: 'Anna' }); });
  it('string mutations: null or a card whose webid is a string', () => {
    const r = rng(13);
    for (let n = 0; n < CASES; n++) {
      const v = call(() => decodeContactCard(mutate(valid, r)));
      if (v && !v.threw) expect(typeof v.webid).toBe('string');
    }
  });
  it('a card cannot choose its own prototype: a `__proto__` in its extra fields refuses the card', () => {
    // hand-made bytes (our encoder never writes this key): version 1 · the webid field · the extra-fields field (15),
    // whose JSON carries an own `__proto__`
    const rest = Buffer.from('{"__proto__":{"bot":true}}');
    const crafted = CONTACT_SCHEME + Buffer.concat([Buffer.from([1, 1, ADDR.length]), Buffer.from(ADDR), Buffer.from([15, rest.length]), rest]).toString('base64url');
    // refused whole (a prototype key is never an honest card's), so nothing can read `bot` off a chosen prototype
    expect(decodeContactCard(crafted)).toBeNull();
  });
});

describe('fuzz: identity link offer', () => {
  it('string and structural mutations: a refusal or a well-typed offer (signature checked by a stand-in)', () => {
    const r = rng(14);
    const body = { v: 2, k: ADDR, w: ADDR, s: 'sig', st: { node: ADDR, nonce: 'n1', delegation: { by: ADDR } } };
    const valid = LINK_OFFER_SCHEME + b64json(body);
    const verify = () => true;   // the parser's shape checks are what is fuzzed here; the signature has its own tests
    expect(parseLinkOffer(valid, { verify })).toMatchObject({ ok: true });
    for (let n = 0; n < CASES; n++) {
      const input = n % 2 ? mutate(valid, r) : LINK_OFFER_SCHEME + b64jsonRaw(JSON.stringify(mutateStructure(body, r)));
      const v = call(() => parseLinkOffer(input, { verify }));
      if (v?.ok) expect([v.root, v.webid, v.botAddress, v.nonce].every((x) => typeof x === 'string' && x)).toBe(true);
    }
  });
});

describe('fuzz: companion claim and bot screen links', () => {
  it('companion claim: null or a code + node', () => {
    const r = rng(15);
    const valid = `Claim: ABCD-EFGH@${ADDR}`;
    for (let n = 0; n < CASES; n++) {
      const v = call(() => parseCompanionClaim(mutate(valid, r)));
      if (v && !v.threw) expect(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v.code) && typeof v.node === 'string').toBe(true);
    }
  });
  it('screen links (the three kinds): a refusal or an answer, never a crash', () => {
    const r = rng(16);
    const app = 'https://onderling.org/basis/';
    const links = [
      [encodeScreenLink(app, { botAddress: ADDR, relayUrl: 'wss://relay.example', nonce: 'n1', botName: 'Huis' }), parseScreenLink],
      [encodeScreenStartLink(app, { botAddress: ADDR, relayUrl: 'wss://relay.example', botName: 'Huis' }), parseScreenStartLink],
      [encodeScreenLaunchLink(app, { botAddress: ADDR, relayUrl: 'wss://relay.example', botName: 'Huis' }), parseScreenLaunchLink],
    ];
    for (let n = 0; n < CASES; n++) {
      const [valid, parse] = links[n % 3];
      call(() => parse(mutate(valid, r)));
    }
  });
});

describe('a prototype key refuses the code, at every decoder', () => {
  // each body is otherwise a valid one for its decoder, plus an own `__proto__` key
  const withProto = (json) => `{"__proto__":{"isAdmin":true},${json.slice(1)}`;
  const b64raw = (json) => Buffer.from(json).toString('base64url');
  const app = 'https://onderling.org/basis/';
  it('enrol offer', () => {
    expect(parseEnrollOffer(ENROLL_SCHEME + b64raw(withProto(`{"v":1,"c":[{"id":"c1","a":"${ADDR}"}]}`)))).toMatchObject({ ok: false });
  });
  it('connection pairing offer', () => {
    expect(parsePairingOffer(CONNECT_SCHEME + b64raw(withProto(`{"v":1,"k":"${ADDR}","n":"n1"}`)))).toMatchObject({ ok: false });
  });
  it('identity link offer and its start link', () => {
    const offer = withProto(`{"v":2,"k":"${ADDR}","w":"${ADDR}","s":"sig","st":{"node":"${ADDR}","nonce":"n1"}}`);
    expect(parseLinkOffer(LINK_OFFER_SCHEME + b64raw(offer), { verify: () => true })).toMatchObject({ ok: false });
    expect(parseLinkStartLink(`${app}#koppel-bot=${b64raw(withProto(`{"v":1,"b":"${ADDR}"}`))}`)).toMatchObject({ ok: false });
  });
  it('the three screen links', () => {
    expect(parseScreenLink(`${app}#scherm=${b64raw(withProto(`{"v":1,"b":"${ADDR}","n":"n1"}`))}`)).toMatchObject({ ok: false });
    for (const [enc, parse] of [[encodeScreenStartLink, parseScreenStartLink], [encodeScreenLaunchLink, parseScreenLaunchLink]]) {
      const frag = enc(app, { botAddress: ADDR }).split('=')[0].split('#')[1];
      expect(parse(`${app}#${frag}=${b64raw(withProto(`{"v":1,"b":"${ADDR}"}`))}`)).toMatchObject({ ok: false });
    }
  });
  it('a pasted invite (raw JSON and base64)', () => {
    const inv = withProto('{"groupId":"g","code":"c"}');
    for (const pasted of [inv, `onderling-invite://${b64raw(inv)}`]) {
      const state = {};
      decodeInvite(pasted, state);
      expect(state.invite ?? null, pasted.slice(0, 30)).toBeNull();
      expect(state.inviteParseError).toBeTruthy();
    }
  });
  it('a recovery file, and the registry sealed inside it', () => {
    const strategy = { open: (sealed) => sealed };   // the seal's own tests cover opening; the parse is what is checked
    expect(() => openRecoveryFile({ strategy, file: withProto(`{"kind":"${RECOVERY_FILE_KIND}","sealed":"x"}`) })).toThrow(/unreadable-file/);
    expect(() => openRecoveryFile({ strategy, file: JSON.stringify({ kind: RECOVERY_FILE_KIND, sealed: withProto('{"a":1}') }) })).toThrow(/unreadable-file/);
  });
});
