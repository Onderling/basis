/**
 * The pinboard agent's key is the bundle's own, inside the process: it never goes on a card, a whoAmI, an attachment
 * request or a membership statement, and it is never on the wire. Every envelope two real agents exchange over a real
 * relay — through boot, a circle made and joined, a post and a chat line — is captured at a proxy in front of the
 * relay, and none names that key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, teardown,
} from './support/pairRealAgents.js';

const CIRCLE = 'key-off-wire';

/** A pass-through in front of the relay that keeps a copy of every frame, both ways. */
async function startCapturingProxy(relayUrl) {
  const frames = [];
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  wss.on('connection', (client, req) => {
    const upstream = new WebSocket(relayUrl + (req.url ?? ''));
    const pending = [];
    upstream.on('open', () => { for (const m of pending.splice(0)) upstream.send(m); });
    client.on('message', (m) => { frames.push(String(m)); if (upstream.readyState === WebSocket.OPEN) upstream.send(m); else pending.push(m); });
    upstream.on('message', (m) => { frames.push(String(m)); if (client.readyState === WebSocket.OPEN) client.send(m); });
    client.on('close', () => upstream.close()); upstream.on('close', () => client.close());
    client.on('error', () => {}); upstream.on('error', () => {});
  });
  return { url: `ws://127.0.0.1:${wss.address().port}`, frames, close: () => new Promise((r) => wss.close(() => r())) };
}

describe('the pinboard key stays in the process', () => {
  let relay, proxy, ann, bob;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    proxy = await startCapturingProxy(relay.url);
    ann = await bootRealAgentNode('ann', { itemsLane: true, contactChannel: true, redeemTimeoutMs: 30_000 });
    bob = await bootRealAgentNode('bob', { itemsLane: true, redeemTimeoutMs: 30_000 });
    await connectNodesOverRelay([ann, bob], { relayUrl: proxy.url });
  }, 120_000);
  afterAll(async () => { await teardown(ann, bob); await proxy?.close?.(); await relay?.close?.(); });

  it('a card, whoAmI and every frame of a circle made, joined, posted in and talked in name the chat key, never the pinboard key', async () => {
    const keys = [ann, bob].map((n) => n.agent.inProcessAddresses().pinboard);
    expect(keys.every((k) => typeof k === 'string' && k.length > 20), JSON.stringify(keys)).toBe(true);

    await createCircle(ann, { groupId: CIRCLE, name: 'Sleutel Kring', purpose: 'de sleutel blijft binnen' });
    const joined = await joinExistingCircle(ann, bob, { groupId: CIRCLE, handle: 'bob' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([ann, bob], CIRCLE);
    await ann.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft er een ladder?', groupId: CIRCLE });
    await sendCircleChat(ann, CIRCLE, 'hoi Bob');
    await new Promise((r) => setTimeout(r, 3000));

    for (const [n, key] of [[ann, keys[0]], [bob, keys[1]]]) {
      const card = JSON.stringify(await n.agent.callSkill('pinboard', 'getContactShareQr', {}));
      expect(card.includes(key), 'the card names the pinboard key').toBe(false);
      const me = await n.agent.callSkill('pinboard', 'whoAmI', {});
      expect([me?.pubKey, me?.stableId].includes(key), 'whoAmI names the pinboard key').toBe(false);
    }
    expect(proxy.frames.length, 'the capture saw the traffic').toBeGreaterThan(10);
    // the control: the same capture DOES see a key that belongs on the wire — the chat identity a peer reaches
    const chatKey = (await ann.agent.callSkill('pinboard', 'whoAmI', {}))?.pubKey;
    expect(typeof chatKey === 'string' && proxy.frames.some((f) => f.includes(chatKey)), 'the capture can see a key at all').toBe(true);
    const leaking = proxy.frames.filter((f) => keys.some((k) => f.includes(k)));
    expect(leaking.map((f) => f.slice(0, 160))).toEqual([]);
  }, 180_000);
});
