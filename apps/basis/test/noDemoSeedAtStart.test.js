/**
 * A start writes no demo items (ledger L1069). The household's three demo items (Milk, Post a parcel, Vacuum living
 * room) were written at EVERY start of a shell that did not opt out — web and phone did not — so a device with a
 * persisted store grew by three items per start. They are demo data now, behind `seedDemoData: true`, and what piled
 * up on a device is removed once: only items by the demo author with a demo text, never a person's own.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { sweepDemoSeedOnce, DEMO_SEED_SWEPT_KEY } from '../src/core/agent/demoHouseholdSeed.js';

const SEED_TEXTS = ['Milk', 'Post a parcel', 'Vacuum living room'];
const DEMO_AUTHOR = 'webid:local-demo-user';

const dirs = [];
const agents = [];
afterAll(async () => {
  for (const a of agents) await a?.stop?.().catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function deviceDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'no-demo-seed-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'vault.passphrase'), randomBytes(32).toString('base64url'), { mode: 0o600 });
  return dir;
}
/** One start of a device: the same vaults and the same persisted store every time, the shell's other options default. */
async function boot(dir, extra = {}) {
  const pass = await readFile(path.join(dir, 'vault.passphrase'), 'utf8');
  const agent = await createRealHouseholdAgent({
    ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
    chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
    householdPersistDb: { path: path.join(dir, 'household-items.json') },
    ...extra,
  });
  agents.push(agent);
  return agent;
}
/** The store saves on a timer: wait until its file has stopped changing, as a restart comes after the last save. */
async function saved(dir) {
  const { stat } = await import('node:fs/promises');
  let last = null; let same = 0;
  for (let i = 0; i < 100 && same < 4; i += 1) {
    const now = await stat(path.join(dir, 'household-items.json')).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => null);
    same = now === last ? same + 1 : 0;
    last = now;
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function restart(agent, dir) { await saved(dir); await agent?.stop?.().catch(() => {}); }
const demoCopies = (items) => items.filter((i) => i.createdBy === DEMO_AUTHOR && SEED_TEXTS.includes(i.text));

describe('a start writes no demo items', () => {
  it('a default start writes none, and a second start holds no more than the first', async () => {
    const dir = await deviceDir();
    const first = await boot(dir);
    const afterFirst = await first.householdItems();
    expect(demoCopies(afterFirst)).toEqual([]);
    expect((await first.state()).length).toBe(0);
    await restart(first, dir);

    const second = await boot(dir);
    const afterSecond = await second.householdItems();
    expect(afterSecond.length).toBeLessThanOrEqual(afterFirst.length);
    expect(demoCopies(afterSecond)).toEqual([]);
    await restart(second, dir);
  }, 120_000);

  it('a demo start still asks for them explicitly', async () => {
    const dir = await deviceDir();
    const demo = await boot(dir, { seedDemoData: true });
    expect((await demo.state()).map((i) => i.text).sort()).toEqual([...SEED_TEXTS].sort());
    await restart(demo, dir);
  }, 120_000);

  it('what piled up is removed once: nine demo copies go, a person\'s own "Milk" stays, a later start writes nothing', async () => {
    const dir = await deviceDir();
    // three starts of the version that seeded at every start leave nine copies (a demo start writes them as it did)
    for (let i = 0; i < 3; i += 1) {
      const old = await boot(dir, { seedDemoData: true });
      if (i === 2) {
        const r = await old.callSkill('household', 'addItem', { type: 'shopping', text: 'Milk' });
        expect(r?.ok, JSON.stringify(r)).not.toBe(false);
      }
      await restart(old, dir);
    }
    {
      // the copies are there before the sweep, and the person's own item is by someone else (a demo start sweeps nothing)
      const probe = await boot(dir, { seedDemoData: true, seedHousehold: false });
      const before = await probe.householdItems();
      expect(demoCopies(before)).toHaveLength(9);
      expect(before.filter((i) => i.text === 'Milk' && i.createdBy !== DEMO_AUTHOR)).toHaveLength(1);
      await restart(probe, dir);
    }

    const now = await boot(dir);
    const after = await now.householdItems();
    expect(demoCopies(after)).toEqual([]);
    expect(after.map((i) => i.text)).toEqual(['Milk']);
    expect(after[0].createdBy).not.toBe(DEMO_AUTHOR);
    await restart(now, dir);

    // a start with nothing to remove writes nothing: the store's bytes are what the last start left
    const bytes = await readFile(path.join(dir, 'household-items.json'), 'utf8');
    const later = await boot(dir);
    expect((await later.householdItems()).map((i) => i.text)).toEqual(['Milk']);
    await restart(later, dir);
    expect(await readFile(path.join(dir, 'household-items.json'), 'utf8')).toBe(bytes);
  }, 180_000);
});

describe('the removal runs at most once per device', () => {
  const memVault = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, m }; };
  const memStore = (items) => {
    const rows = new Map(items.map((i) => [i.id, i]));
    const deletes = [];
    return { list: async () => [...rows.values()], delete: async (id, o) => { deletes.push({ id, o }); rows.delete(id); }, rows, deletes };
  };
  it('removes only demo copies, without fanning, keeps the mark, and a second pass touches nothing', async () => {
    const vault = memVault();
    const store = memStore([
      { id: 'a', text: 'Milk', createdBy: DEMO_AUTHOR },
      { id: 'b', text: 'Milk', createdBy: 'pubkey-of-a-person' },
      { id: 'c', text: 'Bread', createdBy: DEMO_AUTHOR },
    ]);
    expect(await sweepDemoSeedOnce({ store, markerVault: vault })).toEqual({ ran: true, removed: 1 });
    expect(store.deletes).toEqual([{ id: 'a', o: { sync: false } }]);
    expect(JSON.parse(vault.m.get(DEMO_SEED_SWEPT_KEY)).removed).toBe(1);
    store.rows.set('d', { id: 'd', text: 'Milk', createdBy: DEMO_AUTHOR });
    expect(await sweepDemoSeedOnce({ store, markerVault: vault })).toEqual({ ran: false, removed: 0 });
    expect(store.rows.has('d')).toBe(true);
  });
});
