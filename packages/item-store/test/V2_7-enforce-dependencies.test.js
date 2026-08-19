/**
 * substrate enforce-dependencies gate.
 *
 * Asserts:
 *   - Default `enforceDependencies: false` keeps V1 behaviour (no gate).
 *   - `markComplete` rejects with DependenciesOpenError when a dep is open.
 *   - `approve` rejects symmetrically when the parent has DoD-lifecycle deps.
 *   - Removed-or-missing dep is treated as satisfied (doesn't block forever).
 *   - `ctx.actionOverride` bypasses the gate AND replaces the audit action label.
 *   - `addItems` honours `ctx.actionOverride` for force-spawn audit entries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ItemStore,
  DependenciesOpenError,
} from '../src/index.js';
import { MemorySource } from '@onderling/core';

const ANNE  = 'https://id.example/anne';

describe('V2.7 — ItemStore enforce-dependencies gate', () => {
  let store;

  beforeEach(() => {
    store = new ItemStore({
      dataSource:           new MemorySource(),
      rootContainer:        'mem://test/',
      enforceDependencies:  true,
    });
  });

  it('default flag (off) keeps V1 behaviour — gate doesn\'t fire', async () => {
    const open = new ItemStore({
      dataSource: new MemorySource(),
      rootContainer: 'mem://test/',
      // no enforceDependencies
    });
    const [child] = await open.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await open.addItems(
      [{ type: 'task', text: 'P', dependencies: [child.id] }],
      { actor: ANNE },
    );
    // V1: no gate, parent closes despite open child.
    const r = await open.markComplete([{ id: parent.id }], { actor: ANNE });
    expect(r[0].completedAt).toBeGreaterThan(0);
  });

  it('markComplete rejects with DependenciesOpenError when a dep is open', async () => {
    const [child] = await store.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'P', dependencies: [child.id] }],
      { actor: ANNE },
    );
    let err;
    try {
      await store.markComplete([{ id: parent.id }], { actor: ANNE });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DependenciesOpenError);
    expect(err.code).toBe('DEPENDENCIES_OPEN');
    expect(err.openDeps).toEqual([child.id]);
  });

  it('removed-or-missing dep is treated as satisfied', async () => {
    const [child] = await store.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'P', dependencies: [child.id, 'missing-id'] }],
      { actor: ANNE },
    );
    await store.removeItems([{ id: child.id }], { actor: ANNE });
    // Both deps now missing → gate sees zero open deps → close passes.
    const r = await store.markComplete([{ id: parent.id }], { actor: ANNE });
    expect(r[0].completedAt).toBeGreaterThan(0);
  });

  it('completing the dep first then the parent works', async () => {
    const [child] = await store.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'P', dependencies: [child.id] }],
      { actor: ANNE },
    );
    await store.markComplete([{ id: child.id }], { actor: ANNE });
    const r = await store.markComplete([{ id: parent.id }], { actor: ANNE });
    expect(r[0].completedAt).toBeGreaterThan(0);
  });

  it('actionOverride bypasses the gate AND records the override label in audit', async () => {
    const [child] = await store.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'P', dependencies: [child.id] }],
      { actor: ANNE },
    );
    const r = await store.markComplete(
      [{ id: parent.id }],
      { actor: ANNE, actionOverride: 'force-complete', reason: 'project cancelled' },
    );
    expect(r[0].completedAt).toBeGreaterThan(0);
    const log = await store.auditLog({ itemId: parent.id });
    const force = log.find((e) => e.action === 'force-complete');
    expect(force).toBeTruthy();
    expect(force.details?.reason).toBe('project cancelled');
  });

  it('approve also gated when parent has open deps', async () => {
    const [child] = await store.addItems([{ type: 'task', text: 'C' }], { actor: ANNE });
    const [parent] = await store.addItems(
      [{ type: 'task', text: 'P', approval: 'creator', dependencies: [child.id] }],
      { actor: ANNE },
    );
    await store.claim(parent.id, { actor: ANNE });
    await store.submit(parent.id, {}, { actor: ANNE });
    let err;
    try {
      await store.approve(parent.id, {}, { actor: ANNE });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DependenciesOpenError);
  });

  it('addItems honours actionOverride for force-spawn audit entries', async () => {
    const [parent] = await store.addItems([{ type: 'task', text: 'P' }], { actor: ANNE });
    const [child] = await store.addItems(
      [{ type: 'task', text: 'C', parentTaskId: parent.id }],
      { actor: ANNE, actionOverride: 'force-spawn', reason: 'unreachable assignee' },
    );
    expect(child.id).toBeTruthy();
    const log = await store.auditLog({ itemId: child.id });
    const force = log.find((e) => e.action === 'force-spawn');
    expect(force).toBeTruthy();
    expect(force.details?.reason).toBe('unreachable assignee');
  });
});
