/**
 * THE DEVICE LOG COMES BACK AFTER A RELOAD — with the snapshot sealed.
 *
 * Both shells used to hydrate the device log themselves, as the first thing they did on boot. Correct
 * until the snapshot became sealed, and then silently wrong: the READ happened before the content key
 * existed, so the backend handed back the raw envelope, the loader `JSON.parse`d it and threw, and
 * `wireEventLogPersistence` caught the throw and started with an empty log — which is right for a corrupt
 * snapshot and wrong for one that is merely locked. The WRITE, later, was sealed.
 *
 * Sealed on the way out, unreadable on the way back. Every reload came up with no history at all, behind
 * one console warning. The device log is the record every lane rides, so that is circles, messages and
 * memberships converging from nothing — a device that reads as a fresh install.
 *
 * Nothing in the vitest suites could see it: the shells' own boot order is not represented anywhere, and
 * the node device-runner uses a plain file IO with no seal. It took the browser suite to notice.
 *
 * So this test does the only thing that could have caught it — it BOOTS TWICE over a sealed snapshot,
 * handing the storage over the way a shell now does and letting the agent decide when to read it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventLog } from '../../src/eventLog.js';
import { VaultNodeFs } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';
import { sealedLocalBackend, setShellContentSeal } from '../../src/v2/localStoreSeal.js';

describe('a sealed device log survives a reload', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('entries written before the reload are hydrated after it', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'devlog-seal-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'p'), pass, { mode: 0o600 });

    // ONE backend across both boots — it stands in for the browser's IndexedDB, which is what actually
    // persists here. Wrapped exactly as the shells wrap it, so what lands in it is sealed.
    const store = createMemoryBackend();
    const deviceLogIo = () => backendSnapshotIo(sealedLocalBackend(store));

    const boot = (eventLog) => createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault:      new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      deviceLog: eventLog,
      deviceLogIo: deviceLogIo(),
      seedDemoData: false, seedHousehold: false,
    });

    const firstLog = new EventLog({ initial: [], muted: [] });
    const first = await boot(firstLog);
    firstLog.append({ id: 'evt-1', kind: 'chat', ts: Date.now(), payload: { text: 'tot morgen' } });
    await new Promise((r) => setTimeout(r, 900));   // past the persist debounce
    expect(firstLog.query({}).length,
      'nothing was appended — the reload half would be vacuous').toBeGreaterThan(0);
    await first.stop?.().catch(() => {});

    // Nothing is on this disk in the clear, which is the other half of the promise.
    const keys = await store.list('');
    const dump = [];
    for (const k of keys) dump.push(JSON.stringify(await store.get(k)));
    expect(dump.join('\n'), 'the device log holds a message body in the clear').not.toContain('tot morgen');

    // ── The page reloads. ───────────────────────────────────────────────────────────────────────
    //
    // Clearing the published key is what makes this a RELOAD and not just a second boot. The key lives
    // in module state, and module state survives inside one test process — so without this the second
    // boot's early read would still find the first boot's key and the test would pass through exactly
    // the bug it exists to catch. It did, on the first run of this file. A browser starts with nothing.
    setShellContentSeal(null);

    const secondLog = new EventLog({ initial: [], muted: [] });
    const second = await boot(secondLog);
    try {
      const back = secondLog.query({});
      expect(back.length, 'the device log came back EMPTY — the snapshot was written sealed and read locked').toBeGreaterThan(0);
      expect(JSON.stringify(back)).toContain('evt-1');
    } finally {
      await second.stop?.().catch(() => {});
    }
  }, 180_000);
});
