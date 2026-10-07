/**
 * A household bot composed as the box composes it, for what a change tells others: the real agent with the bot's door
 * gate and its people, the door, the store's write hook into the change feed, the household's announce rows, and the
 * runner that hands a fired row to the door as the host. Messages are caught, not sent.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../../src/v2/householdTemplate.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../../src/v2/householdBotStore.js';
import { botOpLevel, botRoleAllows } from '../../src/v2/botOpMap.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { createAnnouncer } from '../../src/v2/announcements.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../../src/v2/intentionBook.js';
import { createIntentionRunner } from '../../src/v2/intentionRunner.js';
import { createChangeFeed } from '../../src/v2/changeFeed.js';
import { seedAnnounceRows, ANNOUNCE_OP, HOUSEHOLD_ACTS_AS, HOST_CALL } from '../../src/v2/announceRows.js';

/**
 * @param {object} a
 * @param {Function} a.t
 * @param {string} a.tz
 * @param {Array<{id: string, name: string, role: string}>} a.people
 */
export async function bootAnnouncingBox({ t, tz, people }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'announcing-box-'));
  const pass = randomBytes(32).toString('base64url');
  await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
  const circleWrite = { fn: null };
  const agent = await createRealHouseholdAgent({
    ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
    householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false, ...HOUSEHOLD_BOT_STORE_OPTS, t,
    doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows,
    onCircleWrite: (circleId, item, removedId) => circleWrite.fn?.(circleId, item, removedId),
  });
  // the door's context says who did it, as on the box (the write is stamped with them)
  const own = (a, o, x, ctx) => agent.callSkill(a, o, x, ctx);
  await ensureHouseholdLists({ callSkill: (a, o, x) => own(a, o, x), t });
  for (const p of people) {
    await own('stoop', 'addContact', { webid: p.id, channel: 'telegram', role: p.role, displayName: p.name });
    await agent.setDoorCaller(p.id, p.role);
  }
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const sent = [];
  const log = new EventLog({ initial: [], muted: [] });
  const announcer = createAnnouncer({
    users: { list: async () => people.map((p) => ({ id: p.id, role: p.role })) }, threads, t, tz, quiet: () => null,
    reach: { sendToPerson: async (id, m) => { sent.push({ id, text: m.text }); return { ok: true }; } }, log,
  });
  const door = withAssistantOps({ callSkill: own, threads, t, announcer });
  // the box's planned work: the household's announce rows, run on a change, as the host
  const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: () => agent.heldCircleStores(), actor: 'host' });
  const seeded = await seedAnnounceRows(book, agent.householdCircleId);
  const runner = createIntentionRunner({
    book, log, tz, claimAs: 'box',
    mayRun: (o) => (o.op === ANNOUNCE_OP && o.actsAs === HOUSEHOLD_ACTS_AS ? true : 'refused'),
    run: (o) => door(o.appOrigin, o.op, { ...o.args, occurrence: o.id }, { [HOST_CALL]: true }),
  });
  const feed = createChangeFeed({ storeFor: async (id) => (await agent.heldCircleStores()).find((c) => c.scope === id)?.store ?? null, consumers: [(c, o) => runner.onChange(c, o)] });
  await feed.seedAll((await agent.heldCircleStores()).map((c) => c.scope));
  const pending = [];
  circleWrite.fn = (circleId, item, removedId) => pending.push(removedId ? feed.removed(circleId, removedId) : feed.own(circleId, item));
  /** Every change made so far has been handed to the rows (and told). */
  const settled = async () => { while (pending.length) await pending.shift(); };
  return { dir, agent, own, door, sent, settled, seeded, book };
}
