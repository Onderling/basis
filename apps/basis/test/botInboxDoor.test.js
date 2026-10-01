/**
 * The bot's inbox is a door: on a node running a FUNCTION profile (the household bot on its own node), a contact's
 * message is answered by the same assistant that answers Telegram. On a PERSON's node the inbox is the person's, and
 * nothing answers it.
 *
 *   - the caller is the contact row's id (its `webid`), through the same gate;
 *   - the code rides the first message as a field (from the card); an admitted contact's later messages carry nothing;
 *   - a contact who is not admitted is answered ONCE with "you need a code" — once per contact, kept across a
 *     restart — and never with content (their message is still stored as any inbox message is, by the host).
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

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);
function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

const ANN = 'https://ann.example/profile#me';
const BO = 'https://bo.example/profile#me';

function box() { return { users: memStore(), admission: memStore(), vault: memVault(), threads: memoryThreadStore() }; }

async function boot(state, kind) {
  const sent = [];
  const door = await createInboxDoor({ profileKind: async () => kind, sendTurn: async (turn) => { sent.push(turn); } });
  const telegram = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const users = createBotUsers({ store: state.users, adminUid: '1' });
  const admission = createBotAdmission({ secretVault: state.vault, store: state.admission });
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: state.threads });
  const cat = createDoorCatalogue({ householdManifest: mockHouseholdManifest, getApps: () => undefined, setApps: async () => {} });
  const runner = createTelegramRunner({
    bridge: multiplexBridges([telegram, door.bridge]), catalogue: cat.catalogue, manifestsByOrigin: cat.manifestsByOrigin, t, collectMs: 0,
    callSkill: withAssistantOps({ callSkill: (a, o, x) => agent.callSkill(a, o, x), threads, t, admin: { catalogue: cat, admission } }),
    admit: createDoorAdmit({ users, admission, bootstrapUids: ['1'], setDoorCaller: async () => {} }),
    threads,
  });
  await threads.load(); await runner.start();
  const write = async (from, text, extra = {}) => {
    sent.length = 0;
    const fed = door.feed({ contactId: from, fromAddr: `addr-of-${from}`, text, ...extra });
    await runner.idle();
    return { fed, replies: sent.map((s) => s.text), to: sent.map((s) => s.peerAddr) };
  };
  const tg = async (uid, text) => { telegram.clearOutbox(); await telegram.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid } }); await runner.idle(); return telegram.outbox.map((m) => m.text).join('\n'); };
  return { write, tg, admission, users, threads };
}

describe('the bot\'s inbox door', () => {
  it('a person\'s node never answers its inbox', async () => {
    const d = await boot(box(), 'person');
    const r = await d.write(ANN, 'hallo');
    expect(r.fed).toBe(false);
    expect(r.replies).toEqual([]);
  });

  it('a function\'s node: the code on the first message admits the contact, and the assistant answers them', async () => {
    const state = box();
    const d = await boot(state, 'function');
    await d.admission.openCohort({ ceiling: 3, days: 1 });
    const code = await d.admission.code();
    const first = await d.write(ANN, 'hallo', { admission: code });
    // the inbox has no slash commands: its welcome says what to do, not "typ /help"
    expect(first.replies.join('\n')).toContain('circle.bot.welcome_talk');
    // a person who writes can be written to again: a kept "cannot reach" is cleared
    d.threads.markUnreachable(ANN, 'no-private-chat');
    await d.write(ANN, 'nog iets');
    expect(d.threads.unreachableOf(ANN)).toBeNull();
    // the reply goes to the PERSON (their id), whatever address the message came from
    expect(first.to).toEqual([ANN]);
    expect((await d.users.list()).some((u) => u.id === ANN && u.channel === 'web')).toBe(true);
    const later = await d.write(ANN, '/help');
    expect(later.replies.join('\n')).toContain('circle.bot.help_memory');
    // the same engine still answers Telegram
    expect(await d.tg('1', '/help')).toContain('circle.bot.help_memory');
  });

  it('a contact who is not admitted is told once — and not again, not even after a restart', async () => {
    const state = box();
    const first = await boot(state, 'function');
    const a = await first.write(BO, 'hallo');
    expect(a.replies.join('\n')).toContain('circle.bot.admission_needs_code');
    expect((await first.write(BO, 'hallo?')).replies).toEqual([]);
    const second = await boot(state, 'function');
    expect((await second.write(BO, 'is daar iemand')).replies, 'a restart does not repeat it').toEqual([]);
  });

  it('the same message arriving three times is answered once', async () => {
    const d = await boot(box(), 'function');
    const r = await Promise.all([1, 2, 3].map(() => d.write(BO, 'hallo', { messageId: 'same-1' })));
    expect(r.map((x) => x.fed)).toEqual([true, false, false]);
  });
});
