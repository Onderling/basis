/**
 * The household circle is wired at boot, before the rest of the factory runs. Its wiring also asks for
 * the restart's re-fan of owed chat lines; that state was declared below the boot call, so on every
 * composition with a device log (the box, web, the phone) the household's wiring threw a
 * "before initialization" error, was caught, and logged "store<->mirror NOT wired". The publish hook was
 * already set, so items still fanned out; the household's re-fan and its "wired" mark were lost.
 * A real boot must log no caught wiring failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('the household circle at boot', () => {
  it('wires without a caught failure when the composition has a device log', async () => {
    const warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => { warns.push(a.map(String).join(' ')); });
    await createRealHouseholdAgent({
      seedHousehold: false,
      ownerRootVault: new VaultMemory(),
      chatVault: new VaultMemory(),
      deviceLog: new EventLog({ initial: [], muted: [] }),
    });
    expect(warns.filter((w) => w.includes('NOT wired'))).toEqual([]);
  });
});
