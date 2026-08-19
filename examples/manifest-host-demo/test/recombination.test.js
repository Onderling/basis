/**
 * SP-4b + SP-11 recombination demo — integration test.
 *
 * Drives the same scenario as `index.js` (the runnable demo) and
 * asserts:
 *   - the host composes both apps cleanly (namespacing, no
 *     collisions for this two-app combo);
 *   - LLM-driven tool calls dispatch through the composed
 *     `toolHandlers` and reach the right app's store;
 *   - multi-circle dispatch through the host preserves circle
 *     isolation (the `tasks.addTask({circleId:'primary-circle', text})`
 *     call lands in primary circle's itemStore, not anywhere else);
 *   - the chat-agent's reply pipeline produces an outbox entry per
 *     turn.
 *
 * The test deliberately uses the SAME `scenario.js` module as the
 * demo so a behavioural regression on either fails the test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  setupRecombinationDemo,
  runScriptedConversation,
  demoCrossAppEmbed,
  demoSavedCrossCircleView,
  SV_CIRCLE_GARDEN,
  SV_CIRCLE_TOOLSHED,
  DEMO_USER_MESSAGES,
} from '../scenario.js';

describe('SP-4b + SP-11: recombination demo (household + tasks-v0)', () => {
  let runtime;

  beforeEach(async () => {
    runtime = await setupRecombinationDemo();
  });

  afterEach(async () => {
    await runtime?.teardown();
  });

  describe('host composition', () => {
    it('mounts both apps', () => {
      expect(runtime.host.list().sort()).toEqual(['household', 'tasks']);
    });

    it('composed toolCatalogue covers tools from both apps with appId.opId namespacing', () => {
      const ids = runtime.composed.toolCatalogue.map((t) => t.id);
      // household tools (sample — at least these must be present).
      expect(ids).toContain('household.addItem');
      expect(ids).toContain('household.listOpen');
      // tasks tools (sample).
      expect(ids).toContain('tasks.addTask');
      expect(ids).toContain('tasks.listOpen');
    });

    it('reports zero command collisions for this two-app combo', () => {
      // household has slash; tasks-v0 (SP-3 V0) explicitly does not.
      // Confirms the V0 host's collision-detection is functioning
      // even when zero collisions exist.
      expect(runtime.composed.collisions).toEqual([]);
    });

    it('exposes perAppSystemPrompts keyed per app, not concatenated', () => {
      expect(Object.keys(runtime.composed.perAppSystemPrompts).sort())
        .toEqual(['household', 'tasks']);
    });
  });

  describe('scripted conversation — recombination end-to-end', () => {
    it('every user turn produces at least one outbox reply', async () => {
      const turns = await runScriptedConversation(runtime, DEMO_USER_MESSAGES);
      expect(turns).toHaveLength(DEMO_USER_MESSAGES.length);
      for (const t of turns) {
        expect(t.replies.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('turn 1 (household.addItem) writes to the household store', async () => {
      await runScriptedConversation(runtime, [DEMO_USER_MESSAGES[0]]);
      const shopping = await runtime.householdStore.listOpen({ type: 'shopping' });
      expect(shopping.map((i) => i.text)).toContain('bread');
    });

    it('turn 2 (tasks.addTask) writes to primary circle\'s itemStore (multi-circle dispatch through host)', async () => {
      // Run turns 1 then 2 — scripted LLM advances its cursor each call.
      await runScriptedConversation(runtime, [
        DEMO_USER_MESSAGES[0],
        DEMO_USER_MESSAGES[1],
      ]);

      const primaryItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
      const titles       = primaryItems.map((it) => it.text);
      expect(titles).toContain('paint the hallway');
    });

    it('cross-app isolation — household tasks list is empty even after tasks.addTask', async () => {
      // tasks.addTask writes to tasks-v0's itemStore, NOT household's
      // tasks list — even though household ALSO has an addTask op
      // (SP-2).  Namespacing in the composed catalogue prevents the
      // confusion at dispatch time.
      await runScriptedConversation(runtime, [
        DEMO_USER_MESSAGES[0],
        DEMO_USER_MESSAGES[1],
      ]);

      // Household's tasks-list is unaffected by tasks.addTask.
      const householdTasks = await runtime.householdStore.listOpen({ type: 'task' });
      expect(householdTasks.map((i) => i.text)).not.toContain('paint the hallway');
    });

    it('full scripted run keeps household + tasks state cleanly separated', async () => {
      await runScriptedConversation(runtime, DEMO_USER_MESSAGES);

      // Household side — bread is in shopping.
      const householdShopping = await runtime.householdStore.listOpen({ type: 'shopping' });
      expect(householdShopping.map((i) => i.text)).toContain('bread');

      // Tasks side — paint the hallway is in primary circle's itemStore.
      const tasksItems = await runtime.tasksRuntime.primaryBundle.itemStore.listOpen();
      expect(tasksItems.map((i) => i.text)).toContain('paint the hallway');

      // No cross-contamination — household shopping doesn't carry the
      // tasks item, even though both ran through the same chat session.
      expect(householdShopping.map((i) => i.text)).not.toContain('paint the hallway');
    });
  });
});

/* ════════════════════════════════════════════════════════════════════
 * SP-11b — cross-surface recombination polish.
 *
 *   (1) stoop as a 3rd mounted app — three apps composed cleanly.
 *   (2) a canonical cross-app `embeds:[{type,ref}]` reference resolved
 *       across two apps' stores.
 *   (3) a saved CROSS-CIRCLE view — now unblocked by SP-8
 *       (`@canopy/circles` `makeSavedView`/`resolveSavedView` +
 *       `@canopy/item-store` `ListFilter.audiences`).  See the dedicated
 *       describe block below.
 * ════════════════════════════════════════════════════════════════════ */

describe('SP-11b: stoop as a 3rd mounted app', () => {
  let runtime;

  beforeEach(async () => {
    runtime = await setupRecombinationDemo({ mountStoop: true });
  });

  afterEach(async () => {
    await runtime?.teardown();
  });

  it('mounts all three apps', () => {
    expect(runtime.host.list().sort()).toEqual(['household', 'stoop', 'tasks']);
  });

  it('stoop mounts with a real, complete skill registry (zero manifest-op drift)', () => {
    // The bundle's skill set covers every substrate-backed manifest op
    // — `buildStoopSkillRegistry` reports nothing missing.
    expect(runtime.stoop.missing).toEqual([]);
    expect(Object.keys(runtime.stoop.mountable.skillRegistry).length)
      .toBeGreaterThan(0);
  });

  it('composed toolCatalogue namespaces all THREE apps with appId.opId', () => {
    const ids = runtime.composed.toolCatalogue.map((t) => t.id);

    // Every id is namespaced to one of the three mounted apps.
    expect(ids.every((id) => /^(household|tasks|stoop)\./.test(id))).toBe(true);

    // Each app contributes at least one tool (sample per app).
    expect(ids).toContain('household.addItem');
    expect(ids).toContain('tasks.addTask');
    expect(ids.some((id) => id.startsWith('stoop.'))).toBe(true);

    // Namespacing is what keeps a shared bare op-name (e.g. `listOpen`,
    // which household, tasks AND stoop all define) collision-free in
    // the tool catalogue: three distinct ids, one per app.
    expect(ids).toContain('household.listOpen');
    expect(ids).toContain('tasks.listOpen');
    expect(ids).toContain('stoop.listOpen');
  });

  it('reports zero command collisions for the three-app combo', () => {
    // Tool ids are namespaced; the slash-command menus of the three
    // apps don't overlap → the host detects no collisions.
    expect(runtime.composed.collisions).toEqual([]);
  });

  it('exposes a per-app system prompt for each of the three apps (not concatenated)', () => {
    const prompts = runtime.composed.perAppSystemPrompts;
    expect(Object.keys(prompts).sort()).toEqual(['household', 'stoop', 'tasks']);
    // Each is its own entry — a string keyed per app, not one merged blob.
    for (const app of ['household', 'stoop', 'tasks']) {
      expect(typeof prompts[app]).toBe('string');
    }
  });
});

describe('SP-11b: cross-app embed reference (canonical embeds:[{type,ref}])', () => {
  let runtime;

  beforeEach(async () => {
    // Stoop isn't needed for the embed itself (household ↔ tasks), but
    // running it under the 3-app host proves the reference works in the
    // full cross-surface composition.
    runtime = await setupRecombinationDemo({ mountStoop: true });
  });

  afterEach(async () => {
    await runtime?.teardown();
  });

  it('a household item references a tasks task by canonical urn ref — not an inlined pod URL', async () => {
    const { task, householdItem, ref } = await demoCrossAppEmbed(runtime);

    // The reference is the canonical `{type, ref}` shape…
    expect(householdItem.embeds).toEqual([{ type: 'task', ref }]);
    // …and the ref is a within-store urn pointing at the tasks item,
    // NOT an inlined pod URL (no http/https scheme).
    expect(ref).toBe(`urn:dec:item:${task.id}`);
    expect(ref.startsWith('http')).toBe(false);
  });

  it('the substrate walker resolves the ref ACROSS apps (household store → tasks store)', async () => {
    const { task, tree } = await demoCrossAppEmbed(runtime);

    // Root is the local household item; it carries exactly one embed.
    expect(tree.source).toBe('local');
    expect(tree.type).toBe('shopping');
    expect(tree.embeds).toHaveLength(1);

    // The embed resolved to the tasks item — fetched from the OTHER
    // app's store via the injected cross-pod-ref resolver.
    const embedded = tree.embeds[0];
    expect(embedded.source).toBe('external');
    expect(embedded.type).toBe('task');
    expect(embedded.item?.text).toBe(task.text);
    expect(embedded.item?.id).toBe(task.id);
  });

  it('an unresolvable cross-app ref degrades to a typed placeholder, not a throw', async () => {
    // Same walk, but with a resolver that knows nothing → the walker
    // must yield a NOT_FOUND placeholder carrying the type + ref (the
    // cross-pod-refs.md render-fallback contract), never throw.
    const { treeOf } = await import('@canopy/item-store');
    const householdStore = runtime.householdStore.substrate;
    const [item] = await householdStore.addItems(
      [{ type: 'shopping', text: 'orphan-ref item',
         embeds: [{ type: 'task', ref: 'urn:dec:item:DOES-NOT-EXIST' }] }],
      { actor: 'demo' },
    );
    const tree = await treeOf({
      rootId:             item.id,
      getItem:            (id) => householdStore.getById(id),
      resolveExternalRef: async () => null,   // nothing resolves
    });
    expect(tree.embeds).toHaveLength(1);
    expect(tree.embeds[0].source).toBe('placeholder');
    expect(tree.embeds[0].reason).toBe('NOT_FOUND');
    expect(tree.embeds[0].type).toBe('task');
  });
});

describe('SP-11b: saved cross-circle view (SP-8 makeSavedView / resolveSavedView)', () => {
  it('the saved view spans the two LISTED circle-refs as a union', async () => {
    const { view, viewAudiences } = await demoSavedCrossCircleView();

    // The view is the canonical `view` item, its audience a UNION of
    // the two circle-refs the view spans.
    expect(view.type).toBe('view');
    expect(view.itemType).toBe('note');
    expect(view.audience).toEqual({
      kind: 'union',
      of:   [SV_CIRCLE_GARDEN, SV_CIRCLE_TOOLSHED],
    });

    // The normalised audience SET (what feeds `ListFilter.audiences`)
    // is exactly the two listed circles.
    expect(viewAudiences).toEqual([SV_CIRCLE_GARDEN, SV_CIRCLE_TOOLSHED]);
  });

  it('resolves to the UNION of items across BOTH listed circles', async () => {
    const { resolved, listedIds } = await demoSavedCrossCircleView();

    const texts = resolved.map((i) => i.text).sort();
    // Garden's two notes + tool-library's one note — the union across
    // the two circles the view spans.
    expect(texts).toEqual([
      'borrow the drill',   // tool-library
      'order tomato seeds', // garden
      'prune the roses',    // garden
    ]);

    // Both circles are actually represented (a genuine UNION, not just
    // one circle's items).
    const circles = new Set(resolved.map((i) => i.audience.id));
    expect(circles).toEqual(new Set(['garden-committee', 'tool-library']));

    // The resolved set is exactly the seeded notes of the listed circles.
    expect(resolved.map((i) => i.id).sort()).toEqual([...listedIds].sort());
  });

  it('EXCLUDES items in a third, unlisted circle', async () => {
    const { resolved } = await demoSavedCrossCircleView();

    // The unlisted circle's note must not surface — the view never
    // named `private-notes`.
    expect(resolved.map((i) => i.text)).not.toContain('diary — do not share');
    expect(resolved.map((i) => i.audience.id)).not.toContain('private-notes');
  });

  it('narrows within the union by the view itemType (wrong-type item excluded)', async () => {
    const { resolved } = await demoSavedCrossCircleView();

    // A `type:'event'` item lives in a LISTED circle (garden), yet the
    // view's `itemType: 'note'` filters it out — audience AND type both
    // apply.
    expect(resolved.every((i) => i.type === 'note')).toBe(true);
    expect(resolved.map((i) => i.text)).not.toContain('garden open day');
  });
});
