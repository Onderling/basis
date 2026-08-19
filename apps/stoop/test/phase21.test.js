/**
 * Stoop — Phase 21 tests.
 *
 * Web Push scaffold:
 *   - PushRegistry add / remove / list
 *   - WebPushSender: stubs `web-push` module, asserts payload + VAPID config
 *   - subscribeWebPush / unsubscribeWebPush / triggerSelfPush skills
 *   - getVapidPublicKey skill
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import { PushRegistry } from '../src/lib/PushRegistry.js';
import { WebPushSender, _setWebPushModuleFactory } from '../src/lib/WebPushSender.js';

const ANNE = 'https://id.example/anne';
const SUB  = Object.freeze({
  endpoint: 'https://push.example/sub/1',
  keys: { p256dh: 'aaa', auth: 'bbb' },
});
const SUB2 = Object.freeze({
  endpoint: 'https://push.example/sub/2',
  keys: { p256dh: 'ccc', auth: 'ddd' },
});

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

async function buildBundle({ pushSender = null, webPush = null } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
    pushSender,
    webPush,
  });
}

describe('Stoop V1.5 Phase 21 — PushRegistry', () => {
  it('add returns total + added flag; idempotent on endpoint', () => {
    const r = new PushRegistry();
    const a = r.add(ANNE, SUB);
    expect(a).toEqual({ added: true, total: 1 });
    const b = r.add(ANNE, SUB);   // same endpoint → replace, not append
    expect(b).toEqual({ added: false, total: 1 });
    const c = r.add(ANNE, SUB2);
    expect(c).toEqual({ added: true, total: 2 });
  });

  it('remove drops one or all', () => {
    const r = new PushRegistry();
    r.add(ANNE, SUB);
    r.add(ANNE, SUB2);
    expect(r.remove(ANNE, SUB.endpoint)).toEqual({ removed: 1, total: 1 });
    expect(r.list(ANNE)).toHaveLength(1);
    expect(r.remove(ANNE)).toEqual({ removed: 1, total: 0 });
    expect(r.list(ANNE)).toEqual([]);
  });
});

describe('Stoop V1.5 Phase 21 — WebPushSender', () => {
  let calls;

  beforeEach(() => {
    calls = { setVapid: null, sent: [] };
    _setWebPushModuleFactory(async () => ({
      default: {
        setVapidDetails: (subject, pub, priv) => { calls.setVapid = { subject, pub, priv }; },
        sendNotification: async (sub, payload) => {
          calls.sent.push({ sub, payload });
          return { statusCode: 201 };
        },
      },
    }));
  });
  afterEach(() => { _setWebPushModuleFactory(null); });

  it('send() rejects bad subscription', async () => {
    const s = new WebPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y' });
    expect(await s.send(null, { body: 'hi' })).toEqual({ ok: false, error: expect.stringContaining('endpoint missing') });
  });

  it('send() invokes setVapidDetails + sendNotification with payload', async () => {
    const s = new WebPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y' });
    const r = await s.send(SUB, { title: 'Hi', body: 'there' });
    expect(r).toEqual({ ok: true });
    expect(calls.setVapid).toEqual({ subject: 'mailto:x@y', pub: 'pub', priv: 'priv' });
    expect(calls.sent).toHaveLength(1);
    expect(JSON.parse(calls.sent[0].payload)).toEqual({ title: 'Hi', body: 'there' });
  });

  it('send() reports module-load failure as ok:false', async () => {
    _setWebPushModuleFactory(async () => { throw new Error('not installed'); });
    const s = new WebPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y' });
    const r = await s.send(SUB, { body: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not installed');
  });
});

describe('Stoop V1.5 Phase 21 — push skills', () => {
  it('getVapidPublicKey returns null when push disabled', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'getVapidPublicKey', {})).toEqual({ publicKey: null });
  });

  it('getVapidPublicKey returns the configured key when WebPush wired', async () => {
    const bundle = await buildBundle({
      webPush: { publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:x@y' },
    });
    const r = await callSkill(bundle.agent, 'getVapidPublicKey', {});
    expect(r.publicKey).toBe('PUB');
  });

  it('subscribe + unsubscribe round-trip via skills', async () => {
    const bundle = await buildBundle();
    const sub = await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    expect(sub.ok).toBe(true);
    expect(sub.added).toBe(true);
    expect(bundle.pushRegistry.list(ANNE)).toHaveLength(1);

    const unsub = await callSkill(bundle.agent, 'unsubscribeWebPush', { endpoint: SUB.endpoint });
    expect(unsub.ok).toBe(true);
    expect(unsub.removed).toBe(1);
    expect(bundle.pushRegistry.list(ANNE)).toEqual([]);
  });

  it('triggerSelfPush hits every subscription with the supplied payload', async () => {
    const sent = [];
    const fakeSender = {
      async send(s, payload) { sent.push({ s, payload }); return { ok: true }; },
    };
    const bundle = await buildBundle({ pushSender: fakeSender });
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB });
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: SUB2 });

    const r = await callSkill(bundle.agent, 'triggerSelfPush', { title: 'T', body: 'B' });
    expect(r).toEqual({ delivered: 2, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[0].payload).toEqual({ title: 'T', body: 'B' });
  });

  it('triggerSelfPush errors when push is disabled', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'triggerSelfPush', { body: 'x' }))
      .toEqual({ error: 'push-disabled (no sender)' });   // S6.6 — message now covers web + expo
  });

  it('triggerSelfPush errors when no subscriptions', async () => {
    const fakeSender = { async send() { return { ok: true }; } };
    const bundle = await buildBundle({ pushSender: fakeSender });
    expect(await callSkill(bundle.agent, 'triggerSelfPush', { body: 'x' }))
      .toEqual({ error: 'no-subscriptions' });
  });
});
