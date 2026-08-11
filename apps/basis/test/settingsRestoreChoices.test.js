/**
 * #44 — the restore choices, wired through the REAL boot (the two seams the shells paint):
 *
 *   • OPENABLE with differing values → `onSettingsConflicts` fires with the per-param diff,
 *     captured BEFORE the local-wins flush; `keepTheirs(key)` adopts the pod value through
 *     the one kind-gated `set-param` write.
 *   • UNDECRYPTABLE → `onSettingsKeyMismatch` fires carrying the ONE explicit `overwrite`
 *     action; nothing is written until it is called.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { CachingDataSource } from '@onderling/local-store';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { SETTINGS_SHARED_PROBE_PATH } from '../src/v2/settingsRestoreGate.js';

const KEY = 'nearby.ask.defaultTtlMs';   // a real registered agent-scope param

function fakeMedium({ blob, sealed = false }) {
  const writes = [];
  return {
    writes,
    read: async () => {
      if (sealed) throw new Error('sealing: secretbox open failed');
      return blob;
    },
    write: async (path, data) => { writes.push({ path, data }); },
    delete: async () => {},
    list: async () => [],
  };
}

describe('the restore choices (through the real boot)', () => {
  it('openable + differing values → the conflict list fires, and keepTheirs adopts the pod value', async () => {
    const medium = fakeMedium({ blob: { [KEY]: 111_000 } });
    let seen = null;
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 222_000 });   // this device's local copy
    const a = await createRealHouseholdAgent({
      seedHousehold: false,
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
      settingsDataSource: ds,
      provisionSettingsMedium: async () => medium,
      onSettingsConflicts: (x) => { seen = x; },
    });

    expect(seen).not.toBe(null);
    expect(seen.conflicts).toEqual([{ key: KEY, mine: 222_000, theirs: 111_000 }]);

    const r = await seen.keepTheirs(KEY);
    expect(r.ok).toBe(true);
    const got = await a.callSkill('params', 'get-param', { key: KEY });
    expect(got.value).toBe(111_000);                                   // the pod's value adopted
  });

  it('identical values → no conflict hook', async () => {
    const medium = fakeMedium({ blob: { [KEY]: 5 } });
    let fired = false;
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 5 });
    await createRealHouseholdAgent({
      seedHousehold: false,
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
      settingsDataSource: ds,
      provisionSettingsMedium: async () => medium,
      onSettingsConflicts: () => { fired = true; },
    });
    expect(fired).toBe(false);
  });

  it('undecryptable → the mismatch hook carries overwrite; nothing flushes until it is called', async () => {
    const medium = fakeMedium({ blob: null, sealed: true });
    let mismatch = null;
    const ds = new CachingDataSource();
    await ds.write(SETTINGS_SHARED_PROBE_PATH, { [KEY]: 9 });
    await createRealHouseholdAgent({
      seedHousehold: false,
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
      settingsDataSource: ds,
      provisionSettingsMedium: async () => medium,
      onSettingsKeyMismatch: (x) => { mismatch = x; },
    });

    expect(typeof mismatch?.overwrite).toBe('function');
    expect(medium.writes).toHaveLength(0);                             // HELD — no silent write

    const r = await mismatch.overwrite();                              // the explicit act
    expect(r.ok).toBe(true);
    expect(medium.writes.length).toBeGreaterThan(0);                   // now, and only now, it flushed
  });
});
