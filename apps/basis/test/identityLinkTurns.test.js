/**
 * A linked person's turn at the bot's INBOX DOOR — from their own app, as the Telegram row their identity is linked to.
 *
 * A turn is the person's when it carries a statement from one of their DEVICES (signed with its delegation key, the
 * root-signed delegation beside it) over exactly this turn — its text and its message id — for this bot, and the root
 * it chains to is the one the row recorded. The profile key, which every device holds (a revoked one too), finds
 * nobody. A device the root revoked — its tombstone delivered to the bot — is a stranger from then on; the person's
 * other devices still act as them.
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
import { linkedPerson } from './support/linkedPerson.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);
function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

const BOT = 'BOT-ADDRESS';
const NEEDS_CODE = 'circle.bot.admission_needs_code';

async function boot() {
  const sent = [];
  const users = createBotUsers({ store: memStore(), adminUid: '1' });
  const tombstones = createLinkTombstones({ vault: memVault() });
  const link = createIdentityLink({
    users, botAddress: () => BOT, tombstones,
    ask: async () => ({ ok: true }), sendPrivately: async () => ({ ok: true }), tellApp: async () => {},
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
    admit: createDoorAdmit({ users, admission, bootstrapUids: ['1'], setDoorCaller: async () => {} }),
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
  return { users, link, write, rows: async () => (await users.list()).map((r) => r.id).sort() };
}

describe('a linked person\'s turn at the inbox door', () => {
  it('a revoked device\'s turn is a stranger\'s; the other devices\' turns still act as the person', async () => {
    const ann = await linkedPerson();
    const d = await boot();
    expect(await d.users.linkKey('telegram:1', { root: ann.root, webid: ann.webid })).toEqual({ ok: true });
    // from the phone and from the laptop: the admin's row (no code asked, no second row)
    expect(await d.write(ann, 'phone', '/help')).toContain('circle.bot.help_memory');
    expect(await d.write(ann, 'laptop', '/help')).toContain('circle.bot.help_memory');
    expect(await d.rows()).toEqual(['telegram:1']);
    // the laptop is revoked: the root's tombstone reaches the bot
    expect(await d.link.revoked(ann.revocation('laptop'))).toEqual({ ok: true });
    expect(await d.write(ann, 'laptop', 'hallo')).toContain(NEEDS_CODE);
    expect(await d.rows()).toEqual(['telegram:1']);
    // the phone still speaks as the person
    expect(await d.write(ann, 'phone', '/help')).toContain('circle.bot.help_memory');
  });

  it('the profile key alone (no statement) is a stranger, however linked the person is', async () => {
    const ann = await linkedPerson();
    const d = await boot();
    await d.users.linkKey('telegram:1', { root: ann.root, webid: ann.webid });
    expect(await d.write(ann, null, 'hallo')).toContain(NEEDS_CODE);
  });

  it('a statement over another turn, for another bot, or from another root: a stranger', async () => {
    const ann = await linkedPerson();
    const eve = await linkedPerson();
    const d = await boot();
    await d.users.linkKey('telegram:1', { root: ann.root, webid: ann.webid });
    // a stranger is told once that a code is needed, then nothing; never the person's answer
    const stranger = (reply) => !reply.includes('circle.bot.help_memory') && (reply === '' || reply.includes(NEEDS_CODE));
    // made for other words
    expect(stranger(await d.write(ann, 'phone', '/help', { auth: ann.turn('phone', BOT, { text: 'iets anders', messageId: 'm-1' }) }))).toBe(true);
    // made for another bot
    expect(stranger(await d.write(ann, 'phone', '/help', { auth: ann.turn('phone', 'ANOTHER-BOT', { text: '/help', messageId: 'm-2' }) }))).toBe(true);
    // a device of another root, under Ann's chat identity: nobody's row
    expect(stranger(await d.write({ ...eve, webid: ann.webid }, 'laptop', '/help'))).toBe(true);
    expect(await d.rows()).toEqual(['telegram:1']);
    // and Ann's own device, for comparison: the person
    expect(await d.write(ann, 'phone', '/help')).toContain('circle.bot.help_memory');
  });

  it('a turn held while the bot was away (an hour) still acts as the person; a statement older than a held turn can be does not', async () => {
    const ann = await linkedPerson();
    const d = await boot();
    await d.users.linkKey('telegram:1', { root: ann.root, webid: ann.webid });
    const hourAgo = () => Date.now() - 60 * 60 * 1000;
    expect(await d.write(ann, 'phone', '/help', { auth: ann.turn('phone', BOT, { text: '/help', messageId: 'm-1' }, { now: hourAgo }) })).toContain('circle.bot.help_memory');
    const twoDaysAgo = () => Date.now() - 2 * 24 * 60 * 60 * 1000;
    expect(d.link.verifyTurn({ auth: ann.turn('phone', BOT, { text: 'x', messageId: 'old-1' }, { now: twoDaysAgo }), text: 'x', messageId: 'old-1' })).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('a turn\'s statement replayed is refused', async () => {
    const ann = await linkedPerson();
    const d = await boot();
    await d.users.linkKey('telegram:1', { root: ann.root, webid: ann.webid });
    const st = ann.turn('phone', BOT, { text: 'hallo', messageId: 'x-1' });
    expect(d.link.verifyTurn({ auth: st, text: 'hallo', messageId: 'x-1' })).toMatchObject({ ok: true, root: ann.root });
    expect(d.link.verifyTurn({ auth: st, text: 'hallo', messageId: 'x-1' })).toMatchObject({ ok: false, reason: 'replayed' });
  });
});
