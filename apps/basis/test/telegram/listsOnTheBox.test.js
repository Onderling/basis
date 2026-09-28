/**
 * A lists op the model picks on the box runs.
 *
 * Seen on the tablet: "Welke lijsten zijn beschikbaar" → the model picked `listLists` → the reply was
 * `realAgent: unknown appOrigin "lists"`. The box merges the lists manifest into its catalogue, but the lists
 * handlers are per-circle and were only ever MOUNTED by the painting shells (`mountAppOps('lists', …)`), so on
 * the box the op the model was offered had nothing behind it.
 *
 * This composes the way the box composes: the real agent with no shell mounts, the catalogue from
 * `composeAssistantCatalogue`, the real Telegram runner — and the interpreter's pick dispatched through it.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);

async function boxWithModelPicking(pick) {
  const agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false, t });
  const callSkill = (app, op, args) => agent.callSkill(app, op, args);
  const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({});
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const log = [];
  const runner = createTelegramRunner({
    bridge, catalogue, manifestsByOrigin, t, callSkill, allowedChatIds: '*',
    llm: { invoke: async () => null }, interpret: async () => pick,
    walkLog: (e) => log.push(e),
  });
  await runner.start();
  const say = async (text) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '42', text, sender: { bridgeUid: '42', displayName: 'Frits' } });
    return bridge.outbox.map((m) => m.text).join('\n');
  };
  return { agent, say, log };
}

describe('the box runs the lists ops it offers', () => {
  it('the model picks listLists → the lists answer, not "unknown appOrigin"', async () => {
    const { say, log } = await boxWithModelPicking({ opId: 'listLists', args: {} });
    const out = await say('Welke lijsten zijn beschikbaar');
    expect(log.at(-1), 'the turn went the model\'s way and dispatched the op').toMatchObject({ opId: 'listLists', appOrigin: 'lists' });
    expect(log.at(-1).error, 'the dispatch did not throw').toBeUndefined();
    expect(out).not.toMatch(/unknown appOrigin/);
    expect(out).not.toMatch(/circle\.telegram\.error/);
  });

  it('a list made on the box is there when the box lists its lists', async () => {
    const { agent, say } = await boxWithModelPicking({ opId: 'listLists', args: {} });
    const made = await agent.callSkill('lists', 'createList', { text: 'klusjes' });
    expect(made).toMatchObject({ ok: true });
    const out = await say('Welke lijsten zijn beschikbaar');
    expect(out).toContain('klusjes');
  });
});
