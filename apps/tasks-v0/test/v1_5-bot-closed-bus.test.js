/**
 * A bot on a CLOSED bus: in the real app the tasks agent's layer hears only the keys its internal bus adopted
 * (`createInProcessSenderAuthorizer`). The registry mints each bot's key, so it adopts the bot both ways at bind time —
 * no hello — and a cap-token bot keeps working behind the closed roster. Revoking the bot makes it a stranger again.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createInProcessSenderAuthorizer } from '@onderling/core';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { wireBotChannel } from '../src/bot/wireBotChannel.js';

const ANNE = 'https://id.example/anne';
const ANNE_CHAT = '111';
const CIRCLE = { circleId: 'oss-tools', name: 'OSS Tools NL', kind: 'project', members: [{ webid: ANNE, displayName: 'Anne', role: 'admin' }] };

const call = (circle, name, data, from) => circle.agent.skills.get(name).handler({
  parts: [{ type: 'DataPart', data: data ?? {} }], from, agent: circle.agent, envelope: null,
});

describe('a cap-token bot behind the closed bus roster', () => {
  let circle;
  beforeEach(async () => {
    circle = await createCircleAgent({ circleConfig: CIRCLE, localStoreBundle: buildBundle(), wireOnboardingSkills: false });
    // as the real app installs it on the tasks agent's layer: only what its bus adopted
    circle.agent.security.setSenderAuthorizer(createInProcessSenderAuthorizer(circle.agent.security));
  });
  afterEach(async () => { try { await circle.close(); } catch { /* noop */ } });

  it('the bot is adopted at bind time and its calls pass; nothing is refused', async () => {
    await call(circle, 'addTask', { text: 'Closed-bus task' }, ANNE);
    await call(circle, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    const issued = await call(circle, 'issueBotToken', { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    expect(circle.agent.security.inProcessPeerKeys().has(issued.botPubKey)).toBe(true);

    const bridge = new InMemoryBridge({ id: 'closed-bus' });
    const channel = await wireBotChannel({
      agent: circle.agent, bridges: [{ bridge, name: 'test' }],
      chatBindings: () => circle.getCircle()?.bot?.chatBindings ?? {}, botAgentRegistry: circle.botAgentRegistry,
    });
    bridge.outbox.length = 0;
    await bridge.simulateIncoming({ chatId: ANNE_CHAT, text: 'open' });
    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.outbox.map((o) => o.text).join('\n')).toMatch(/Closed-bus task/);
    expect(circle.agent.security.refusedUnauthorizedSenders).toBe(0);
    await channel.detach();
  });

  it('a revoked bot is a stranger on the bus again', async () => {
    await call(circle, 'setBotChatBinding', { chatId: ANNE_CHAT, webid: ANNE }, ANNE);
    const issued = await call(circle, 'issueBotToken', { chatId: ANNE_CHAT, ttlDays: 1 }, ANNE);
    await call(circle, 'revokeBotToken', { chatId: ANNE_CHAT }, ANNE);
    expect(circle.agent.security.inProcessPeerKeys().has(issued.botPubKey)).toBe(false);
    expect(circle.agent.security.getPeerKey(issued.botPubKey)).toBe(null);
  });
});
