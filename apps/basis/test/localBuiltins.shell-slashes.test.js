/**
 * basis — chat-shell slash handlers, dispatch-wiring tests.
 *
 * Sibling file to localBuiltins.test.js: keeps the slash-audit-2026-05-27
 * "uncovered residue" suite (/dm, /send-to, /apps on|off, /peer-connect,
 * /test-peer, /transports, /transport-mode, /set-relay, /debug-dump,
 * /reset-thread) in its own file so the host-op fixtures don't bloat
 * the primary template.
 *
 * Pattern matches localBuiltins.test.js — instantiate createLocalBuiltins
 * with focused dep stubs + invoke the handler directly.  The TEST's job
 * is to verify dispatch wiring + reply shape, not the underlying
 * transport.  Where a dep is hard to stand up (secure-agent's relay /
 * vault), we mock with a vi.fn and assert the call shape.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import { basisManifest }              from '../manifest.js';
import { mergeManifests }                  from '../src/manifestMerge.js';
import { createLocalBuiltins }             from '../src/core/localBuiltins.js';
import { initLocalisation, t }             from '../src/localisation.js';
import { ThreadStore }                     from '../src/threadStore.js';
import { AppRegistry }                     from '../src/appRegistry.js';

beforeAll(async () => {
  await initLocalisation({ lng: 'en' });
});

const emptyCatalog = () => mergeManifests([{ manifest: basisManifest }]);

/** Hand-rolled catalog stub matching the shape /send-to + /embed read:
 *   - opsById is iterable ([opId, entry] pairs)
 *   - embedSnapshotFor(opId) returns { snapshotSkill, appOrigin } for the
 *     first op that declares one.
 * Bypasses the manifest validator (which rejects unknown chat.reply
 * shapes); we are testing dispatch-wiring, not manifest validation. */
function catalogWithEmbedFactory({ opId = 'cardSnap', appOrigin = 'household',
                                   snapshotSkill = 'cardSnap' } = {}) {
  return {
    opsById: new Map([[opId, { op: { id: opId }, appOrigin }]]),
    embedSnapshotFor: (id) => (id === opId ? { snapshotSkill, appOrigin } : undefined),
    appOrigins: [appOrigin],
    commandMenu: [],
  };
}

/* ─────────── 1. /dm — DM thread spawn ─────────── */

describe('/dm', () => {
  let store;
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
  });

  it('creates a new DM thread with the given peer + activates it', async () => {
    const setActiveCalls = [];
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t,
      threadStore: store,
      setActive: (id) => setActiveCalls.push(id),
    });
    const r = await builtins.startDm({ webid: 'webid:anne@pod.example' });
    expect(r.ok).toBe(true);
    expect(r.threadId).toBeTruthy();
    expect(r.message).toMatch(/Started DM/);
    const thread = store.getThread(r.threadId);
    expect(thread).toBeTruthy();
    expect(thread.filter.dm).toBe(true);
    expect(thread.filter.actors).toContain('webid:anne@pod.example');
    expect(setActiveCalls).toEqual([r.threadId]);
  });

  it('re-uses an existing DM thread with the same peer (idempotent)', async () => {
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t,
      threadStore: store,
      setActive: () => {},
    });
    const r1 = await builtins.startDm({ webid: 'webid:bob' });
    const sizeAfter = store.size;
    const r2 = await builtins.startDm({ webid: 'webid:bob' });
    expect(r2.threadId).toBe(r1.threadId);
    expect(store.size).toBe(sizeAfter);
    expect(r2.message).toMatch(/Opened DM/);
  });

  it('rejects when no peer id is supplied', async () => {
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, threadStore: store, setActive: () => {},
    });
    const r = await builtins.startDm({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webid or peer address/);
  });
});

/* ─────────── 2. /send-to — sim-peers cross-thread synthesis ─────────── */

describe('/send-to', () => {
  let store, simPeers;

  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main',  name: 'Main' });
    store.createThread({ id: 'anne',  name: 'Anne' });
    simPeers = { anne: { threadId: 'anne', webid: 'webid:anne' } };
  });

  it("synthesises an embed-card into the peer's thread + reports success", async () => {
    const catalog  = catalogWithEmbedFactory();
    const callSkill = vi.fn(async () => ({
      id: 'c-1', title: 'Dishwasher', type: 'chore', state: 'open',
    }));
    const builtins = createLocalBuiltins({
      catalog, t,
      threadStore: store,
      callSkill,
      localActor: 'webid:me',
      simPeers,
    });
    const r = await builtins.sendto({ peer: 'anne', itemId: 'c-1' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Dishwasher/);
    expect(r.message).toMatch(/anne/);
    expect(callSkill).toHaveBeenCalledWith('household', 'cardSnap', { choreId: 'c-1' });
    // The peer's thread should now hold the embed-card shell message.
    const anneThread = store.getThread('anne');
    const last = anneThread.messages.at(-1);
    expect(last.origin).toBe('shell');
    expect(last.rendered.kind).toBe('embed-card');
    expect(last.rendered.embed.snapshot.id).toBe('c-1');
    expect(last.rendered.embed.issuedBy).toBe('webid:me');
  });

  it('rejects unknown peer', async () => {
    const builtins = createLocalBuiltins({
      catalog: catalogWithEmbedFactory(), t,
      threadStore: store, callSkill: vi.fn(), simPeers,
    });
    const r = await builtins.sendto({ peer: 'mallory', itemId: 'c-1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown peer/);
  });

  it('rejects missing args (no peer / no itemId)', async () => {
    const builtins = createLocalBuiltins({
      catalog: catalogWithEmbedFactory(), t,
      threadStore: store, callSkill: vi.fn(), simPeers,
    });
    const r1 = await builtins.sendto({});
    const r2 = await builtins.sendto({ peer: 'anne' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/peer/);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/item id/);
  });
});

/* ─────────── 3. /apps on/off — positional-arg toggle ─────────── */

describe('/apps on|off', () => {
  it('enables an app via positional args parsed from _match', async () => {
    const registry = new AppRegistry();
    registry.syncWithCatalog(['household', 'stoop']);
    registry.setEnabled('stoop', false);
    const catalog = emptyCatalog();
    const builtins = createLocalBuiltins({ catalog, t, appRegistry: registry });
    const r = await builtins.apps({ _match: 'on stoop' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/enabled/);
    expect(registry.isEnabled('stoop')).toBe(true);
  });

  it('disables an app via positional args', async () => {
    const registry = new AppRegistry();
    registry.syncWithCatalog(['household']);
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, appRegistry: registry,
    });
    const r = await builtins.apps({ _match: 'off household' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/disabled/);
    expect(registry.isEnabled('household')).toBe(false);
  });

  it('accepts explicit action+app args (not just _match)', async () => {
    const registry = new AppRegistry();
    registry.syncWithCatalog(['folio']);
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, appRegistry: registry,
    });
    const r = await builtins.apps({ action: 'off', app: 'folio' });
    expect(r.ok).toBe(true);
    expect(registry.isEnabled('folio')).toBe(false);
  });

  it('rejects an unknown action', async () => {
    const registry = new AppRegistry();
    registry.syncWithCatalog(['household']);
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, appRegistry: registry,
    });
    const r = await builtins.apps({ _match: 'toggle household' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown action/);
  });

  it('reports missing-name when action is given without an app', async () => {
    const registry = new AppRegistry();
    registry.syncWithCatalog(['household']);
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, appRegistry: registry,
    });
    const r = await builtins.apps({ _match: 'on' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name an app/);
  });
});

/* ─────────── 4. /peer-connect — connectPeer wiring ─────────── */

describe('/peer-connect', () => {
  it('invokes connectPeer + reports the resulting address', async () => {
    const connectPeer = vi.fn(async () => ({ address: 'app.deadbeef.1234' }));
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, connectPeer,
    });
    const r = await builtins['peer-connect']({});
    expect(connectPeer).toHaveBeenCalledTimes(1);
    expect(r.message).toMatch(/app\.deadbeef\.1234/);
    expect(r.message).toMatch(/Connected to NKN/);
  });

  it('returns an error when connectPeer rejects', async () => {
    const connectPeer = vi.fn(async () => { throw new Error('relay-unreachable'); });
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, connectPeer,
    });
    const r = await builtins['peer-connect']({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/relay-unreachable/);
  });

  it('reports unavailable when no connectPeer dep is wired', async () => {
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t });
    const r = await builtins['peer-connect']({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available/);
  });
});

/* ─────────── 5. /test-peer — ping over agent.sendPeerMessage ─────────── */

describe('/test-peer', () => {
  it('sends a p2p-chat envelope to the supplied address', async () => {
    const sendPeerMessage = vi.fn(async () => true);
    const agent = {
      sendPeerMessage,
      peer: { status: 'connected', address: 'app.me' },
    };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['test-peer']({ addr: 'app.peer.7777', text: 'howdy' });
    expect(sendPeerMessage).toHaveBeenCalledTimes(1);
    const [addr, env] = sendPeerMessage.mock.calls[0];
    expect(addr).toBe('app.peer.7777');
    expect(env).toMatchObject({
      type:    'p2p-chat',
      subtype: 'chat-message',
      body:    'howdy',
    });
    expect(typeof env.sentAt).toBe('number');
    expect(r.message).toMatch(/Sent/);
    expect(r.message).toMatch(/app\.peer\.7777/);
  });

  it("defaults the text to 'hello' when none supplied", async () => {
    const sendPeerMessage = vi.fn(async () => true);
    const agent = { sendPeerMessage, peer: { status: 'connected' } };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    await builtins['test-peer']({ addr: 'app.peer' });
    expect(sendPeerMessage.mock.calls[0][1].body).toBe('hello');
  });

  it('rejects when not yet connected', async () => {
    const agent = { sendPeerMessage: vi.fn(), peer: { status: 'idle' } };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['test-peer']({ addr: 'app.x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not connected/);
    expect(agent.sendPeerMessage).not.toHaveBeenCalled();
  });

  it('rejects without an address', async () => {
    const agent = {
      sendPeerMessage: vi.fn(), peer: { status: 'connected' },
    };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['test-peer']({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/peer NKN address/);
  });

  // 2026-05-27 slash audit close-out — manifest param is now `addr`
  // (matches the locale contract); the legacy `address` arg name still
  // works for back-compat with any external caller.
  it('accepts the legacy `address` arg name for back-compat', async () => {
    const sendPeerMessage = vi.fn(async () => true);
    const agent = { sendPeerMessage, peer: { status: 'connected' } };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['test-peer']({ address: 'app.legacy.peer', text: 'hi' });
    expect(sendPeerMessage).toHaveBeenCalledTimes(1);
    expect(sendPeerMessage.mock.calls[0][0]).toBe('app.legacy.peer');
    expect(r.message).toMatch(/app\.legacy\.peer/);
  });
});

/* ─────────── 6. /transports — pure status formatter ─────────── */

describe('/transports', () => {
  it('returns a record reply with nkn + relay side-by-side fields', async () => {
    const agent = {
      transportMode: 'both',
      peer:  { status: 'connected', address: 'app.me' },
      relay: { status: 'connected', url: 'wss://relay.example', error: null },
    };
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['transports']();
    expect(r.title).toMatch(/Transports/i);
    expect(r.mode).toBe('both');
    expect(r.nknStatus).toBe('connected');
    expect(r.peerAddress).toBe('app.me');
    expect(r.relayStatus).toBe('connected');
    expect(r.relayUrl).toBe('wss://relay.example');
    expect(r.relayError).toBeNull();
  });

  it('fills defaults when peer/relay fields are missing', async () => {
    const agent = {}; // no peer / relay / mode
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['transports']();
    expect(r.mode).toBe('nkn');
    expect(r.nknStatus).toBe('idle');
    expect(r.peerAddress).toBe('(none)');
    expect(r.relayStatus).toBe('idle');
    expect(r.relayUrl).toBe('(none)');
  });

  it('reports no_substrate when agent is missing', async () => {
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t });
    const r = await builtins['transports']();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Transport-mode control not wired/);
  });
});

/* ─────────── 7. /transport-mode — vault persistence + validation ─── */

describe('/transport-mode', () => {
  function makeAgent() {
    // The register is the one home (device-params consolidation): the builtin writes through the
    // kind-gated set-param; realAgent's set-param hook applies it to the live router.
    return { callSkill: vi.fn(async () => ({ ok: true })) };
  }

  it('persists the mode through the one kind-gated write (nkn)', async () => {
    const agent = makeAgent();
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['transport-mode']({ mode: 'nkn' });
    expect(r.ok).toBe(true);
    expect(agent.callSkill).toHaveBeenCalledWith('params', 'set-param', { key: 'transport.mode', value: 'nkn' });
    expect(r.message).toMatch(/Transport mode set/);
  });

  it('accepts the "both" mode', async () => {
    const agent = makeAgent();
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['transport-mode']({ mode: 'both' });
    expect(r.ok).toBe(true);
    expect(agent.callSkill).toHaveBeenCalledWith('params', 'set-param', { key: 'transport.mode', value: 'both' });
  });

  it('rejects an invalid mode', async () => {
    const agent = makeAgent();
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['transport-mode']({ mode: 'tcp' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bad mode/);
    expect(agent.callSkill).not.toHaveBeenCalled();
  });

  it('reports no_substrate when the agent lacks a callSkill', async () => {
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t,
      agent: {},
    });
    const r = await builtins['transport-mode']({ mode: 'nkn' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Transport-mode control not wired/);
  });
});

/* ─────────── 8. /set-relay — relay URL persist + clear path ─────────── */

describe('/set-relay', () => {
  function makeAgent({ relayStatus = 'idle' } = {}) {
    return {
      vault:  { set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
      relay: {
        status:     relayStatus,
        address:    'relay.app.me',
        connect:    vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
      },
    };
  }

  it('persists the URL + connects via sa.relay.connect', async () => {
    const agent = makeAgent();
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['set-relay']({ url: 'wss://relay.example:9090' });
    expect(r.ok).toBe(true);
    expect(agent.vault.set).toHaveBeenCalledWith('cc-relay-url', 'wss://relay.example:9090');
    expect(agent.relay.connect).toHaveBeenCalledWith({ relayUrl: 'wss://relay.example:9090' });
    expect(r.message).toMatch(/Relay connected/);
    expect(r.message).toMatch(/wss:\/\/relay\.example:9090/);
  });

  it('disconnects-before-reconnect when already connected', async () => {
    const agent = makeAgent({ relayStatus: 'connected' });
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    await builtins['set-relay']({ url: 'wss://relay2.example' });
    expect(agent.relay.disconnect).toHaveBeenCalledTimes(1);
    expect(agent.relay.connect).toHaveBeenCalledWith({ relayUrl: 'wss://relay2.example' });
  });

  it('--clear disconnects + drops the persisted URL', async () => {
    const agent = makeAgent({ relayStatus: 'connected' });
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['set-relay']({ clear: true });
    expect(r.ok).toBe(true);
    expect(agent.relay.disconnect).toHaveBeenCalledTimes(1);
    expect(agent.vault.delete).toHaveBeenCalledWith('cc-relay-url');
    expect(r.message).toMatch(/Relay cleared/);
  });

  it('rejects a URL missing the ws:// scheme', async () => {
    const agent = makeAgent();
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['set-relay']({ url: 'relay.example' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bad relay URL/);
    expect(agent.relay.connect).not.toHaveBeenCalled();
  });

  it('reports no_substrate when agent.relay is absent', async () => {
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t,
      agent: { vault: { set: vi.fn() } }, // no relay
    });
    const r = await builtins['set-relay']({ url: 'wss://x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Relay support not wired/);
  });
});

/* ─────────── 9. /debug-dump — sa.recentTraffic snapshot formatter ─── */

describe('/debug-dump', () => {
  function makeSa({ recent = [], status = {} } = {}) {
    return {
      sa: {
        securityStatus: () => ({
          identityPub:           'pub-abcd',
          identityStable:        'stable-1',
          peerTransportConnected: true,
          peerAddress:           'app.me',
          helloedPeerCount:      2,
          layerWired:            true,
          muteCount:             1,
          muteIsPersistent:      true,
          auditSize:             5,
          auditAutoLog:          true,
          ...status,
        }),
        recentTraffic: () => recent,
      },
    };
  }

  it('renders identity + peer + safety + recent-traffic snapshot', async () => {
    const agent = makeSa({
      recent: [
        { ts: 1_700_000_000_000, dir: 'send', to: 'app.peer.aaaa', subtype: 'chat-message', size: 42 },
        { ts: 1_700_000_001_000, dir: 'recv', from: 'app.peer.bbbb', subtype: 'file-share', size: 1024 },
      ],
    });
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['debug-dump']();
    expect(r.message).toMatch(/basis debug-dump/);
    expect(r.message).toMatch(/pub-abcd/);
    expect(r.message).toMatch(/stable-1/);
    expect(r.message).toMatch(/app\.me/);
    expect(r.message).toMatch(/HI'd peers: 2/);
    expect(r.message).toMatch(/SecurityLayer: on/);
    expect(r.message).toMatch(/Audit chain:\s+5 entries/);
    // Recent traffic block
    expect(r.message).toMatch(/Last 2 envelopes/);
    expect(r.message).toMatch(/send/);
    expect(r.message).toMatch(/chat-message/);
    expect(r.message).toMatch(/file-share/);
  });

  it('handles the empty-recent-buffer case', async () => {
    const agent = makeSa({ recent: [] });
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t, agent });
    const r = await builtins['debug-dump']();
    expect(r.message).toMatch(/No peer traffic recorded yet/);
  });

  it('returns an error when agent.sa is missing', async () => {
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, agent: {},
    });
    const r = await builtins['debug-dump']();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Debug dump not available/);
  });
});

/* ─────────── 10. /reset-thread — threadStore active-thread clear ─── */

describe('/reset-thread', () => {
  let store;
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
  });

  it('clears the active thread messages + reports done', async () => {
    const active = store.getActiveThread();
    active.messages.push({ kind: 'user-message', text: 'hi' });
    active.messages.push({ kind: 'shell-message', text: 'reply' });
    expect(active.messages.length).toBe(2);

    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, threadStore: store,
    });
    const r = await builtins['reset-thread']();
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Thread cleared/);
    expect(active.messages.length).toBe(0);
  });

  it('reports no_thread when there is no active thread', async () => {
    const empty = new ThreadStore();
    const builtins = createLocalBuiltins({
      catalog: emptyCatalog(), t, threadStore: empty,
    });
    const r = await builtins['reset-thread']();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No active thread/);
  });

  // 2026-05-27 slash audit close-out — distinguishes "no store" from
  // "no active thread".  Two separate conditions, two locale keys.
  it('reports no_store when threadStore is not wired', async () => {
    const builtins = createLocalBuiltins({ catalog: emptyCatalog(), t });
    const r = await builtins['reset-thread']();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Thread store not available/);
  });
});
