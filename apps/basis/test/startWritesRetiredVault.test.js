/**
 * A START WRITES NOTHING TO THE RETIRED TASKS VAULT WHEN IT IS EMPTY (ledger L1103 part 2, counted on the seeded Samsung
 * 2026-11-22). Every start sealed the retired tasks key's prefix (`basis.tasks-id:`) to read a key that had long been
 * forgotten: the seal step wrote its sentinel into the empty prefix, and the forgetting step removed it again, two
 * storage writes per start for nothing. An empty prefix holds no key to read: nothing is sealed, nothing is written.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs, VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const dirs = [];
const agents = [];
afterAll(async () => {
  for (const a of agents) await a?.stop?.().catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** A vault that counts what is written to it. */
function countingVault() {
  const v = new VaultMemory();
  const writes = [];
  const set = v.set.bind(v); const del = v.delete.bind(v);
  v.set = async (k, val) => { writes.push(`set ${k}`); return set(k, val); };
  v.delete = async (k) => { writes.push(`delete ${k}`); return del(k); };
  v.writes = writes;
  return v;
}

describe('the retired tasks vault at a start', () => {
  it('an empty prefix: not one write', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'retired-vault-'));
    dirs.push(dir);
    await writeFile(path.join(dir, 'vault.passphrase'), randomBytes(32).toString('base64url'), { mode: 0o600 });
    const pass = await readFile(path.join(dir, 'vault.passphrase'), 'utf8');
    const retired = countingVault();
    const agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      tasksIdentityVault: retired,
    });
    agents.push(agent);
    expect(retired.writes).toEqual([]);
  }, 60_000);
});
