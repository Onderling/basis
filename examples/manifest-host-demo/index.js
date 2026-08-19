#!/usr/bin/env node
/**
 * Recombination demo — runnable.
 *
 *   node examples/manifest-host-demo/index.js
 *
 * Composes household + tasks-v0 (multi-circle) in one process via
 * `@canopy/manifest-host`, drives a chat-agent over the merged tool
 * catalogue with a scripted LLM, prints the conversation + final state.
 *
 * Matching test at `test/recombination.test.js` asserts the same
 * scenario without the console noise.
 */

import {
  setupRecombinationDemo,
  runScriptedConversation,
  demoCrossAppEmbed,
  demoSavedCrossCircleView,
  DEMO_USER_MESSAGES,
} from './scenario.js';

const log = (msg = '') => console.log(msg);

async function main() {
  log();
  log('@canopy manifest-host recombination demo');
  log('— composing household + tasks-v0 in one chat surface');
  log();

  const runtime = await setupRecombinationDemo();

  log('mounted apps:        ' + runtime.host.list().join(', '));
  log('composed toolCatalogue: ' + runtime.composed.toolCatalogue.length + ' tools');
  log('  household tools:   ' +
    runtime.composed.toolCatalogue.filter((t) => t.id.startsWith('household.')).length);
  log('  tasks tools:       ' +
    runtime.composed.toolCatalogue.filter((t) => t.id.startsWith('tasks.')).length);
  log('command collisions:  ' + runtime.composed.collisions.length);
  log();

  log('— conversation —');
  const turns = await runScriptedConversation(runtime, DEMO_USER_MESSAGES);
  for (const [i, turn] of turns.entries()) {
    log(`  user[${i + 1}]:  ${turn.userText}`);
    for (const reply of turn.replies) {
      log(`  bot:        ${reply.text ?? '(no text)'}`);
    }
  }
  log();

  log('— final state —');
  log('household open items (by type):');
  for (const type of ['shopping', 'errand', 'repair', 'schedule', 'task']) {
    const items = await runtime.householdStore.listOpen({ type });
    if (items.length === 0) continue;
    log(`  ${type}: [${items.map((i) => i.text).join(', ')}]`);
  }
  const tasksItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
  log('tasks.primary-circle open items:');
  for (const it of tasksItems) {
    log(`  ${it.text}`);
  }
  log();

  await runtime.teardown();
  log();

  // ── SP-11b — cross-surface recombination polish ──────────────────
  log('— SP-11b: cross-surface recombination —');
  const three = await setupRecombinationDemo({ mountStoop: true });
  log('mounted apps:        ' + three.host.list().join(', '));
  log('composed toolCatalogue: ' + three.composed.toolCatalogue.length + ' tools');
  for (const app of three.host.list()) {
    log(`  ${app} tools:` .padEnd(20) +
      three.composed.toolCatalogue.filter((t) => t.id.startsWith(app + '.')).length);
  }
  log('command collisions:  ' + three.composed.collisions.length);
  log('per-app prompts:     ' + Object.keys(three.composed.perAppSystemPrompts).sort().join(', '));
  log();

  log('cross-app embed reference (household → tasks, canonical {type,ref}):');
  const { householdItem, ref, tree } = await demoCrossAppEmbed(three);
  const embedded = tree.embeds[0];
  log(`  household item "${householdItem.text}" embeds ${ref}`);
  log(`  → resolved (${embedded.source}) ${embedded.type}: "${embedded.item?.text}"`);
  await three.teardown();
  log();

  log('saved cross-circle view (SP-8 makeSavedView / resolveSavedView):');
  const sv = await demoSavedCrossCircleView();
  log(`  view "${sv.view.title}" spans: ` +
    sv.viewAudiences.map((a) => a.id).join(' ∪ '));
  log(`  resolved ${sv.resolved.length} item(s) across both circles:`);
  for (const it of sv.resolved) {
    log(`    - "${it.text}"  [${it.audience.id}]`);
  }
  log(`  excluded (unlisted circle): ` +
    sv.excluded.map((i) => `"${i.text}" [${i.audience.id}]`).join(', '));
  log();

  log('✓ done');
}

main().catch((err) => {
  console.error('\n✗ demo failed:', err);
  process.exit(1);
});
