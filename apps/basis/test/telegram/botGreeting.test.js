/**
 * A greeting is answered by the gate, never by the model (a household's log, 2026-10: about ten "hoi"s went to the
 * model — harmless, but quota). The whole message is a greeting — "hoi", "Hallo!", "goedemorgen 👋", "hello" — and the
 * bot says its greeting line (the welcome's own words), in Dutch or English; a greeting with a request after it is not
 * one, and goes on as before. Composed as the box composes a household bot's door: the slim catalogue, the door's own
 * ops, the template's word rules, the person's thread.
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

describe('a greeting, answered without the model', () => {
  let bridge; let runner; let threads;
  const asked = [];

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
    threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const doorCall = withAssistantOps({ callSkill: async () => ({ ok: true, items: [] }), threads, t });
    // the stand-in model: it records that it was asked, and answers like the real one did ("Hoi! Wat kan ik doen?")
    const llm = { invoke: async (req) => { asked.push(req); return { toolCall: null, replyText: 'Hoi! Wat kan ik voor je doen?' }; } };
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
    return bridge.outbox.map((m) => m.text);
  };

  it('the Dutch greetings, whole and with punctuation or an emoji: the greeting line, no model', async () => {
    await say('1', '/help');   // the first contact's welcome said, out of the way
    for (const g of ['hoi', 'Hallo!', 'hoii', 'goedemorgen 👋', 'Goedenavond.', 'goedemiddag!!', 'hey', 'hii']) {
      asked.length = 0;
      expect(await say('1', g), g).toEqual([t('circle.bot.welcome')]);
      expect(asked.length, `${g} reached the model`).toBe(0);
    }
  });

  it('an English greeting is answered in English', async () => {
    for (const g of ['hello', 'Hi!', 'hullo', 'hello 🙂', 'Good morning!']) {
      asked.length = 0;
      expect(await say('1', g), g).toEqual([t('circle.bot.welcome', {}, 'en')]);
      expect(asked.length).toBe(0);
    }
  });

  it('a greeting with something after it is not a greeting: it goes on as before', async () => {
    asked.length = 0;
    await say('1', 'hoi, hoe laat is de tandarts morgen?');
    expect(asked.length).toBe(1);
  });

  it('a first contact that is a greeting hears the welcome once, not twice', async () => {
    const said = await say('2', 'hoi');
    expect(said.join('\n').split(t('circle.bot.welcome')).length - 1).toBe(1);
  });
});
