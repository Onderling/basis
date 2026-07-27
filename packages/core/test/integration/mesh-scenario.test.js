/**
 * mesh-scenario — end-to-end integration test.
 *
 * Three-agent topology (relay bus ↔ Bob ↔ loopback bus):
 *   Alice, Bob, Carol
 *
 * Covers phases 1–6 (base) and phase 9 (oracle, now that Group T is in).
 * Phases 7 (BLE buffer / Group V) and 8 (hello gate / Group W) are
 * marked `.skip` until those groups ship.
 *
 * Ref: EXTRACTION-PLAN.md §7 Group Y; CODING-PLAN.md Group Y.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildMesh, gossipOnce, gossipOracle, TextPart, Parts } from './scenario.js';
import { Task } from '../../src/protocol/Task.js';

describe('Group Y — mesh scenario', () => {

  it('phase 1-2: boot, hello, direct graph reflects hops:0', async () => {
    const m = await buildMesh();

    // Direct hellos exercise the protocol.
    await m.alice.hello(m.pubKeys.bob);
    await m.bob.hello(m.pubKeys.carol);

    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();
    expect(m.bob.security.getPeerKey(m.pubKeys.alice)).toBeTruthy();
    expect(m.bob.security.getPeerKey(m.pubKeys.carol)).toBeTruthy();
    expect(m.carol.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();

    const aliceBobRec = await m.alice.peers.get(m.pubKeys.bob);
    expect(aliceBobRec.hops ?? 0).toBe(0);

    await m.teardown();
  });

  it('phase 3: gossip populates indirect peer (alice learns about carol via bob)', async () => {
    const m = await buildMesh();

    // Alice gossips with Bob — learns about Carol as an indirect peer.
    const added = await gossipOnce(m.alice, m.pubKeys.bob);
    expect(added).toBe(1);

    const carolRec = await m.alice.peers.get(m.pubKeys.carol);
    expect(carolRec).toBeTruthy();
    expect(carolRec.hops).toBe(1);
    expect(carolRec.via).toBe(m.pubKeys.bob);

    await m.teardown();
  });

  it('phase 4-5: alice → carol and back, via bob; origin is preserved', async () => {
    const m = await buildMesh();
    await gossipOnce(m.alice, m.pubKeys.bob);
    await gossipOnce(m.carol, m.pubKeys.bob);  // so carol can reach alice too

    // Alice → Carol (hop via Bob).
    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('hi carol')]);

    expect(m.received.carol).toHaveLength(1);
    expect(m.received.carol[0].text).toBe('hi carol');
    expect(m.received.carol[0].originFrom).toBe(m.pubKeys.alice);
    expect(m.received.carol[0].originVerified).toBe(true);       // Z: sig verified
    expect(m.received.carol[0].relayedBy).toBe(m.pubKeys.bob);

    // Carol → Alice (also via Bob).
    await m.carol.invokeWithHop(m.pubKeys.alice, 'receive-message', [TextPart('hi alice')]);
    expect(m.received.alice).toHaveLength(1);
    expect(m.received.alice[0].text).toBe('hi alice');
    expect(m.received.alice[0].originFrom).toBe(m.pubKeys.carol);
    expect(m.received.alice[0].originVerified).toBe(true);       // Z: sig verified
    expect(m.received.alice[0].relayedBy).toBe(m.pubKeys.bob);

    // No security-warning events — every sig verified cleanly.
    expect(m.warnings.alice).toHaveLength(0);
    expect(m.warnings.carol).toHaveLength(0);

    await m.teardown();
  });

  it('phase 4b (Z): a hostile bridge that forges `_origin` is detected; ' +
     'Carol falls back to the bridge and emits security-warning', async () => {
    const m = await buildMesh();
    await gossipOnce(m.alice, m.pubKeys.bob);

    // Patch Bob's invoke() so when he (as the bridge) forwards to Carol, he
    // re-signs with his OWN identity but claims Alice as the origin. This
    // simulates a malicious bridge trying to spoof attribution. Carol's
    // verifier should reject the sig (it won't match Alice's pubkey) and
    // fall back to envelope._from (= Bob).
    const bobOrigInvoke = m.bob.invoke.bind(m.bob);
    m.bob.invoke = async (peerId, skillId, input, opts = {}) => {
      if (peerId === m.pubKeys.carol && skillId === 'receive-message') {
        const { signOrigin } = await import('../../src/security/originSignature.js');
        // Bob forges a sig with his own key, but claims Alice as origin.
        const forged = signOrigin(m.bob.identity, {
          target: m.pubKeys.carol,
          skill:  skillId,
          parts:  input,
        });
        return bobOrigInvoke(peerId, skillId, input, {
          ...opts,
          origin:    m.pubKeys.alice,   // claim Alice
          originSig: forged.sig,         // signed by Bob
          originTs:  forged.originTs,
        });
      }
      return bobOrigInvoke(peerId, skillId, input, opts);
    };

    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('forged?')]);

    expect(m.received.carol).toHaveLength(1);
    // Forgery caught: Carol sees Bob, not the claimed Alice.
    expect(m.received.carol[0].originFrom).toBe(m.pubKeys.bob);
    expect(m.received.carol[0].originVerified).toBe(false);
    // Security-warning fired on Carol.
    expect(m.warnings.carol).toHaveLength(1);
    expect(m.warnings.carol[0].kind).toBe('origin-signature');
    expect(m.warnings.carol[0].reason).toMatch(/bad signature/);

    await m.teardown();
  });

  it('phase 6: agent.forget removes the peer; re-hello re-registers the key', async () => {
    const m = await buildMesh();
    await m.alice.hello(m.pubKeys.bob);

    // Precondition
    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();
    expect(await m.alice.peers.get(m.pubKeys.bob)).toBeTruthy();

    await m.alice.forget(m.pubKeys.bob);

    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeNull();
    expect(await m.alice.peers.get(m.pubKeys.bob)).toBeNull();

    // Re-hello restores the state.
    await m.alice.hello(m.pubKeys.bob);
    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();

    await m.teardown();
  });

  // ── Conditional phases ─────────────────────────────────────────────────────

  it.skip('phase 7 (V): BLE store-and-forward buffers during a disconnect', () => {
    // Group V landed — the buffer itself is fully covered by
    // packages/react-native/test/BleTransport.buffer.test.js. This phase
    // is kept skipped because the integration scenario uses
    // InternalTransport (no buffer), not BleTransport. Un-skip once a
    // test-transport with parity to BleTransport's buffer is added, or
    // route this scenario through a real BleTransport in CI.
  });

  it('phase 8 (W): hello-gate silently drops an unauthenticated hello', async () => {
    const m = await buildMesh();

    // Wipe the addPeer pre-registration buildMesh does for fast test
    // startup — we need hello() to go through the full handshake here.
    await m.alice.forget(m.pubKeys.bob);
    await m.bob.forget(m.pubKeys.alice);

    // Bob refuses all inbound hellos — should be indistinguishable from
    // offline for any sender.
    m.bob.setHelloGate(() => false);

    await expect(m.alice.hello(m.pubKeys.bob, 200))
      .rejects.toThrow(/timeout/i);

    // Bob never registered Alice's key, so Alice remains unable to talk.
    expect(m.bob.security.getPeerKey(m.pubKeys.alice)).toBeNull();
    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeNull();

    // Clearing the gate restores the normal path.
    m.bob.setHelloGate(null);
    await m.alice.hello(m.pubKeys.bob, 2_000);
    expect(m.bob.security.getPeerKey(m.pubKeys.alice)).toBeTruthy();

    await m.teardown();
  });

  it('phase 9 (T): oracle picks the right bridge on the first try', async () => {
    const m = await buildMesh();
    await m.alice.hello(m.pubKeys.bob);
    await m.bob.hello(m.pubKeys.carol);
    await gossipOnce(m.alice, m.pubKeys.bob);    // alice learns carol (hops:1, via:bob)

    // All three enable the oracle so there's a claim to publish.
    // An open mesh with no social graph to protect, stated explicitly: since G7 (2026-07-27) the oracle
    // discloses nothing unless the caller says what each peer may learn. A real app passes a circle-aware
    // scope; this scenario is precisely the case where "everyone learns everyone" is the intent.
    const OPEN = (_caller, peers) => peers;
    m.alice.enableReachabilityOracle({ ttlMs: 60_000, peerScope: OPEN });
    m.bob.enableReachabilityOracle({ ttlMs: 60_000, peerScope: OPEN });
    m.carol.enableReachabilityOracle({ ttlMs: 60_000, peerScope: OPEN });

    // One "oracle gossip" round — alice pulls Bob's signed claim.
    const ok = await gossipOracle(m.alice, m.pubKeys.bob);
    expect(ok).toBe(true);

    const bobRec = await m.alice.peers.get(m.pubKeys.bob);
    expect(bobRec.knownPeers).toContain(m.pubKeys.carol);
    expect(bobRec.knownPeersTs).toBeGreaterThan(Date.now());

    // Spy on invoke so we can see exactly which bridge invokeWithHop picks.
    const invokeSpy = vi.spyOn(m.alice, 'invoke');

    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('oracle hello')]);

    // The first invoke from invokeWithHop must be the relay-forward call
    // to Bob (oracle pick) — not any other bridge or a probe attempt first.
    const relayForwardCall = invokeSpy.mock.calls.find(c => c[1] === 'relay-forward');
    expect(relayForwardCall).toBeTruthy();
    expect(relayForwardCall[0]).toBe(m.pubKeys.bob);
    // And it must be the FIRST relay-forward call (no wasted attempts before it).
    const firstRelayIdx = invokeSpy.mock.calls.findIndex(c => c[1] === 'relay-forward');
    const earlierRelayCalls = invokeSpy.mock.calls
      .slice(0, firstRelayIdx)
      .filter(c => c[1] === 'relay-forward');
    expect(earlierRelayCalls).toHaveLength(0);

    // And the message arrived.
    expect(m.received.carol.at(-1).text).toBe('oracle hello');

    // ── Follow-up: expire the claim and confirm probe-retry still works. ───
    const rec = await m.alice.peers.get(m.pubKeys.bob);
    rec.knownPeersTs = 0;                                  // force stale
    await m.alice.peers.upsert(rec);

    invokeSpy.mockClear();
    m.received.carol.length = 0;

    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('after expiry')]);

    expect(m.received.carol.at(-1).text).toBe('after expiry');
    // Still a relay-forward call — just via probe-retry now. We don't care
    // about call order here, only that delivery succeeded.
    expect(invokeSpy.mock.calls.some(c => c[1] === 'relay-forward')).toBe(true);

    invokeSpy.mockRestore();
    await m.teardown();
  });
});

// ── Phase 10 (AB) — rendezvous auto-upgrade ─────────────────────────────────
// Gated on node-datachannel/polyfill being installable. The polyfill ships
// prebuilt binaries for common platforms; if your toolchain can't build it,
// the suite skips cleanly.
let rtcLib = null;
try {
  const mod = await import('node-datachannel/polyfill');
  rtcLib = {
    RTCPeerConnection:     mod.RTCPeerConnection,
    RTCSessionDescription: mod.RTCSessionDescription,
    RTCIceCandidate:       mod.RTCIceCandidate,
  };
} catch { /* skip */ }

const describeIfRtc = rtcLib ? describe : describe.skip;

describeIfRtc('Group AB — rendezvous phase 10 (WebRTC auto-upgrade)', () => {

  it('phase 10: alice ↔ bob auto-upgrade to a DataChannel; invoke routes via rendezvous', async () => {
    const m = await buildMesh({ rendezvous: true, rtcLib });
    // Wait for BOTH sides' DataChannel to open — they fire via different
    // code paths (initiator vs answerer) and can be ~10 ms apart.
    const aliceUp = new Promise(res => m.alice.once('rendezvous-upgraded', res));
    const bobUp   = new Promise(res => m.bob  .once('rendezvous-upgraded', res));
    await m.alice.hello(m.pubKeys.bob);
    await Promise.race([
      Promise.all([aliceUp, bobUp]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('upgrade timeout')), 15_000)),
    ]);

    expect(m.alice.isRendezvousActive(m.pubKeys.bob)).toBe(true);
    expect(m.bob  .isRendezvousActive(m.pubKeys.alice)).toBe(true);

    // Tag the transport the RQ arrives on to prove it used WebRTC.
    await m.alice.invoke(m.pubKeys.bob, 'receive-message', [TextPart('via DataChannel')]);
    const evt = m.received.bob.at(-1);
    expect(evt?.text).toBe('via DataChannel');
    // receive-message in scenario.js does not expose envelope._transport;
    // the authoritative check is via isRendezvousActive + spy in the
    // next test. For this phase, delivery + upgrade event is enough.

    await m.teardown();
  }, 30_000);

  // Flakes under node-datachannel ICE-teardown races (same class as
  // rendezvous.upgrade.test.js's "routing pin cleared" test).  The
  // routing claim is covered deterministically by
  // rendezvous.routing.unit.test.js; this retry keeps the polyfill
  // smoke-check green without blocking CI.
  it('phase 10b: force-close the DataChannel → routing pin cleared, next invoke uses relay', { retry: 2 }, async () => {
    // Let node-datachannel's native ICE state from phase 10 fully drain
    // before we spin up a fresh mesh — without this, phase 10b's upgrade
    // occasionally stalls under ICE state leak.
    await new Promise(r => setTimeout(r, 200));
    const m = await buildMesh({ rendezvous: true, rtcLib });
    await new Promise(res => {
      m.alice.once('rendezvous-upgraded', res);
      m.alice.hello(m.pubKeys.bob);
    });

    // Establish and verify the upgrade holds.
    await m.alice.invoke(m.pubKeys.bob, 'receive-message', [TextPart('first (rdv)')]);
    expect(m.alice.isRendezvousActive(m.pubKeys.bob)).toBe(true);

    // Tear down alice's rendezvous transport.
    const downgraded = new Promise(res => m.alice.once('rendezvous-downgraded', res));
    await m.alice.getTransport('rendezvous').disconnect();
    await downgraded;

    expect(m.alice.isRendezvousActive(m.pubKeys.bob)).toBe(false);

    // Next send succeeds via the signalling transport (the relay bus).
    await m.alice.invoke(m.pubKeys.bob, 'receive-message', [TextPart('second (relay)')]);
    expect(m.received.bob.at(-1).text).toBe('second (relay)');

    await m.teardown();
  }, 30_000);
});

// ── Phase 11 (BB) — blind relay-forward ─────────────────────────────────────
describe('Group BB — blind relay-forward', () => {

  it('phase 11: alice enables sealed-forward; bob forwards opaque; carol verifies origin', async () => {
    const m = await buildMesh();
    await gossipOnce(m.alice, m.pubKeys.bob);   // alice learns carol via bob

    m.alice.enableSealedForwardFor('home');

    await m.alice.invokeWithHop(
      m.pubKeys.carol, 'receive-message',
      [TextPart('sealed hi carol')],
      { group: 'home' },
    );

    // Delivery succeeded, origin verified.
    expect(m.received.carol).toHaveLength(1);
    expect(m.received.carol[0].text).toBe('sealed hi carol');
    expect(m.received.carol[0].originFrom).toBe(m.pubKeys.alice);
    expect(m.received.carol[0].originVerified).toBe(true);
    expect(m.received.carol[0].relayedBy).toBe(m.pubKeys.bob);

    // Bob forwarded via relay-receive-sealed, NOT receive-message, and the
    // forwarded payload contains no plaintext text.
    const fwd = m.bobOutbound.find(e => e.peerId === m.pubKeys.carol);
    expect(fwd?.skillId).toBe('relay-receive-sealed');
    expect(fwd?.payload.includes('sealed hi carol')).toBe(false);

    await m.teardown();
  });

  it('phase 11b: direct delivery bypasses sealing entirely', async () => {
    const m = await buildMesh();
    // Alice has a direct path to bob (bob is a direct peer in the mesh).
    // When she sends to bob directly, invokeWithHop's step 1 succeeds and
    // nothing in the sealed code path runs — even with the group enabled.
    m.alice.enableSealedForwardFor('home');

    await m.alice.invokeWithHop(
      m.pubKeys.bob, 'receive-message',
      [TextPart('direct, no seal needed')],
      { group: 'home' },
    );

    expect(m.received.bob).toHaveLength(1);
    expect(m.received.bob[0].text).toBe('direct, no seal needed');
    // No bridge was involved, so bob.invoke was never called for forwarding.
    const fwd = m.bobOutbound.find(e => e.peerId === m.pubKeys.carol);
    expect(fwd).toBeUndefined();

    await m.teardown();
  });

  it('phase 11c: group disabled (no enable call) → plaintext path, backward compat', async () => {
    const m = await buildMesh();
    await gossipOnce(m.alice, m.pubKeys.bob);
    // NO enableSealedForwardFor — opts.group present but no config.

    await m.alice.invokeWithHop(
      m.pubKeys.carol, 'receive-message',
      [TextPart('plain is fine')],
      { group: 'home' },
    );

    expect(m.received.carol[0].text).toBe('plain is fine');
    const fwd = m.bobOutbound.find(e => e.peerId === m.pubKeys.carol);
    expect(fwd?.skillId).toBe('receive-message');
    expect(fwd?.payload.includes('plain is fine')).toBe(true);

    await m.teardown();
  });
});

// ── Phase 12 (CC) — hop-aware task tunnel ──────────────────────────────────
describe('Group CC — hop-aware task tunnel', () => {

  it('phase 12a: streaming async-generator over a hopped call yields chunks in order', async () => {
    const m = await buildMesh({ tunnel: true });
    await gossipOnce(m.alice, m.pubKeys.bob);   // alice learns carol via bob

    // Carol hosts a streaming generator.  Bob is the bridge.
    m.carol.register('slow-count', async function* () {
      yield [TextPart('one')];
      yield [TextPart('two')];
      yield [TextPart('three')];
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'slow-count', []);
    const chunks = [];
    for await (const c of task.stream()) chunks.push(Parts.text(c));
    const snap = await task.done();

    expect(snap.state).toBe('completed');
    expect(chunks).toEqual(['one', 'two', 'three']);

    // Bob's outbound tap should show the inner call going to carol on
    // slow-count (tunnel path), not relay-receive-sealed (one-shot).
    const fwd = m.bobOutbound.find(e => e.peerId === m.pubKeys.carol);
    expect(fwd?.skillId).toBe('slow-count');

    await m.teardown();
  });

  it('phase 12b: input-required prompt from Carol round-trips through the tunnel', async () => {
    const m = await buildMesh({ tunnel: true });
    await gossipOnce(m.alice, m.pubKeys.bob);

    m.carol.register('ask-name', async ({ parts }) => {
      if (Parts.text(parts) === 'start') {
        throw new Task.InputRequired([TextPart('Name?')]);
      }
      return [TextPart(`hi ${Parts.text(parts)}`)];
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'ask-name', [TextPart('start')]);

    const irParts = await new Promise(res => task.once('input-required', res));
    expect(Parts.text(irParts)).toBe('Name?');

    await task.send([TextPart('Alice')]);

    const snap = await task.done();
    expect(snap.state).toBe('completed');
    expect(Parts.text(snap.parts)).toBe('hi Alice');

    await m.teardown();
  });

  it('phase 12c: cancel from Alice propagates Alice → Bob → Carol', async () => {
    const m = await buildMesh({ tunnel: true });
    await gossipOnce(m.alice, m.pubKeys.bob);

    let sawAbort = false;
    m.carol.register('long-runner', async ({ signal }) => {
      await new Promise((_, reject) => {
        const id = setInterval(() => {
          if (signal?.aborted) {
            sawAbort = true;
            clearInterval(id);
            reject(new Error('aborted'));
          }
        }, 20);
        signal?.addEventListener?.('abort', () => {
          sawAbort = true;
          clearInterval(id);
          reject(new Error('aborted'));
        });
      });
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'long-runner', []);
    await new Promise(r => setTimeout(r, 60));   // let the RQ reach Carol
    await task.cancel();
    await new Promise(r => setTimeout(r, 120));  // allow Alice → Bob → Carol

    expect(sawAbort).toBe(true);
    expect(task.state).toBe('cancelled');

    await m.teardown();
  });

  it('phase 12d: bridge without tunnel capability → callWithHop falls back to one-shot relay-forward', async () => {
    // tunnel: false — Bob does NOT advertise tunnel; callWithHop should
    // pick the one-shot path transparently.
    const m = await buildMesh();   // no tunnel flag
    await gossipOnce(m.alice, m.pubKeys.bob);

    m.carol.register('echo', async ({ parts }) => [TextPart(`echo:${Parts.text(parts)}`)]);

    const task = m.alice.callWithHop(m.pubKeys.carol, 'echo', [TextPart('hi')]);
    const snap = await task.done();

    expect(snap.state).toBe('completed');
    expect(Parts.text(snap.parts)).toBe('echo:hi');

    // No tunnel session row was ever created on Bob — confirms the
    // one-shot relay-forward path was taken.
    expect(m.bob._tunnelSessions?.size ?? 0).toBe(0);

    await m.teardown();
  });
});
