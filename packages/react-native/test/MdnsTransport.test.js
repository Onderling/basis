/**
 * MdnsTransport tests — native MdnsModule is mocked.
 *
 * The transport delegates all DNS-SD + TCP work to the custom
 * `NativeModules.MdnsModule` (MdnsModule.kt) and reacts to
 * NativeEventEmitter events. react-native-zeroconf / -tcp-socket are no
 * longer involved (see the source header). These tests drive the native
 * module mock + synthesise emitter events to exercise the JS routing
 * layer: the connection tiebreaker, hello-frame identification, the
 * pubKey↔connId maps, and lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared mock harness — vi.hoisted so the vi.mock factory (also hoisted)
// can reference it.
const h = vi.hoisted(() => {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  const native = {
    start:   vi.fn(async () => {}),
    stop:    vi.fn(async () => {}),
    connect: vi.fn(async () => 'conn-1'),
    send:    vi.fn(async () => {}),
    close:   vi.fn(async () => {}),
  };
  return { listeners, native };
});

vi.mock('react-native', () => ({
  NativeModules: { MdnsModule: h.native },
  NativeEventEmitter: class {
    addListener(event, fn) {
      if (!h.listeners.has(event)) h.listeners.set(event, new Set());
      h.listeners.get(event).add(fn);
      return { remove: () => h.listeners.get(event)?.delete(fn) };
    }
    removeAllListeners() { h.listeners.clear(); }
  },
}));

import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { b64Encode } from '../src/utils/base64.js';
import { MdnsTransport } from '../src/transport/MdnsTransport.js';

/** Fire a native emitter event into every registered listener. */
function fireMdns(event, payload) {
  for (const fn of [...(h.listeners.get(event) ?? [])]) fn(payload);
}

/** Let the async MdnsServiceDiscovered handler settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const b64json = (obj) => b64Encode(new TextEncoder().encode(JSON.stringify(obj)));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MdnsTransport', () => {
  let transport, identity;
  // A proper prefix of self sorts BEFORE self; self+char sorts AFTER self.
  let remoteHigher, remoteLower;

  beforeEach(async () => {
    h.native.start.mockClear();
    h.native.stop.mockClear();
    h.native.connect.mockClear();
    h.native.send.mockClear();
    h.native.close.mockClear();
    h.listeners.clear();
    identity     = await AgentIdentity.generate(new VaultMemory());
    transport    = new MdnsTransport({ identity });
    remoteHigher = identity.pubKey + 'Z';          // self < remote → self initiates
    remoteLower  = identity.pubKey.slice(0, -1);   // self > remote → self waits
  });

  afterEach(async () => {
    await transport.disconnect().catch(() => {});
  });

  it('isAvailable() is true when the native module is present', () => {
    expect(MdnsTransport.isAvailable()).toBe(true);
  });

  it('throws without identity', () => {
    expect(() => new MdnsTransport({})).toThrow('identity');
  });

  it('address equals pubKey', () => {
    expect(transport.address).toBe(identity.pubKey);
  });

  it('connect() starts the native service with type/host/pubKey; idempotent', async () => {
    await transport.connect();
    expect(h.native.start).toHaveBeenCalledTimes(1);
    const [type, host, pubKey] = h.native.start.mock.calls[0];
    expect(type).toBe('_onderling');
    expect(host).toBe(`dw-${identity.pubKey.slice(0, 8)}`);
    expect(pubKey).toBe(identity.pubKey);
    await transport.connect();
    expect(h.native.start).toHaveBeenCalledTimes(1); // no re-start
  });

  it('disconnect() stops the native service and is idempotent', async () => {
    await transport.connect();
    await transport.disconnect();
    expect(h.native.stop).toHaveBeenCalledTimes(1);
    await transport.disconnect();
    expect(h.native.stop).toHaveBeenCalledTimes(1);
  });

  it('ignores self-discovery (no connect, no peer-discovered)', async () => {
    await transport.connect();
    const discovered = [];
    transport.on('peer-discovered', (a) => discovered.push(a));
    fireMdns('MdnsServiceDiscovered', { host: '127.0.0.1', port: 9999, pubKey: identity.pubKey });
    await flush();
    expect(discovered).toHaveLength(0);
    expect(h.native.connect).not.toHaveBeenCalled();
  });

  it('tiebreaker: higher-keyed peer waits for the inbound connection', async () => {
    await transport.connect();
    const discovered = [];
    transport.on('peer-discovered', (a) => discovered.push(a));
    // remoteLower < self → self is the responder → must NOT dial out.
    fireMdns('MdnsServiceDiscovered', { host: '10.0.0.2', port: 7000, pubKey: remoteLower });
    await flush();
    expect(h.native.connect).not.toHaveBeenCalled();
    expect(discovered).toHaveLength(0);
  });

  it('initiator path: lower-keyed peer dials out, sends hello, emits peer-discovered', async () => {
    await transport.connect();
    const discovered = new Promise((res) => transport.once('peer-discovered', res));
    fireMdns('MdnsServiceDiscovered', { host: '192.168.1.5', port: 8080, pubKey: remoteHigher });
    expect(await discovered).toBe(remoteHigher);

    expect(h.native.connect).toHaveBeenCalledWith('192.168.1.5', 8080);
    // First send on the new conn is the hello frame.
    const [connId, helloB64] = h.native.send.mock.calls[0];
    expect(connId).toBe('conn-1');
    const hello = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(helloB64), (c) => c.charCodeAt(0)),
    ));
    expect(hello).toEqual({ _mdns_hello: true, _from: identity.pubKey });
    expect(transport._hasPeer(remoteHigher)).toBe(true);
  });

  it('initiator path: the peer we just dialled is REACHABLE — dialling is activity', async () => {
    // Only the responder path stamped activity before, so the initiator answered `canReach() === false`
    // for a peer it had connected to seconds ago, and the router fell back to the relay (story 8).
    await transport.connect();
    const discovered = new Promise((res) => transport.once('peer-discovered', res));
    fireMdns('MdnsServiceDiscovered', { host: '192.168.1.5', port: 8080, pubKey: remoteHigher });
    await discovered;
    expect(transport.canReach(remoteHigher)).toBe(true);
    expect(transport.connectedPeers()).toEqual([remoteHigher]);
  });

  it('inbound connection identified by a hello frame → peer-discovered', async () => {
    await transport.connect();
    const discovered = new Promise((res) => transport.once('peer-discovered', res));
    fireMdns('MdnsClientConnected', { connectionId: 'in-1' });
    fireMdns('MdnsDataReceived', {
      connectionId: 'in-1',
      data: b64json({ _mdns_hello: true, _from: remoteLower }),
    });
    expect(await discovered).toBe(remoteLower);
    expect(transport._hasPeer(remoteLower)).toBe(true);
  });

  it('a fresh hello from a peer we still map to an OLD connection re-maps to the new one', async () => {
    // A peer that restarted dials again before its dead socket's close reaches us. Ignoring the second
    // hello left the live connection unmapped: their envelopes arrived, every reply went to the dead
    // socket ("no connection to …"). Story 8, the companion restarted under the phone.
    await transport.connect();
    fireMdns('MdnsClientConnected', { connectionId: 'in-1' });
    fireMdns('MdnsDataReceived', { connectionId: 'in-1', data: b64json({ _mdns_hello: true, _from: remoteLower }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(transport._hasPeer(remoteLower)).toBe(true);

    fireMdns('MdnsClientConnected', { connectionId: 'in-2' });
    fireMdns('MdnsDataReceived', { connectionId: 'in-2', data: b64json({ _mdns_hello: true, _from: remoteLower }) });
    await new Promise((r) => setTimeout(r, 0));
    const env = { _v: 1, _p: 'OW', _id: 'x', _from: identity.pubKey, _to: remoteLower, _ts: Date.now(), _sig: null, payload: null };
    await transport._put(remoteLower, env);
    const lastSend = h.native.send.mock.calls.at(-1);
    expect(lastSend[0]).toBe('in-2');                      // replies go to the live socket

    // The old socket closing late must not unmap the live one.
    fireMdns('MdnsClientDisconnected', { connectionId: 'in-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(transport._hasPeer(remoteLower)).toBe(true);
    expect(transport.canReach(remoteLower)).toBe(true);
  });

  it('_put throws when there is no connection to the peer', async () => {
    await transport.connect();
    const env = { _v: 1, _p: 'OW', _id: 'x', _from: identity.pubKey,
                  _to: 'unknown', _ts: Date.now(), _sig: null, payload: null };
    await expect(transport._put('unknown', env)).rejects.toThrow(/no connection/i);
  });

  it('_put sends via the native module once a connection exists', async () => {
    await transport.connect();
    const discovered = new Promise((res) => transport.once('peer-discovered', res));
    fireMdns('MdnsServiceDiscovered', { host: '192.168.1.9', port: 9090, pubKey: remoteHigher });
    await discovered;
    h.native.send.mockClear();

    const env = { _v: 1, _p: 'OW', _id: 'e1', _from: identity.pubKey,
                  _to: remoteHigher, _ts: Date.now(), _sig: null, payload: 'hi' };
    await transport._put(remoteHigher, env);
    expect(h.native.send).toHaveBeenCalledTimes(1);
    expect(h.native.send.mock.calls[0][0]).toBe('conn-1');
    expect(transport.lastActivityAt(remoteHigher)).toBeGreaterThan(0);
  });

  it('MdnsClientDisconnected clears the peer and emits peer-disconnected', async () => {
    await transport.connect();
    const discovered = new Promise((res) => transport.once('peer-discovered', res));
    fireMdns('MdnsServiceDiscovered', { host: '192.168.1.7', port: 8081, pubKey: remoteHigher });
    await discovered;
    expect(transport._hasPeer(remoteHigher)).toBe(true);

    const gone = new Promise((res) => transport.once('peer-disconnected', res));
    fireMdns('MdnsClientDisconnected', { connectionId: 'conn-1' });
    expect(await gone).toBe(remoteHigher);
    expect(transport._hasPeer(remoteHigher)).toBe(false);
  });
});
