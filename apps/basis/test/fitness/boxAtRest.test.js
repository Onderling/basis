/**
 * NOTHING THE BOX KEEPS ON DISK IS READABLE WITHOUT ITS KEY.
 *
 * The item stores were sealed at rest from the start; three files were not. The device log (every lane's record —
 * and, once the bot keeps its threads, the conversations), the circle policy, and the contact DM state were plain
 * JSON under the data dir. Web seals its device log; the box hydrated its own copy before the agent had a key.
 *
 * So: boot the box's own composition (`boxStores`, what `bin/device-runner.mjs` uses), write a marker into each of
 * the three, and read every byte under the data dir. The marker must be nowhere. Then restart: every marker must
 * come back, because a seal the next boot cannot open is a loss, not a protection.
 *
 * Not covered, on purpose: `enroll-offer.json` (public — it grants nothing without the phrase — written by the
 * enrol ceremony before any key exists, and cleared once consumed) and `vault.passphrase` (the key to the vaults).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { EventLog } from '../../src/eventLog.js';
import { boxStores } from '../../src/v2/boxStorage.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../../src/v2/intentionBook.js';

const LOG_WORDS = 'de-brief-van-oma-ligt-in-de-la-7731';
const POLICY_WORDS = 'alleen-op-dinsdag-open-5520';
const DM_WORDS = 'fietssleutel-onder-de-mat-9087';
const THREAD_WORDS = 'vraag-het-aan-tante-6618';
const OWN_WORDS = 'zondag-overzicht-voor-oom-7731';

async function everyFile(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...await everyFile(p));
    else out.push(p);
  }
  return out;
}

describe('the box at rest', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the device log, the circle policy and the contact DM state hold no readable words, and all come back after a restart', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'box-at-rest-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });

    const boot = async () => {
      const stores = boxStores(dir);
      const deviceLog = new EventLog({ initial: [], muted: [] });
      const agent = await createRealHouseholdAgent({
        ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
        chatVault:      new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
        householdPersistDb: { path: path.join(dir, 'household-items.json') },
        deviceLog, deviceLogIo: stores.deviceLogIo,
        seedDemoData: false, seedHousehold: false,
      });
      return { agent, deviceLog, stores, dm: await stores.contactDmSource(), threads: await stores.botThreadsSource(), own: await stores.ownDevicesSource() };
    };

    const first = await boot();
    first.deviceLog.append({ id: 'box-at-rest-1', type: 'chat', ts: Date.now(), payload: { kind: 'chat-message', text: LOG_WORDS } });
    await first.stores.circlePolicyKv.setItem('cc.circlePolicy.c1', JSON.stringify({ note: POLICY_WORDS }));
    await first.dm.write('mem://contact-dm/t1', JSON.stringify({ text: DM_WORDS }));
    await first.threads.write('mem://basis/bot-threads/t1', JSON.stringify({ id: 't1', pending: { text: THREAD_WORDS } }));
    // the own-devices store: what the box plans to do, and for whom
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: first.own }), actor: 'bot' });
    await book.load();
    await book.intend({ trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', actsAs: 'telegram:1', label: OWN_WORDS });
    await new Promise((r) => setTimeout(r, 1500));   // past the log's and the DM store's debounce
    await first.dm.flush?.();
    await first.threads.flush?.();
    await first.own.flush?.();
    await first.agent.stop?.().catch(() => {});

    const leaks = [];
    for (const f of await everyFile(dir)) {
      if (path.basename(f) === 'vault.passphrase') continue;
      const text = (await readFile(f)).toString('latin1');
      for (const w of [LOG_WORDS, POLICY_WORDS, DM_WORDS, THREAD_WORDS, OWN_WORDS]) if (text.includes(w)) leaks.push(`${path.relative(dir, f)}: ${w}`);
    }
    expect(leaks, 'words readable on disk').toEqual([]);

    // ── The box restarts: a seal the next boot cannot open would be a loss. ─────────────────────────
    const second = await boot();
    try {
      expect(JSON.stringify(second.deviceLog.query({})), 'the device log came back').toContain(LOG_WORDS);
      expect(await second.stores.circlePolicyKv.getItem('cc.circlePolicy.c1'), 'the policy came back').toContain(POLICY_WORDS);
      expect(JSON.stringify(await second.dm.read('mem://contact-dm/t1')), 'the DM state came back').toContain(DM_WORDS);
      expect(JSON.stringify(await second.threads.read('mem://basis/bot-threads/t1')), 'the thread row came back').toContain(THREAD_WORDS);
      const again = createIntentionBook({ store: createOwnDevicesStore({ dataSource: second.own }), actor: 'bot' });
      await again.load();
      expect(again.rows().map((r) => r.label), 'the planned work came back').toEqual([OWN_WORDS]);
    } finally {
      await second.agent.stop?.().catch(() => {});
    }
  }, 180_000);

  it('a box that kept a plain device-log.json before this comes up with its log, sealed at once, and the plain file gone', async () => {
    const d = await mkdtemp(path.join(tmpdir(), 'box-at-rest-legacy-'));
    try {
      const pass = randomBytes(32).toString('base64url');
      await writeFile(path.join(d, 'device-log.json'), JSON.stringify([{ id: 'old-1', type: 'chat', ts: Date.now() - 60_000, seq: 1, payload: { kind: 'chat-message', text: LOG_WORDS } }]));
      const deviceLog = new EventLog({ initial: [], muted: [] });
      const agent = await createRealHouseholdAgent({
        ownerRootVault: new VaultNodeFs(path.join(d, 'vault.json'), pass),
        chatVault:      new VaultNodeFs(path.join(d, 'chat-vault.json'), pass),
        deviceLog, deviceLogIo: boxStores(d).deviceLogIo,
        seedDemoData: false, seedHousehold: false,
      });
      expect(JSON.stringify(deviceLog.query({})), 'the old entries were imported').toContain(LOG_WORDS);
      await agent.stop?.().catch(() => {});
      // no append needed: a quiet box must not keep the plain copy until something happens
      const names = await readdir(d);
      expect(names, 'the plain file is gone once imported').not.toContain('device-log.json');
      for (const f of await everyFile(d)) expect((await readFile(f)).toString('latin1')).not.toContain(LOG_WORDS);
    } finally { await rm(d, { recursive: true, force: true }).catch(() => {}); }
  }, 180_000);
});
