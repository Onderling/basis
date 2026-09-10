/**
 * A BOX IS THE DEVICE THAT RESTARTS — and it must still know its own things afterwards.
 *
 * The headless always-on device is the one host expected to run for months untouched, and the one with no
 * browser storage to fall back on. `makeBrowserVault` finds no `localStorage` there and quietly returns a
 * MEMORY vault, so anything living on the chat side is forgotten every restart.
 *
 * That was survivable while the chat vault held only a cache of a key the owner root re-derives anyway.
 * It stopped being survivable the moment content was sealed at rest, because the key that content is
 * sealed under lives there: boot one wrote the person's list, boot two could not read a word of it.
 * Measured before the fix — boot 1 sees the item, boot 2 does not, with `[at-rest] … not openable with
 * this device's content key` in the log. The same fallback also loses the delegation blob that says which
 * device this is, which was already true and is fixed by the same line.
 *
 * So this test does the only thing that could have caught it: it BOOTS TWICE, the way the box does.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';

const SECRET = 'kaas-en-brood-voor-zondag-4412';

describe('a headless device still has its list after a restart', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('an item written before the restart is readable after it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'box-restart-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });

    // Exactly what `bin/device-runner.mjs` composes: durable on BOTH sides, because on a box there is
    // no browser storage behind either of them.
    const boot = () => createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault:      new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
    });

    const first = await boot();
    await first.callSkill('household', 'addItem', { type: 'shopping', text: SECRET });
    await new Promise((r) => setTimeout(r, 1200));   // past the persist adapter's debounce
    expect(JSON.stringify(await first.callSkill('household', 'listOpen', { type: 'shopping' })),
      'the item was never stored — the restart half would be vacuous').toContain(SECRET);
    await first.stop?.().catch(() => {});

    // ── The box restarts. ───────────────────────────────────────────────────────────────────────
    const second = await boot();
    try {
      expect(JSON.stringify(await second.callSkill('household', 'listOpen', { type: 'shopping' })),
        'the list did not survive the restart — the content key was not durable').toContain(SECRET);
    } finally {
      await second.stop?.().catch(() => {});
    }
  }, 180_000);
});
