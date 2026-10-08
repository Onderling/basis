/**
 * A person admitted at the bot's INBOX DOOR by its card's code, from their own app — "an agent I admitted with".
 *
 * Typing `/start <code>` to a bot contact is the person's own act of admission; their app signs that one turn with a
 * device statement, the bot records the ROOT it chains to on the row and answers with its signed statement (the
 * identity link's shape), and from then on the row is the person's only through a device statement: a device the root
 * revoked is a stranger there, the profile key alone finds nobody, and the other devices still act as the person.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers, createDoorAdmit } from '../src/v2/botUsers.js';
import { createBotAdmission } from '../src/v2/botAdmission.js';
import { createInboxDoor } from '../src/v2/inboxDoor.js';
import { multiplexBridges } from '../src/v2/doorBridges.js';
import { createIdentityLink, createLinkTombstones } from '../src/v2/botIdentityLink.js';
import { IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';
import { linkedPerson } from './support/linkedPerson.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);
function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

const BOT = 'BOT-ADDRESS';
const NEEDS_CODE = 'circle.bot.admission_needs_code';

async function boot() {
  const sent = [];
  const told = [];
  const users = createBotUsers({ store: memStore(), adminUid: '1' });
  const tombstones = createLinkTombstones({ vault: memVault() });
  const link = createIdentityLink({
    users, botAddress: () => BOT, tombstones,
    ask: async () => ({ ok: true }), sendPrivately: async () => ({ ok: true }), tellApp: async (key, payload) => { told.push({ key, payload }); },
    listGrants: async () => [], revokeView: async () => true, where: () => ({}),
  });
  const door = await createInboxDoor({ profileKind: async () => 'function', sendTurn: async (turn) => { sent.push(turn); }, linkedRootOf: (turn) => link.verifyTurn(turn) });
  const telegram = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const admission = createBotAdmission({ secretVault: memVault(), store: memStore() });
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const cat = createDoorCatalogue({ householdManifest: mockHouseholdManifest, getApps: () => undefined, setApps: async () => {} });
  const runner = createTelegramRunner({
    bridge: multiplexBridges([telegram, door.bridge]), catalogue: cat.catalogue, manifestsByOrigin: cat.manifestsByOrigin, t, collectMs: 0,
    callSkill: withAssistantOps({ callSkill: (a, o, x) => agent.callSkill(a, o, x), threads, t, admin: { catalogue: cat, admission } }),
    admit: createDoorAdmit({ users, admission, bootstrapUids: ['1'], setDoorCaller: async () => {}, onAdmittedWith: (row, who) => link.admittedWith(row, who) }),
    threads,
  });
  await threads.load(); await runner.start();
  // the admin, on Telegram, and the Basis person whose identity is linked to that row
  await telegram.simulateIncoming({ chatId: '1', text: '/help', sender: { bridgeUid: '1' } });
  await runner.idle();
  let n = 0;
  /** A turn from the person's app, from this device (or with no statement at all). */
  const write = async (person, deviceId, text, { auth } = {}) => {
    sent.length = 0;
    n += 1;
    const messageId = `m-${n}`;
    const statement = auth !== undefined ? auth : (deviceId ? person.turn(deviceId, BOT, { text, messageId }) : undefined);
    door.feed({ contactId: person.webid, fromAddr: person.webid, text, messageId, ...(statement ? { auth: statement } : {}) });
    await runner.idle();
    return sent.map((s) => s.text).join('\n');
  };
  return { users, link, write, told, admission, rows: async () => (await users.list()).map((r) => r.id).sort() };
}

describe('a person admitted by the card\'s code, from their app', () => {
  it('a signed /start <code> admits them with their ROOT on the row, and the bot tells their app so', async () => {
    const bea = await linkedPerson();
    const d = await boot();
    await d.admission.openCohort({ ceiling: 3, days: 1 });
    const code = await d.admission.code();
    await d.write(bea, 'phone', `/start ${code}`);
    const row = (await d.users.list()).find((r) => r.channel === 'web');
    expect(row, 'admitted').toBeTruthy();
    expect(row.linkedRoot, 'the root the statement chains to').toBe(bea.root);
    expect(d.told).toEqual([expect.objectContaining({
      key: bea.webid,
      payload: expect.objectContaining({ subtype: IDENTITY_LINK_SUBTYPE, statement: expect.objectContaining({ bot: BOT, row: row.id, root: bea.root }) }),
    })]);
  });

  it('afterwards: the other devices act as them, a revoked device and the profile key alone are strangers', async () => {
    const bea = await linkedPerson();
    const d = await boot();
    await d.admission.openCohort({ ceiling: 3, days: 1 });
    await d.write(bea, 'phone', `/start ${await d.admission.code()}`);
    expect(await d.write(bea, 'laptop', '/help')).toContain('circle.bot.help_memory');
    expect(await d.write(bea, null, '/help'), 'no statement').not.toContain('circle.bot.help_memory');
    expect(await d.link.revoked(bea.revocation('laptop'))).toEqual({ ok: true });
    expect(await d.write(bea, 'laptop', '/help'), 'the revoked laptop').not.toContain('circle.bot.help_memory');
    expect(await d.write(bea, 'phone', '/help'), 'the phone still').toContain('circle.bot.help_memory');
    expect((await d.users.list()).filter((r) => r.channel === 'web')).toHaveLength(1);
  });
});
