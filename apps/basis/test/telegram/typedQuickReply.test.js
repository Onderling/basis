/**
 * A button's words, TYPED, are that button. Seen in a household's chat (2026-10-08): after "Afspraak gezet … Hoe wil je
 * hieraan herinnerd worden?" with four buttons, a person typed "Zoals altijd" instead of tapping — the line went to the
 * model, which said it could not change anything. Now the next typed line that is exactly one of the labels the bot's
 * last message offered (case and punctuation aside) is that tap: its slash line through the gate, never the model.
 * One line only — after that the offer is spent, and the same words are an ordinary line.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists, HOUSEHOLD_TEMPLATE } from '../../src/v2/householdTemplate.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { interpretToCommand } from '../../src/v2/interpretCommand.js';
import { botPromptLines } from '../../src/v2/botPrompt.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { EventLog } from '../../src/eventLog.js';
import { initLocalisation, t } from '../../src/localisation.js';

describe('a quick reply typed instead of tapped', () => {
  let bridge; let runner;
  const asked = [];

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const backend = async (app, op) => (app === 'calendar' && op === 'addEvent'
      ? { ok: true, itemId: 'e1', title: 'tandarts', startsAt: '2026-11-08T09:00:00.000Z' }
      : { ok: true, items: [] });
    const doorCall = withAssistantOps({ callSkill: backend, threads, t });
    const llm = { invoke: async (req) => { asked.push(req); return { toolCall: null, replyText: 'Ik kan daar zelf niets aan veranderen.' }; } };
    bridge = new InMemoryBridge({ id: 'telegram' });
    runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, lang: 'nl', callSkill: doorCall, collectMs: 0, threads,
      llm, interpret: interpretToCommand, promptLines: botPromptLines(t), gateRules: listsGateRules('nl', templateLists(t)),
      roleFor: () => 'member', scopeToRole: (c) => c,
    });
    await runner.start();
  });

  const say = async (uid, text) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid, displayName: null } });
    await runner.idle(uid);
    return bridge.outbox;
  };

  it('"Zoals altijd" typed after the reminder question sets the household\'s reminders — no model', async () => {
    await say('1', '/help');
    const added = await say('1', '/addappt --title tandarts --when 2026-11-08T10:00');
    const offered = added.flatMap((m) => m.buttons ?? []).map((b) => b.label);
    expect(offered, JSON.stringify(added)).toContain('Zoals altijd');
    asked.length = 0;
    const answered = (await say('1', 'zoals altijd.')).map((m) => m.text).join('\n');
    expect(asked.length, 'the typed button reached the model').toBe(0);
    expect(answered).toMatch(/huishouden/);
  });

  it('the offer is spent after one line: the same words later are an ordinary line', async () => {
    asked.length = 0;
    await say('1', 'zoals altijd');
    expect(asked.length).toBe(1);
  });

  it('with no offer pending, the words are an ordinary line (the model, as before)', async () => {
    asked.length = 0;
    await say('2', 'ochtend');
    expect(asked.length).toBe(1);
  });
});
