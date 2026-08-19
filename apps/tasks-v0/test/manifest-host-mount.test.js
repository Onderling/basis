/**
 * proof — tasks-v0 multi-circle mounts cleanly into `@onderling/
 * manifest-host` with multi-circle dispatch preserved end-to-end.
 *
 * Mounts the real `buildMultiCircleRuntime` output (the same machinery
 * tasks-ui.js's --multi-circle CLI builds) into a fresh manifest-host
 * via `createTasksMountable`, then drives the composed view's
 * namespaced tool handlers + asserts circle isolation holds.
 *
 * Key claim: the host operates on the chat surface; bundleResolver
 * stays untouched and continues to do per-call circle dispatch.  They
 * are orthogonal layers.
 */

import { describe, it, expect } from 'vitest';
import { DataPart } from '@onderling/core';

import { createManifestHost } from '@onderling/manifest-host';

import { buildMultiCircleRuntime } from '../src/buildMultiCircleRuntime.js';
import { createTasksMountable }  from '../src/mountable.js';
import { tasksManifest }         from '../manifest.js';

const ANNE = 'https://id.example/anne';

/**
 * Part G (2026-06-17) — chat-shell ops folded into the manifest from the
 * former mockTasksManifest that resolve through realAgent.js (alias /
 * derivation), NOT a same-named mountable skill:
 *   - myInbox        → aliased to `listMyInbox`
 *   - listCircleMembers→ derived from `getCircleConfig` (members[] unpack)
 */
const CHAT_SHELL_ALIAS_OPS = new Set(['myInbox', 'listCircleMembers']);

async function setup() {
  const runtime  = await buildMultiCircleRuntime({ label: 'sp-4b-mount-test' });
  const mountable = createTasksMountable({
    meshAgent: runtime.meshAgent,
    circlesMap:  runtime.circlesMap,
  });

  const host = createManifestHost();
  host.mount('tasks', tasksManifest, mountable);

  return { ...runtime, host, mountable };
}

/**
 * Spawn a sibling circle via the real provisionMyCircle + spawnMyCircle
 * SDK path so the second mount-target lives.
 */
async function spawnSiblingCircle(meshAgent, circleId) {
  await meshAgent.skills.get('provisionMyCircle').handler({
    parts: [DataPart({ circleId, name: `Sibling ${circleId}`, kind: 'team' })],
    from:  ANNE, agent: meshAgent, envelope: null,
  });
  await meshAgent.skills.get('spawnMyCircle').handler({
    parts: [DataPart({ circleId })],
    from:  ANNE, agent: meshAgent, envelope: null,
  });
}

describe('SP-4b: tasks-v0 multi-circle through manifest-host', () => {
  it('mountable exposes a skillRegistry covering every manifest op', async () => {
    const { mountable } = await setup();
    for (const op of tasksManifest.operations) {
      if (CHAT_SHELL_ALIAS_OPS.has(op.id)) continue;   // resolved via realAgent alias/derivation
      expect(
        mountable.skillRegistry,
        `manifest op "${op.id}" must be in the mountable skillRegistry`,
      ).toHaveProperty(op.id);
      expect(typeof mountable.skillRegistry[op.id]).toBe('function');
    }
  });

  it('host.compose() namespaces every tasks op as tasks.opId', async () => {
    const { host } = await setup();
    const composed = host.compose();
    const ids = composed.toolCatalogue.map((t) => t.id).sort();
    for (const op of tasksManifest.operations) {
      expect(ids).toContain(`tasks.${op.id}`);
    }
  });

  it('addTask via the host dispatches to the primary circle\'s itemStore', async () => {
    const { host, primaryBundle } = await setup();
    const composed = host.compose();

    const reply = await composed.toolHandlers['tasks.addTask'](
      { circleId: 'primary-circle', text: 'paint the hallway' },
      { actorWebid: ANNE },
    );

    // Reply present (envelope from the SDK adapter).
    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].type).toBe('text');

    // The actual side-effect we care about: the task landed in primary
    // circle's itemStore.
    const items = await primaryBundle.itemStore.listOpen();
    expect(items.map((i) => i.text)).toContain('paint the hallway');
  });

  it('multi-circle isolation holds through the host (circle A vs circle B)', async () => {
    const { host, meshAgent, circlesMap } = await setup();
    await spawnSiblingCircle(meshAgent, 'sibling-circle');
    expect(circlesMap.size).toBe(2);

    const composed = host.compose();
    await composed.toolHandlers['tasks.addTask'](
      { circleId: 'primary-circle', text: 'primary-only-task' },
      { actorWebid: ANNE },
    );
    await composed.toolHandlers['tasks.addTask'](
      { circleId: 'sibling-circle', text: 'sibling-only-task' },
      { actorWebid: ANNE },
    );

    const primaryItems = await circlesMap.get('primary-circle').itemStore.listOpen();
    const siblingItems = await circlesMap.get('sibling-circle').itemStore.listOpen();

    expect(primaryItems.map((i) => i.text)).toContain('primary-only-task');
    expect(primaryItems.map((i) => i.text)).not.toContain('sibling-only-task');
    expect(siblingItems.map((i) => i.text)).toContain('sibling-only-task');
    expect(siblingItems.map((i) => i.text)).not.toContain('primary-only-task');
  });

  it('the host can mount tasks alongside another manifest without collisions on tasks ops', async () => {
    const { host } = await setup();

    // Mount a synthetic second app whose ops do NOT collide with tasks.
    host.mount('synthetic', {
      app:        'synthetic',
      itemTypes:  ['note'],
      operations: [
        {
          id:     'addNote',
          verb:   'add',
          params: [{ name: 'text', kind: 'string', required: true }],
          surfaces: { chat: { hint: 'Add a note' } },
        },
      ],
    }, {
      skillRegistry: { addNote: async (args) => ({ replies: [{ type: 'text', text: `note: ${args.text}` }], stateUpdates: [] }) },
      toSkillCtx:    (c) => c,
    });

    const composed = host.compose();
    expect(composed.collisions).toEqual([]);   // no overlapping commands
    // Both apps' tools coexist:
    const ids = composed.toolCatalogue.map((t) => t.id);
    expect(ids).toContain('tasks.addTask');
    expect(ids).toContain('synthetic.addNote');
  });
});
