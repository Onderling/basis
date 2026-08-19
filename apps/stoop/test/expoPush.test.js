/**
 * S6.6 — mobile-native push (Expo). The dependency-free server half:
 *   - ExpoPushSender delivers to an Expo token via the Expo push API
 *     (injected fetch; no native dep, no network).
 *   - subscribeExpoPush / unsubscribeExpoPush register tokens in the shared
 *     PushRegistry, tagged kind:'expo'.
 *   - triggerSelfPush routes Expo subscriptions to the Expo sender (and Web
 *     Push subscriptions to the web sender) — the dispatch fan-out.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';
import { ExpoPushSender, expoTokenOf, isExpoSubscription } from '../src/lib/ExpoPushSender.js';

const ANNE = 'https://id.example/anne';
const TOKEN = 'ExponentPushToken[abc123]';

const callSkill = (agent, skillId, args) =>
  agent.skills.get(skillId).handler({ parts: args === undefined ? [] : [DataPart(args)], from: ANNE, agent, envelope: null });

async function buildBundle({ pushSender = null, expoPushSender = null } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  return createNeighbourhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members: [{ webid: ANNE }],
    pushSender, expoPushSender,
  });
}

describe('expoTokenOf / isExpoSubscription', () => {
  it('extracts the token from string / {token} / {endpoint:expo:…}', () => {
    expect(expoTokenOf(TOKEN)).toBe(TOKEN);
    expect(expoTokenOf({ token: TOKEN })).toBe(TOKEN);
    expect(expoTokenOf({ endpoint: `expo:${TOKEN}` })).toBe(TOKEN);
  });
  it('recognises Expo subscriptions vs Web Push ones', () => {
    expect(isExpoSubscription({ kind: 'expo', token: TOKEN })).toBe(true);
    expect(isExpoSubscription(TOKEN)).toBe(true);
    expect(isExpoSubscription({ endpoint: 'https://push.example/x' })).toBe(false);
  });
});

describe('ExpoPushSender', () => {
  it('POSTs to the Expo push API with the token + returns ok on status ok', async () => {
    const fetch = vi.fn(async () => ({ status: 200, json: async () => ({ data: { status: 'ok', id: 'r-1' } }) }));
    const sender = new ExpoPushSender({ fetch });
    const res = await sender.send({ kind: 'expo', token: TOKEN }, { title: 'Hi', body: 'There', data: { k: 1 } });
    expect(res).toEqual({ ok: true, id: 'r-1' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('exp.host');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ to: TOKEN, title: 'Hi', body: 'There', data: { k: 1 } });
  });

  it('returns {ok:false} on an Expo error ticket', async () => {
    const fetch = vi.fn(async () => ({ status: 200, json: async () => ({ data: { status: 'error', message: 'DeviceNotRegistered' } }) }));
    const res = await new ExpoPushSender({ fetch }).send(TOKEN, { body: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/DeviceNotRegistered/);
  });

  it('never throws on a network failure', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const res = await new ExpoPushSender({ fetch }).send(TOKEN, { body: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/offline/);
  });
});

describe('subscribeExpoPush / unsubscribeExpoPush skills', () => {
  it('registers + drops an Expo token, tagged kind:expo', async () => {
    const bundle = await buildBundle();
    const sub = await callSkill(bundle.agent, 'subscribeExpoPush', { token: TOKEN });
    expect(sub).toMatchObject({ ok: true, added: true });
    expect(bundle.pushRegistry.list(ANNE)[0]).toMatchObject({ kind: 'expo', token: TOKEN, endpoint: `expo:${TOKEN}` });

    const unsub = await callSkill(bundle.agent, 'unsubscribeExpoPush', { token: TOKEN });
    expect(unsub).toMatchObject({ ok: true, removed: 1 });
    expect(bundle.pushRegistry.list(ANNE)).toEqual([]);
  });

  it('rejects a missing token', async () => {
    const bundle = await buildBundle();
    expect((await callSkill(bundle.agent, 'subscribeExpoPush', {})).error).toMatch(/token required/);
  });
});

describe('triggerSelfPush dispatch routing', () => {
  it('routes Expo subscriptions to the Expo sender, Web Push to the web sender', async () => {
    const webSender = { send: vi.fn(async () => ({ ok: true })) };
    const expoSender = { send: vi.fn(async () => ({ ok: true })) };
    const bundle = await buildBundle({ pushSender: webSender, expoPushSender: expoSender });

    await callSkill(bundle.agent, 'subscribeExpoPush', { token: TOKEN });
    await callSkill(bundle.agent, 'subscribeWebPush', { subscription: { endpoint: 'https://push.example/web', keys: { p256dh: 'x', auth: 'y' } } });

    const r = await callSkill(bundle.agent, 'triggerSelfPush', { title: 'T', body: 'B' });
    expect(r).toEqual({ delivered: 2, failed: 0 });
    expect(expoSender.send).toHaveBeenCalledTimes(1);
    expect(webSender.send).toHaveBeenCalledTimes(1);
    // the Expo sender saw the expo sub, the web sender saw the web sub
    expect(expoSender.send.mock.calls[0][0]).toMatchObject({ kind: 'expo', token: TOKEN });
    expect(webSender.send.mock.calls[0][0]).toMatchObject({ endpoint: 'https://push.example/web' });
  });

  it('works with only an Expo sender wired (no VAPID/web sender)', async () => {
    const expoSender = { send: vi.fn(async () => ({ ok: true })) };
    const bundle = await buildBundle({ expoPushSender: expoSender });
    await callSkill(bundle.agent, 'subscribeExpoPush', { token: TOKEN });
    const r = await callSkill(bundle.agent, 'triggerSelfPush', { body: 'B' });
    expect(r).toEqual({ delivered: 1, failed: 0 });
  });
});
