/**
 * Tasks M4 — getItemTree skill (workspace.js).
 *
 * Analog of apps/pinboard/test/getItemTree.test.js, adapted for Tasks.
 * Asserts the Phase 3.3c cross-pod read path: top-level embeds
 * (Tasks canonical shape) and source.embeds (Pinboard-originated items)
 * are both bridged; https refs materialise; 401/403 → PERMISSION_DENIED
 * placeholder; urn:dec:item: → local; missing itemId → error.
 *
 * Agent-side by design — Tasks web + mobile are both thin A2A clients
 * so one skill serves both (scoped-skills parity invariant holds).
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildWorkspaceSkills } from '../src/skills/workspace.js';

const CIRCLE_ID = 'test-circle';

function skillsWith(itemMap) {
  // Minimal bundleResolver: always returns this one circle object.
  const circle = {
    circleId:    CIRCLE_ID,
    itemStore: {
      getById: async (id) => itemMap[id] ?? null,
    },
    pseudoPod: null,
  };
  const bundleResolver = () => circle;

  const skills = buildWorkspaceSkills({ bundleResolver });
  return skills.find((s) => s.id === 'getItemTree');
}

function call(skill, args) {
  return skill.handler({
    parts: [{ type: 'DataPart', data: args }],
    from:  'urn:me',
    envelope: { data: { circleId: CIRCLE_ID } },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getItemTree skill (Tasks M4 Phase 3.3c)', () => {
  it('walks top-level embeds (Tasks canonical shape) and materialises an https cross-pod ref', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '{"id":"X","type":"task","text":"linked task"}',
    })));
    const skill = skillsWith({
      T1: {
        id: 'T1', type: 'task', text: 'root',
        embeds: [{ type: 'task', ref: 'https://alice.pod/circles/c1/items/X.json' }],
      },
    });
    const { tree, error } = await call(skill, { itemId: 'T1' });
    expect(error).toBeUndefined();
    expect(tree.id).toBe('T1');
    expect(tree.source).toBe('local');
    expect(tree.embeds).toHaveLength(1);
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item).toEqual({ id: 'X', type: 'task', text: 'linked task' });
  });

  it('bridges source.embeds (Pinboard-originated item embedded in a task)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '{"id":"P","type":"request","text":"post"}',
    })));
    const skill = skillsWith({
      T1: {
        id: 'T1', type: 'task',
        source: { embeds: [{ type: 'request', ref: 'https://bob.pod/pinboard/items/P.json' }] },
      },
    });
    const { tree } = await call(skill, { itemId: 'T1' });
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item.type).toBe('request');
  });

  it('403 on a cross-pod ref → PERMISSION_DENIED placeholder (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    const skill = skillsWith({
      T1: { id: 'T1', type: 'task', embeds: [{ type: 'task', ref: 'https://alice.pod/items/T2.json' }] },
    });
    const { tree, error } = await call(skill, { itemId: 'T1' });
    expect(error).toBeUndefined();
    expect(tree.embeds[0].source).toBe('placeholder');
    expect(tree.embeds[0].reason).toBe('PERMISSION_DENIED');
    expect(tree.embeds[0].ref).toBe('https://alice.pod/items/T2.json');
  });

  it('urn:dec:item: ref resolves via the local itemStore', async () => {
    const skill = skillsWith({
      T1: { id: 'T1', type: 'task', embeds: [{ type: 'task', ref: 'urn:dec:item:T2' }] },
      T2: { id: 'T2', type: 'task', text: 'local sibling' },
    });
    const { tree } = await call(skill, { itemId: 'T1' });
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item.id).toBe('T2');
  });

  it('no embeds → empty embeds array', async () => {
    const skill = skillsWith({ T1: { id: 'T1', type: 'task', text: 'plain' } });
    const { tree } = await call(skill, { itemId: 'T1' });
    expect(tree.embeds).toEqual([]);
    expect(tree.subtasks).toEqual([]);
  });

  it('missing itemId → error', async () => {
    const skill = skillsWith({});
    const { error } = await call(skill, {});
    expect(error).toMatch(/itemId/);
  });

  it('unknown itemId → error (item not found → treeOf placeholder)', async () => {
    const skill = skillsWith({});
    // treeOf returns a NOT_FOUND placeholder for the root, which is
    // currently returned as-is in the tree (not as an error).
    const { tree } = await call(skill, { itemId: 'MISSING' });
    expect(tree.source).toBe('placeholder');
    expect(tree.reason).toBe('NOT_FOUND');
  });
});
