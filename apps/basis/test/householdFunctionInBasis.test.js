/**
 * The household's function stays in basis after household's own addTask and help went (one owner per op): through the
 * box's door (the Telegram runner over the announcing box), a chore is made the way the bot makes one — a line on the
 * chores list that gains a who or a when (`lists.addToList` → `makeChore`) — typed or through the model, and the
 * chores' read (`tasks.listOpen`) lists it; an empty list command is answered (basis's help line), never silence.
 * Measured before the fold too: '/task' on the door never made anything there, and the bot never had addTask.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { InMemoryBridge } from '@onderling/chat-agent';
import { bootAnnouncingBox } from './support/announcingBox.js';
import { initLocalisation, t } from '../src/localisation.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists, HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { testModelProviders } from '../src/v2/testModel.js';

const TZ = 'Europe/Amsterdam';
const PEOPLE = [{ id: 'telegram:1', name: 'Ann', role: 'admin' }];
const ANN = { caller: 'telegram:1', threadId: 'telegram:1' };

describe('the household function, through the basis door', () => {
  let box; let bridge; let runner; let model;
  const say = async (text) => { bridge.clearOutbox(); await bridge.simulateIncoming({ chatId: '1', text, sender: { bridgeUid: '1', displayName: null } }); await runner.idle('1'); return bridge.outbox.map((m) => m.text); };
  const chores = async () => ((await box.door('tasks', 'listOpen', {}, ANN))?.items ?? []).map((c) => c.text);
  const choresList = () => t('circle.lists.template.chores');

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    box = await bootAnnouncingBox({ t, tz: TZ, people: PEOPLE });
    model = { script: [{ when: 'planten', toolCall: { id: 'addToList', args: { list: choresList(), text: 'planten water geven', assignee: 'Ann' } } }] };
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
    bridge = new InMemoryBridge({ id: 'telegram' });
    runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, lang: 'nl', callSkill: box.door, collectMs: 0,
      llm: testModelProviders(model).local, interpret: interpretToCommand, gateRules: listsGateRules('nl', templateLists(t)),
      admit: async ({ uid }) => `telegram:${uid}`,
    });
    await runner.start();
  }, 120_000);
  afterAll(async () => { await runner?.stop?.().catch(() => {}); await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

  it('a line on the chores list with a who becomes a chore the chores\' read lists', async () => {
    const r = await box.door('lists', 'addToList', { list: choresList(), text: 'vuilnis buiten', assignee: 'Ann' }, ANN);
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(await chores()).toContain('vuilnis buiten');
  }, 60_000);

  it('the model makes one the same way', async () => {
    await say('kun je zorgen dat iemand de planten water geeft');
    expect(model.requests.length).toBeGreaterThan(0);
    expect(await chores()).toContain('planten water geven');
  }, 60_000);

  for (const cmd of ['/add', '/done']) {
    it(`an empty "${cmd}" is answered, never silence`, async () => {
      const out = await say(cmd);
      expect(out.length).toBeGreaterThan(0);
      expect(out.join(' ')).toMatch(/\/help/);
    }, 60_000);
  }
});
