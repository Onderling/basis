/**
 * Who may start talking to the household bot: a person with a code the admin handed out.
 *
 * Before: an open door (anyone who found the bot) or an allow-list of chat ids nobody could find — and a stranger
 * was told their own chat id. Now the admin opens a cohort (`/cohort <people> <days>`) and hands out codes
 * (`/invite`); a person sends `/start <code>` and is admitted, once per code. Anyone else is told they need a code
 * and nothing more. A restart keeps who was admitted; `/revoke <name>` drops a person; `/rotate` closes the cohort.
 * The bot's own bootstrap (its admin's uid, a configured allow-list) is admitted without a code.
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

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);

function memStore() { const m = new Map(); return { m, get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

/** One box's stores — kept across a "restart" (a new door over the same stores). */
function boxState() { return { users: memStore(), admission: memStore(), vault: memVault(), clock: { now: Date.now() } }; }

async function door(state, { adminUid = '1', bootstrapUids = [] } = {}) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const users = createBotUsers({ store: state.users, adminUid });
  const admission = createBotAdmission({ secretVault: state.vault, store: state.admission, now: () => state.clock.now });
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const tiers = new Map();
  const doorCatalogue = createDoorCatalogue({ householdManifest: mockHouseholdManifest, getApps: () => undefined, setApps: async () => {} });
  const runner = createTelegramRunner({
    bridge, catalogue: doorCatalogue.catalogue, manifestsByOrigin: doorCatalogue.manifestsByOrigin, t, collectMs: 0,
    callSkill: withAssistantOps({
      callSkill: (app, op, args) => agent.callSkill(app, op, args), threads, t,
      refusal: async (_op, caller, visibility) => (visibility === 'trusted' && tiers.get(caller) !== 'admin' ? 'INSUFFICIENT_TIER' : null),
      admin: { catalogue: doorCatalogue, users: () => users.list(), admission, revoke: (name) => users.revoke(name) },
    }),
    admit: createDoorAdmit({
      users, admission, bootstrapUids: [adminUid, ...bootstrapUids],
      setDoorCaller: async (id, role) => { tiers.set(id, role); },
      clearDoorCaller: async (id) => { tiers.delete(id); },
    }),
    threads,
  });
  await threads.load(); await runner.start();
  const say = async (uid, text) => { bridge.clearOutbox(); await bridge.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid, displayName: `P${uid}` } }); await runner.idle(); return bridge.outbox.map((m) => m.text).join('\n'); };
  return { say, users, admission };
}

const codeIn = (text) => /([0-9a-f]{16}-[0-9a-f]{12})/.exec(text)?.[1] ?? null;

describe('admission by code', () => {
  it('a stranger is told they need a code — never their chat id; the admin is admitted without one', async () => {
    const d = await door(boxState());
    const out = await d.say('777', 'hallo');
    expect(out).toContain('circle.bot.admission_needs_code');
    expect(out).not.toContain('777');
    expect((await d.users.list()).map((u) => u.id)).toEqual([]);
    expect(await d.say('1', '/help')).toContain('circle.bot.welcome');
    expect((await d.users.list()).map((u) => u.id)).toEqual(['telegram:1']);
  });

  it('/cohort and /invite from the admin; /start <code> admits once; a second use is refused', async () => {
    const d = await door(boxState());
    await d.say('1', '/cohort 5 7');
    const code = codeIn(await d.say('1', '/invite'));
    expect(code, 'the admin got a code').toBeTruthy();
    const ann = await d.say('20', `/start ${code}`);
    expect(ann).toContain('circle.bot.welcome');
    expect((await d.users.list()).some((u) => u.id === 'telegram:20' && u.role === 'member')).toBe(true);
    expect(await d.say('20', '/help')).not.toContain('admission');
    expect(await d.say('21', `/start ${code}`)).toContain('circle.bot.admission_code_used');
  });

  it('an expired or a full cohort says why', async () => {
    const s = boxState();
    const d = await door(s);
    await d.say('1', '/cohort 1 1');
    const a = codeIn(await d.say('1', '/invite'));
    const b = codeIn(await d.say('1', '/invite'));
    await d.say('30', `/start ${a}`);
    expect(await d.say('31', `/start ${b}`)).toContain('circle.bot.admission_cohort_full');
    await d.say('1', '/cohort 3 1');
    const c = codeIn(await d.say('1', '/invite'));
    s.clock.now += 2 * 24 * 60 * 60 * 1000;
    expect(await d.say('32', `/start ${c}`)).toContain('circle.bot.admission_cohort_expired');
  });

  it('a restart keeps who was admitted; /revoke drops a person; /rotate closes the cohort', async () => {
    const s = boxState();
    const first = await door(s);
    await first.say('1', '/cohort 5 7');
    const code = codeIn(await first.say('1', '/invite'));
    await first.say('40', `/start ${code}`);

    const second = await door(s);
    expect(await second.say('40', '/help'), 'still admitted after a restart').not.toContain('admission_needs_code');
    await second.say('1', '/revoke P40');
    expect(await second.say('40', '/help'), 'revoked').toContain('circle.bot.admission_needs_code');

    const next = codeIn(await second.say('1', '/invite'));
    await second.say('1', '/rotate');
    expect(await second.say('41', `/start ${next}`)).toContain('circle.bot.admission_no_cohort');
  });

  it('a member cannot open a cohort or hand out codes', async () => {
    const s = boxState();
    const d = await door(s, { bootstrapUids: ['50'] });
    expect(await d.say('50', '/cohort 5 7')).toContain('circle.bot.admin_only');
    expect(await d.say('50', '/invite')).toContain('circle.bot.admin_only');
    expect(await d.admission.status()).toBeNull();
  });
});
