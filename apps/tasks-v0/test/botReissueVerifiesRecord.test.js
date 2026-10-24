/**
 * A bot's binding outlives the key that signed it only through a checked re-issue. The record is sealed at rest but
 * not signed: when the agent that issued a bot's token is replaced, the registry re-signs a binding only if its stored
 * token verifies under the RETIRED issuer and says what the record says (the bot's own key, the person it acts as,
 * the bot scope). An edited record, an unverifiable token, or no retired key to check against → dropped and counted.
 */
import { describe, it, expect } from 'vitest';
import { InternalBus, InternalTransport, AgentIdentity, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { buildMeshAgent } from '../src/MeshAgent.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { BotAgentRegistry } from '../src/bot/BotAgentRegistry.js';

const CIRCLE = 'c1';
const WEBID = 'https://id.example/anne';

async function world() {
  const bus = new InternalBus();
  const store = buildBundle().cache;
  const agentOn = async (label) => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { meshAgent } = await buildMeshAgent({ label, identity, transport: new InternalTransport(bus, identity.pubKey, { identity }), localStoreBundle: buildBundle(), identityVault: null });
    await meshAgent.start();
    return meshAgent;
  };
  return { bus, store, agentOn };
}
const row = async (store, chatId) => JSON.parse(await store.read(`mem://tasks/circles/${CIRCLE}/botAgents/${chatId}.json`));

describe('bot bindings across an issuer change', () => {
  it('a record whose token verifies under the retired issuer is re-issued by the new one, acting as the same person, no longer than before', async () => {
    const { bus, store, agentOn } = await world();
    const old = await agentOn('old');
    const before = await new BotAgentRegistry({ bus, tasksAgent: old, dataSource: store, circleId: CIRCLE }).issue({ chatId: 'chat-1', webid: WEBID, ttlDays: 2 });

    const host = await agentOn('host');
    const reg = new BotAgentRegistry({ bus, tasksAgent: host, dataSource: store, circleId: CIRCLE, retiredIssuer: old.pubKey });
    const out = await reg.restoreAll();
    expect(out).toMatchObject({ restored: 1, reissued: 1, dropped: 0 });
    const { token } = await row(store, 'chat-1');
    expect(token.agentId).toBe(host.pubKey);
    expect(token.issuer).toBe(host.pubKey);
    expect(CapabilityToken.verify(token, host.pubKey)).toBe(true);
    expect(token.constraints).toMatchObject({ actingAs: WEBID, scope: 'bot' });
    expect(token.expiresAt).toBeLessThanOrEqual(before.expiresAt);
  });

  it('a record with a swapped person is dropped, not re-signed', async () => {
    const { bus, store, agentOn } = await world();
    const old = await agentOn('old');
    await new BotAgentRegistry({ bus, tasksAgent: old, dataSource: store, circleId: CIRCLE }).issue({ chatId: 'chat-1', webid: WEBID, ttlDays: 2 });
    const body = await row(store, 'chat-1');
    body.binding.webid = 'https://id.example/mallory';
    await store.write(`mem://tasks/circles/${CIRCLE}/botAgents/chat-1.json`, JSON.stringify(body));

    const host = await agentOn('host');
    const reg = new BotAgentRegistry({ bus, tasksAgent: host, dataSource: store, circleId: CIRCLE, retiredIssuer: old.pubKey });
    expect(await reg.restoreAll()).toMatchObject({ restored: 0, reissued: 0, dropped: 1 });
    expect(reg.list()).toEqual([]);
  });

  it('without the retired key nothing old is re-signed', async () => {
    const { bus, store, agentOn } = await world();
    const old = await agentOn('old');
    await new BotAgentRegistry({ bus, tasksAgent: old, dataSource: store, circleId: CIRCLE }).issue({ chatId: 'chat-1', webid: WEBID, ttlDays: 2 });
    const host = await agentOn('host');
    const reg = new BotAgentRegistry({ bus, tasksAgent: host, dataSource: store, circleId: CIRCLE });
    expect(await reg.restoreAll()).toMatchObject({ restored: 0, dropped: 1 });
  });

  it('a bot key is public on the engine that judges it', async () => {
    const { bus, store, agentOn } = await world();
    const host = await agentOn('host');
    const b = await new BotAgentRegistry({ bus, tasksAgent: host, dataSource: store, circleId: CIRCLE }).issue({ chatId: 'chat-1', webid: WEBID, ttlDays: 1 });
    expect(await host.policyEngine.trustRegistry.getTier(b.botPubKey)).toBe('public');
  });
});
