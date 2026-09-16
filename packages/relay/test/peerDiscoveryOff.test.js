/**
 * Peer discovery is OFF by default (Frits, 2026-09-16): the relay never hands the connected-address list to
 * anyone unless the operator turns it on. Before this, every registered client received the full list on
 * every connect and disconnect — presence for everyone, and linkage: a device's per-circle addresses register
 * on one socket and so appear and vanish together, which let any client pair them across circles.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { openClient, send, addr } from './helpers/provenClient.js';

let relay = null;
afterEach(async () => { await relay?.stop(); relay = null; });
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const register = async (ws, address) => { send(ws, { type: 'register', address }); await settle(200); };

describe('by default no address list leaves the relay', () => {
  it('a connect, a disconnect and an explicit request produce no peer-list frame for anyone', async () => {
    relay = await startRelay({ port: 0 });
    const url = `ws://127.0.0.1:${relay.port}`;
    const alice = await openClient(url); await register(alice, addr('alice'));
    const bob = await openClient(url);   await register(bob, addr('bob'));
    send(alice, { type: 'peer-list' });
    await settle(200);
    bob.close(); await settle(200);
    for (const ws of [alice, bob]) {
      expect(ws.messages.filter((m) => m.type === 'peer-list'), 'no list, broadcast or answered').toEqual([]);
      expect(ws.messages.filter((m) => m.type === 'error'), 'and no refusal either — a lurker learns nothing').toEqual([]);
    }
    alice.close();
  });

  it('the operator can turn it on, and then the list is broadcast', async () => {
    relay = await startRelay({ port: 0, peerDiscovery: true });
    const url = `ws://127.0.0.1:${relay.port}`;
    const alice = await openClient(url); await register(alice, addr('alice'));
    const bob = await openClient(url);   await register(bob, addr('bob'));
    await settle(200);
    expect(alice.messages.some((m) => m.type === 'peer-list' && m.peers?.includes(addr('bob')))).toBe(true);
    alice.close(); bob.close();
  });
});
