/**
 * A person's tap that writes in a circle asks that circle's capability set at the outer waist (ledger L1042).
 *
 * @guard a write a circle switched off is refused when tapped, the same refusal as the typed line; a door-less call (plumbing, a screen's own write) is not asked
 *
 * Before: only the chat and bubble routes asked the circle; a tap went to `callSkill` directly, so a switched-off
 * capability could still be used by tapping. The real agent, its real outer waist; the circle's policy comes from the
 * one reader a shell hands in (`circleCapabilityInputs`).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const CIRCLE = 'tap-gate-circle';
const OFF = { capabilities: { 'lists add list-item': { enabled: false } } };

describe('a tap asks the circle', () => {
  let dir; let agent; let policy = {};
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('boots with the reader a shell hands in', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tap-gate-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      getActiveCircleId: () => CIRCLE,
      circleCapabilityInputs: async (circleId) => { if (circleId === 'broken-store') throw new Error('store down'); return circleId === CIRCLE ? { policy, override: {} } : null; },
    });
    expect((await agent.callSkill('lists', 'createList', { circleId: CIRCLE, text: 'Boodschappen' }))?.ok).toBe(true);
  }, 30_000);

  it('with the row on, a tap adds', async () => {
    policy = {};
    const r = await agent.callSkill('lists', 'addToList', { circleId: CIRCLE, list: 'Boodschappen', text: 'melk' }, { door: 'tap' });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
  });

  it('with the row off, the tap is refused with the gate\'s own refusal (as the typed line is)', async () => {
    policy = OFF;
    const r = await agent.callSkill('lists', 'addToList', { circleId: CIRCLE, list: 'Boodschappen', text: 'kaas' }, { door: 'tap' });
    expect(r).toMatchObject({ ok: false, code: 'capability-denied', refusal: { layer: 'availability', code: 'capability-denied' } });
    const rows = await agent.circleStoreFor(CIRCLE).list();
    expect(rows.some((x) => x.text === 'kaas'), 'nothing was written').toBe(false);
  });

  it('the circle named by the active view counts when the args name none', async () => {
    const r = await agent.callSkill('lists', 'addToList', { list: 'Boodschappen', text: 'brood' }, { door: 'tap' });
    expect(r?.ok).toBe(false);
  });

  it('an app the circle switched off refuses the tap as app-disabled (as the typed line is)', async () => {
    policy = { features: { tasks: false } };
    const r = await agent.callSkill('tasks', 'addTask', { circleId: CIRCLE, text: 'ramen lappen' }, { door: 'tap' });
    expect(r).toMatchObject({ ok: false, code: 'app-disabled', refusal: { layer: 'availability', code: 'app-disabled' } });
    policy = OFF;
  });

  it('a door-less call (plumbing, a screen\'s own write) is not asked; nor is a read', async () => {
    const r = await agent.callSkill('lists', 'addToList', { circleId: CIRCLE, list: 'Boodschappen', text: 'eieren' });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    const read = await agent.callSkill('lists', 'listEntries', { circleId: CIRCLE, list: 'Boodschappen' }, { door: 'tap' });
    expect(read?.ok).toBe(true);
  });

  it('a reader that throws lets the act go on, and the log says so in codes', async () => {
    const { processRefusalLog } = await import('../src/v2/refusalLog.js');
    const before = processRefusalLog().size;
    const r = await agent.callSkill('lists', 'createList', { circleId: 'broken-store', text: 'X' }, { door: 'tap' });
    expect(r?.refusal).toBeUndefined();
    expect(processRefusalLog().size, 'one coded line: gate · availability · circle-inputs · reader-threw').toBe(before + 1);
  });
});
