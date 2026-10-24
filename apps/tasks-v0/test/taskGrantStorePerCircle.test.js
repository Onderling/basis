/**
 * Every circle's task grants are its own record. All circles' grant managers persist into ONE vault; under one key the
 * last circle to write overwrote the others' revocation sets, so after a restart a grant revoked in circle A was
 * live again once circle B had written.
 */
import { describe, it, expect } from 'vitest';
import { InternalBus } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBrowserMultiCircleTasksAgent } from '../src/browser.js';

const ANNE = 'https://id.example/anne';
const boot = (identityVault) => createBrowserMultiCircleTasksAgent({
  bus: new InternalBus(), identityVault,
  primaryCircleConfig: { circleId: 'circle-a', name: 'A', kind: 'household', members: [{ webid: ANNE, role: 'admin' }] },
});

describe('task grants are kept per circle', () => {
  it('revoke in A, attach in B, restart → A\'s grant is still revoked', async () => {
    const vault = new VaultMemory();
    const first = await boot(vault);
    const a = first.circlesMap.get('circle-a');
    const b = await first.ensureCircle('circle-b');
    const grant = { skill: 'listOpen', constraints: {} };
    const tokA = await a.taskGrantManager.attachGrant({ taskId: 'ta', memberPubKey: 'm1', grant });
    await a.taskGrantManager.revokeTaskGrants('ta');
    await b.taskGrantManager.attachGrant({ taskId: 'tb', memberPubKey: 'm2', grant });

    const again = await boot(vault);
    const a2 = again.circlesMap.get('circle-a');
    await a2.taskGrantManager.whenReady();
    expect(await a2.taskGrantManager.isRevoked(tokA.id)).toBe(true);
  });
});
