/**
 * THROUGH THE REAL BOOT: A DEVICE LOG THIS BUILD CANNOT READ IS SAID, AND NOT SAVED OVER.
 *
 * The agent hydrates the device log itself (`wireEventLogPersistence`, one call site in realAgent). Booted over a
 * stored log whose manifest does not parse, the agent must come up (never a broken boot), the device's one register
 * must name the log (kind messages), and an append in this run must leave the stored bytes exactly as they were.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventLog } from '../../src/eventLog.js';
import { VaultNodeFs } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { notReadableStores, resetNotReadableStores } from '@onderling/local-store';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';

const REF = 'device-log/events.json';
const TORN = '{"v":1,"segments":[{"key":"device-log/ev';

describe('a device log the build cannot read, through the real boot', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the agent comes up, the log is named in the register, and an append writes nothing over it', async () => {
    resetNotReadableStores();
    dir = await mkdtemp(path.join(tmpdir(), 'devlog-unreadable-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'p'), pass, { mode: 0o600 });
    const store = createMemoryBackend();
    await store.put(REF, TORN);
    await store.put(`${REF}/seg/0000`, '[{"id":"old"}]');

    const log = new EventLog({ initial: [], muted: [] });
    const agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault:      new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      deviceLog: log,
      deviceLogIo: backendSnapshotIo(store),
      seedDemoData: false, seedHousehold: false,
    });
    try {
      expect(notReadableStores()).toContainEqual({ name: 'device-log', kind: 'messages', reason: 'unparseable' });
      log.append({ id: 'evt-new', kind: 'chat', ts: Date.now(), payload: { text: 'x' } });
      await new Promise((r) => setTimeout(r, 900));   // past the persist debounce
      const head = await store.get(REF);
      const bytes = typeof head.bytes === 'string' ? head.bytes : new TextDecoder().decode(head.bytes);
      expect(bytes, 'the unreadable manifest was written over').toBe(TORN);
      expect(await store.get(`${REF}/seg/0000`), 'an old segment was swept').not.toBeNull();
    } finally {
      await agent.stop?.().catch(() => {});
    }
  }, 60_000);
});
