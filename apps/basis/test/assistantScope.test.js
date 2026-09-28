/**
 * Scope first, then interpret — on the box.
 *
 * The model chooses its tool from the catalogue it is handed; the cheapest way to stop it picking an op the
 * bot should not run is not to hand it that op. Circle doors have scoped their catalogue to the circle's apps
 * for months (`scopeCatalogueToApps` over `policy.apps`); the box's Telegram door merged a fixed pair of
 * manifests and offered no way to add or drop one.
 *
 * Now the box reads its app list from the `assistant.apps` parameter and composes through the shared
 * `composeAssistantCatalogue`. This drives the REAL Telegram runner with the catalogue composed exactly as
 * the box composes it, through the real interpreter, and reads what the model was actually offered: the
 * tools, and the app backgrounds in its prompt.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { ASSISTANT_APPS, ASSISTANT_APPS_PARAM_KEY, assistantAppsFrom } from '../src/v2/assistantApps.js';
import { basisParamRegistry } from '../src/v2/paramsService.js';
import { householdManifest } from '../../household/manifest.js';
import { mockTasksManifest as tasksManifest } from '../src/core/manifests/mockManifests.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const t = (k) => k;

/** Boot the runner the way the box does and return what the model saw on one free-text turn. */
async function whatTheModelSees(apps) {
  const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps });
  const seen = [];
  const llm = { invoke: async (req) => { seen.push(req); return { text: 'ok' }; } };
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const runner = createTelegramRunner({
    bridge, catalogue, manifestsByOrigin, t, allowedChatIds: '*',
    callSkill: async () => ({ ok: true }),
    llm, interpret: interpretToCommand,
  });
  await runner.start();
  await bridge.simulateIncoming({ chatId: '42', text: 'wat staat er nog open?', sender: { bridgeUid: '42', displayName: 'Frits' } });
  await runner.idle('42');   // the bridge is let go at once; the turn runs in the chat's lane
  expect(seen.length, 'the free-text turn reached the model').toBe(1);
  const originOf = (id) => catalogue.opsById.get(id)?.appOrigin;
  return { tools: seen[0].tools, system: seen[0].system, originOf, catalogue };
}

/** The chat-facing tasks ops, by the key the box's catalogue gives them. */
const chatFacingTasksOps = (catalogue) => [...catalogue.opsById]
  .filter(([, e]) => e.appOrigin === 'tasks' && e.op?.surfaces?.chat)
  .map(([k]) => k);

describe('the box scopes its catalogue to its app list before the model interprets', () => {
  it('the app list is a device parameter, settable by the owner, default household + lists', () => {
    expect(ASSISTANT_APPS).toEqual(['household', 'lists']);
    const reg = basisParamRegistry();
    expect(reg.has(ASSISTANT_APPS_PARAM_KEY), 'the register governs it — set-param can reach it').toBe(true);
    expect(reg.kindOf(ASSISTANT_APPS_PARAM_KEY)).toBe('user');
    expect(reg.scopeOf(ASSISTANT_APPS_PARAM_KEY)).toBe('device');
    expect(reg.valueOf(ASSISTANT_APPS_PARAM_KEY)).toEqual(['household', 'lists']);
    expect(assistantAppsFrom(undefined), 'unset → the default, never an empty bot').toEqual(['household', 'lists']);
    expect(assistantAppsFrom([]), 'empty → the default').toEqual(['household', 'lists']);
  });

  it('household + lists: no tasks op is offered, and household is the only background', async () => {
    const { tools, system, originOf } = await whatTheModelSees(['household', 'lists']);
    const origins = new Set(tools.map((x) => originOf(x.id)));
    expect([...origins].sort()).toEqual(['household', 'lists']);
    expect(tools.map((x) => x.id).filter((id) => originOf(id) === 'tasks')).toEqual([]);
    expect(system).toContain(householdManifest.systemPrompt);
  });

  it('with tasks added, the chat-facing tasks ops are offered — and only those', async () => {
    const { tools, originOf, catalogue } = await whatTheModelSees(['household', 'lists', 'tasks']);
    const offeredTasks = tools.map((x) => x.id).filter((id) => originOf(id) === 'tasks').sort();
    expect(offeredTasks.length, 'tasks is in the tool list').toBeGreaterThan(0);
    expect(offeredTasks).toEqual(chatFacingTasksOps(catalogue).sort());
    // an op tasks declares without a chat surface stays out of the model's reach
    const quiet = tasksManifest.operations.filter((o) => !o.surfaces?.chat).map((o) => o.id);
    for (const id of quiet) expect(offeredTasks).not.toContain(id);
  });

  it('household stays first: its op names do not change when tasks is added', async () => {
    const without = await whatTheModelSees(['household', 'lists']);
    const withTasks = await whatTheModelSees(['household', 'lists', 'tasks']);
    const householdIds = (r) => r.tools.map((x) => x.id).filter((id) => r.originOf(id) === 'household').sort();
    expect(householdIds(withTasks)).toEqual(householdIds(without));
    expect(householdIds(without)).toContain('addTask');
  });

  it('what the owner set is what the box composes — read from the agent\'s register, the way the box reads it', async () => {
    const agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false });
    const set = await agent.callSkill('params', 'set-param', { key: ASSISTANT_APPS_PARAM_KEY, value: ['household', 'lists', 'tasks'] });
    expect(set).toMatchObject({ ok: true, scope: 'device' });
    const { apps, catalogue } = composeAssistantCatalogue({ apps: agent.getParamValue(ASSISTANT_APPS_PARAM_KEY) });
    expect(apps).toEqual(['household', 'lists', 'tasks']);
    expect(chatFacingTasksOps(catalogue).length).toBeGreaterThan(0);
  });
});
