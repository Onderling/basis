/**
 * Circle-scoped routing — the S4 journeys J-CS1…J-CS7, as tests.
 *
 * Routing is per-PERSON and circle-blind: it picks the best reachable transport for whoever you are
 * sending to. That is right for a contact and wrong for a circle, because it lets circle content ride a
 * transport the circle does not live on — the failure Frits named: *"each circle maps cleanly to one of
 * those, so hand the transport layer a very limited table of connection options for that circle."*
 *
 * So circle traffic now carries a **scope** — the circle's own connection points, plus whether the user
 * has accepted the address-fallback trade. The scope NARROWS the candidate set; it never replaces route
 * selection. That distinction is the whole design, and it is load-bearing in a way that is easy to get
 * wrong: the first implementation had the scope *replace* selection, which made an offline peer look
 * routable, so the send went nowhere and the hold-forward rung never engaged.
 *
 * These journeys had **no automated coverage at all** before this file — not even the unit tests the S4
 * prep sheet assumed. Everything here was written against the device-walk questions, so a failure names
 * the journey it breaks.
 *
 * Modelled with real `InternalTransport`s on separate buses (the idiom in `sendRouteResolution.test.js`),
 * subclassed only to give a transport the two properties the scope reads: a `url` and alias capability.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };
const HOLD = { ...FAST, guarantee: 'hold-forward' };

/** A transport that advertises a url (a relay the circle can name) and carries per-circle aliases. */
class UrlTransport extends InternalTransport {
  constructor(bus, addr, url) { super(bus, addr); this._url = url; this.sent = []; }
  get url() { return this._url; }
  get supportsAliases() { return true; }
}

/** A transport with no url and no aliases — the NKN/mDNS shape. */
class MeshTransport extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.sent = []; }
  get supportsAliases() { return false; }
}

async function agent(onPeerMessage) {
  return createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });
}

async function until(pred, { timeout = 1500, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return pred();
}

/** Record every envelope a transport actually puts on the wire. */
function watch(transport) {
  const log = [];
  const put = transport._put?.bind(transport);
  if (put) transport._put = async (to, env) => { log.push({ to, env }); return put(to, env); };
  return log;
}

describe('J-CS1 — the circle rides the relay it recorded, and nothing else', () => {
  it('with relay R and NKN both connected, a circle scoped to R goes over R — NKN carries nothing', async () => {
    const busR = new InternalBus();
    const busN = new InternalBus();
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));

    const relayR = new UrlTransport(busR, anna.identity.pubKey, 'ws://relay-r:8787');
    const nkn    = new MeshTransport(busN, anna.identity.pubKey);
    await anna.addSecureTransport('relay', relayR);
    await anna.addSecureTransport('nkn',   nkn);
    // Bram is reachable on BOTH — so if the scope were ignored, NKN would be a live option.
    await bram.addSecureTransport('relay', new UrlTransport(busR, bram.identity.pubKey, 'ws://relay-r:8787'));
    await bram.addSecureTransport('nkn',   new MeshTransport(busN, bram.identity.pubKey));

    const onNkn = watch(nkn);
    const scope = { points: ['ws://relay-r:8787'], requireAliasCapable: true };
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hoi' },
      { ...HOLD, scope });

    expect(r.delivered).toBe(true);
    await until(() => received.find((m) => m.payload?.subtype === 'circle'));
    // The journey's actual question — read the wire, not the UI.
    expect(onNkn, 'circle content appeared on NKN despite the circle riding relay R').toEqual([]);

    await anna.shutdown(); await bram.shutdown();
  });
});

describe('J-CS2 — a local shortcut is still not the circle’s route', () => {
  it('same Wi-Fi, mDNS live: circle content still goes via the relay the circle records', async () => {
    const busR = new InternalBus();
    const busM = new InternalBus();
    const anna = await agent();
    const bram = await agent();

    const relayR = new UrlTransport(busR, anna.identity.pubKey, 'ws://relay-r:8787');
    const mdns   = new MeshTransport(busM, anna.identity.pubKey);
    await anna.addSecureTransport('relay', relayR);
    await anna.addSecureTransport('mdns',  mdns);
    await bram.addSecureTransport('relay', new UrlTransport(busR, bram.identity.pubKey, 'ws://relay-r:8787'));
    await bram.addSecureTransport('mdns',  new MeshTransport(busM, bram.identity.pubKey));

    const onMdns = watch(mdns);
    await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'buren' },
      { ...HOLD, scope: { points: ['ws://relay-r:8787'], requireAliasCapable: true } });

    expect(onMdns, 'a local shortcut carried circle content the circle never chose').toEqual([]);
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('J-CS3 — "unconfigured" means the default, never nowhere', () => {
  it('a circle with no recorded connection point still delivers', async () => {
    const busR = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    await anna.addSecureTransport('relay', new UrlTransport(busR, anna.identity.pubKey, 'ws://default:8787'));
    await bram.addSecureTransport('relay', new UrlTransport(busR, bram.identity.pubKey, 'ws://default:8787'));

    // points: [] — the circle has never been told where it lives.
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hallo' },
      { ...HOLD, scope: { points: [], requireAliasCapable: true } });

    expect(r.delivered, 'an unconfigured circle was treated as unroutable').toBe(true);
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('J-CS4/CS5 — the NKN trade, refused and then accepted', () => {
  it('CS4: fallback OFF ⇒ the message does not go out over the global address, and says why', async () => {
    const busN = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    const nkn  = new MeshTransport(busN, anna.identity.pubKey);
    await anna.addSecureTransport('nkn', nkn);
    await bram.addSecureTransport('nkn', new MeshTransport(busN, bram.identity.pubKey));

    const onNkn = watch(nkn);
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'geheim' },
      { ...HOLD, scope: { points: [], requireAliasCapable: true } });   // fallback OFF

    expect(r.held).toBe(true);
    expect(r.delivered).toBe(false);
    // The reason is the product-visible part: "no route this circle may use" is a standing property of
    // the connection, not a peer who happens to be offline — so it reaches the fallback offer as
    // `blocked` rather than sitting silently in a queue.
    expect(r.reason, 'a scoped-out send must not be reported as a plain offline hold').toBe('no-eligible-route');
    expect(onNkn, 'the global address was used despite the user refusing the fallback').toEqual([]);

    await anna.shutdown(); await bram.shutdown();
  });

  it('CS5: …and it works once she accepts the trade', async () => {
    const busN = new InternalBus();
    const received = [];
    const anna = await agent();
    const bram = await agent((m) => received.push(m));
    await anna.addSecureTransport('nkn', new MeshTransport(busN, anna.identity.pubKey));
    await bram.addSecureTransport('nkn', new MeshTransport(busN, bram.identity.pubKey));

    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'akkoord' },
      { ...HOLD, scope: { points: [], requireAliasCapable: false } });  // fallback ACCEPTED

    expect(r.delivered, 'accepting the trade did not actually unblock the circle').toBe(true);
    expect(await until(() => received.find((m) => m.payload?.subtype === 'circle'))).toBeTruthy();
    await anna.shutdown(); await bram.shutdown();
  });

  it('CS6 (routing half): the trade is per-send, so one circle accepting it cannot re-address another', async () => {
    const busN = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    await anna.addSecureTransport('nkn', new MeshTransport(busN, anna.identity.pubKey));
    await bram.addSecureTransport('nkn', new MeshTransport(busN, bram.identity.pubKey));

    const accepted = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'A' },
      { ...HOLD, scope: { points: [], requireAliasCapable: false } });
    const other    = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'B' },
      { ...HOLD, scope: { points: [], requireAliasCapable: true } });

    expect(accepted.delivered).toBe(true);
    // No state was carried between the two — the second circle is still refused.
    expect(other.held).toBe(true);
    expect(other.reason).toBe('no-eligible-route');
    await anna.shutdown(); await bram.shutdown();
  });
});

describe('J-CS7 — the mixed circle (Frits’ question)', () => {
  it('relay members keep the relay; an NKN-only member is a separate, visible answer either way', async () => {
    const busR = new InternalBus();
    const busN = new InternalBus();
    const anna = await agent();
    const bram = await agent();   // relay, like Anna
    const cato = await agent();   // NKN only

    const relayR = new UrlTransport(busR, anna.identity.pubKey, 'ws://relay-r:8787');
    const nkn    = new MeshTransport(busN, anna.identity.pubKey);
    await anna.addSecureTransport('relay', relayR);
    await anna.addSecureTransport('nkn',   nkn);
    await bram.addSecureTransport('relay', new UrlTransport(busR, bram.identity.pubKey, 'ws://relay-r:8787'));
    await cato.addSecureTransport('nkn',   new MeshTransport(busN, cato.identity.pubKey));

    const scopeStrict = { points: ['ws://relay-r:8787'], requireAliasCapable: true };

    const onNkn = watch(nkn);
    const toBram = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'x' }, { ...HOLD, scope: scopeStrict });
    expect(toBram.delivered, 'the circle flattened to the weakest transport').toBe(true);
    expect(onNkn, 'a relay member’s copy leaked onto NKN because one member is NKN-only').toEqual([]);

    // Cato, with the fallback still OFF. The sheet named two failures to watch for — the circle
    // flattening to the weakest transport (it does not, asserted above) and **Cato silently dropping
    // out**. This is the second one, and it is what actually happens:
    //
    // `canReach` on a relay-like transport is address-agnostic by design ("offline surfaces only as a
    // send failure"), so the relay claims it can reach Cato. The scope agrees — the relay IS the
    // circle's point — so the proactive check passes, the send is attempted over the relay, and it
    // fails there because Cato is not on it. That lands in the REACTIVE hold, whose reason is the
    // generic `unreachable`.
    //
    // So the refusal is real but MUTE: Cato reads as "temporarily offline" rather than "not reachable
    // on this circle's transport, and here is the trade that would fix it". The routing layer cannot
    // tell the difference — proactively, a relay says yes to everyone. Answering it needs membership
    // knowledge the send path does not have. **Open — see REMAINING-WORK.md.**
    const toCatoStrict = await anna.peer.sendTo(cato.identity.pubKey, { subtype: 'circle', text: 'x' }, { ...HOLD, scope: scopeStrict });
    expect(toCatoStrict.held).toBe(true);
    expect(toCatoStrict.delivered).toBe(false);
    expect(toCatoStrict.reason, 'if this ever becomes no-eligible-route, the mute-drop-out is fixed — update the note').toBe('unreachable');

    // …and accepting the trade does NOT rescue him either, which is the sharper half of the finding.
    // Widening the scope adds NKN to the candidate set, but the relay is still first and still claims
    // it can reach anyone, so it is still what gets picked. The trade the user was offered — give up
    // member-level unlinkability to reach this person — cannot deliver what it promises here.
    //
    // Caveat on how far this generalises: `InternalTransport` models the address-agnostic `canReach` of
    // a real relay faithfully, but not its failure semantics. A real relay may accept the frame and
    // drop it silently, in which case the sender sees `delivered` and Cato drops out with no hold at
    // all — worse than this. Which of the two happens is a REAL-RELAY question, deliberately left to
    // the device sitting rather than guessed at here.
    const toCatoOpen = await anna.peer.sendTo(cato.identity.pubKey, { subtype: 'circle', text: 'x' },
      { ...HOLD, scope: { points: ['ws://relay-r:8787'], requireAliasCapable: false } });
    expect(toCatoOpen.delivered).toBe(false);
    expect(toCatoOpen.held).toBe(true);

    await anna.shutdown(); await bram.shutdown(); await cato.shutdown();
  });
});

describe('the rule the design rests on', () => {
  it('the scope NARROWS selection — it does not replace reachability', async () => {
    // The regression this guards: when the scope replaced selection, an offline peer looked routable, so
    // the send went nowhere and hold-forward never engaged. Bram is registered on no bus at all.
    const busR = new InternalBus();
    const anna = await agent();
    const bram = await agent();
    const relayR = new UrlTransport(busR, anna.identity.pubKey, 'ws://relay-r:8787');
    relayR.canReach = () => false;          // nothing is reachable over it right now
    await anna.addSecureTransport('relay', relayR);

    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'later' },
      { ...HOLD, scope: { points: ['ws://relay-r:8787'], requireAliasCapable: true } });

    expect(r.held, 'an unreachable peer was treated as routable — hold-forward never engaged').toBe(true);
    // …and it is an OFFLINE hold, not a scoped-out one: the circle's route is fine, the peer is not there.
    expect(r.reason).toBe('unreachable');
    await anna.shutdown(); await bram.shutdown();
  });
});
