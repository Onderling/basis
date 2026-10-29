/**
 * A bot skill re-dispatches into a tasks skill by handler reference (`callUnderlying`), past the door gate. On a host
 * that carries every app's ops, a handler reference could name any of them — so the ids it names are pinned: each a
 * literal, each a skill the tasks wiring itself registers (manifest op or not), none `private`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { InternalBus } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBrowserMultiCircleTasksAgent } from '../src/browser.js';

const SRC = readFileSync(fileURLToPath(new URL('../src/bot/skills.js', import.meta.url)), 'utf8');

describe('callUnderlying names only tasks skills', () => {
  it('every call names a literal id, a skill the tasks wiring registers, not private', async () => {
    const calls = [...SRC.matchAll(/callUnderlying\(/g)].length - 1;   // minus the definition
    const ids = [...SRC.matchAll(/callUnderlying\(\s*\w+\s*,\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(ids.length, 'a call names its id by a variable — pin it to a literal').toBe(calls);
    // a tasks agent of its own registers exactly the tasks skills
    const { agent } = await createBrowserMultiCircleTasksAgent({
      bus: new InternalBus(), identityVault: new VaultMemory(),
      primaryCircleConfig: { circleId: 'c1', name: 'C1', kind: 'household', members: [] },
    });
    for (const id of new Set(ids)) {
      const def = agent.skills.get(id);
      expect(def, `${id} is not a tasks skill`).toBeTruthy();
      expect(def.visibility ?? 'authenticated', `${id} is private`).not.toBe('private');
    }
  });
});
