/**
 * A push subscription lets its holder wake this device, so it lives on the device's own push store: sealed, never in
 * the pinboard store (which can reach a pod), never carried to a sibling. A real boot, the files read raw.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const ENDPOINT = 'https://push.example/wekker-zeegras-5521';

describe('push subscriptions live on the device-local push store', () => {
  let dir; let node;
  afterAll(async () => {
    await teardown(node).catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('a subscription lands in the push store, sealed, and the pinboard store never holds it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'push-store-'));
    const pinboardFile = path.join(dir, 'pinboard-items.json');
    const pushFile = path.join(dir, 'push-device.json');
    node = await bootRealAgentNode('push', { agentOpts: { pinboardPersistDb: { path: pinboardFile }, pinboardPushPersistDb: { path: pushFile } } });
    const r = await node.agent.callSkill('pinboard', 'subscribeWebPush', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'a', auth: 'b' } } });
    expect(r?.ok).toBe(true);
    await node.agent.callSkill('pinboard', 'setMyDisplayName', { displayName: 'iemand' });   // the pinboard store writes too
    // Both writes are debounced; the sealed files keep their map KEYS readable, so the path names the row.
    const until = async (f, key) => {
      for (let i = 0; i < 200; i++) {
        try { const raw = await readFile(f, 'utf8'); if (raw.includes(key)) return raw; } catch { /* not written yet */ }
        await new Promise((s) => setTimeout(s, 50));
      }
      throw new Error(`${path.basename(f)} never held ${key}`);
    };
    const push = await until(pushFile, 'mem://pinboard/push-subscriptions.json');
    expect(push).not.toContain(ENDPOINT);                       // sealed
    const pin = await until(pinboardFile, 'mem://neighbourhood/members/');
    expect(pin).not.toContain('push-subscriptions');
  }, 60_000);
});
