/**
 * An invite carries the role its person gets (Fable's third addition, 2026-10-05): `/invite observer` makes a code that
 * admits an OBSERVER; the role is inside the code's HMAC, so a code whose role word is changed or dropped is
 * `invalid-code` (a tampered link admits nobody at a higher role). Without a word: a member, as before, and a member's
 * code keeps its old shape. A cohort may carry a default role (`/cohort 3 7 observer`).
 */
import { describe, it, expect } from 'vitest';
import { createBotAdmission } from '../src/v2/botAdmission.js';

function admission() {
  const secrets = new Map(); const rows = new Map();
  return createBotAdmission({
    secretVault: { get: async (k) => secrets.get(k), set: async (k, v) => { secrets.set(k, v); } },
    store: { get: async (id) => rows.get(id) ?? null, put: async (r) => { rows.set(r.id, r); return r; } },
  });
}

describe('an invite carries a role', () => {
  it('an observer\'s code admits an observer; a member\'s keeps the old shape', async () => {
    const a = admission();
    await a.openCohort({ ceiling: 5, days: 7 });
    const obs = await a.code({ role: 'observer' });
    expect(await a.redeem(obs)).toEqual({ ok: true, role: 'observer' });
    const mem = await a.code();
    expect(mem).toMatch(/^[0-9a-f]{16}-[0-9a-f]{12}$/);
    expect(await a.redeem(mem)).toEqual({ ok: true, role: 'member' });
  });

  it('the role word changed or dropped: invalid-code', async () => {
    const a = admission();
    await a.openCohort({ ceiling: 5, days: 7 });
    const obs = await a.code({ role: 'observer' });
    const [nonce, sig] = obs.split('-');
    expect(await a.redeem(`${nonce}-${sig}-c`)).toEqual({ ok: false, reason: 'invalid-code' });   // observer → coordinator
    expect(await a.redeem(`${nonce}-${sig}`)).toEqual({ ok: false, reason: 'invalid-code' });     // the role dropped
    expect((await a.redeem(obs)).ok).toBe(true);
  });

  it('a cohort\'s default role', async () => {
    const a = admission();
    await a.openCohort({ ceiling: 5, days: 7, role: 'observer' });
    expect(await a.redeem(await a.code())).toEqual({ ok: true, role: 'observer' });
    expect(await a.redeem(await a.code({ role: 'member' }))).toEqual({ ok: true, role: 'member' });
  });
});

describe('the person admitted with the code gets its role', () => {
  it('an observer\'s code: an observer; the first person is still the admin; /invite observer mints one', async () => {
    const { createBotUsers, createDoorAdmit } = await import('../src/v2/botUsers.js');
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const rows = new Map();
    const users = createBotUsers({ store: { get: async (id) => rows.get(id) ?? null, put: async (r) => { rows.set(r.id, r); return r; }, list: async () => [...rows.values()] } });
    const a = admission();
    await a.openCohort({ ceiling: 5, days: 7 });
    const doorAdmit = createDoorAdmit({ users, setDoorCaller: async () => {}, admission: a });
    await doorAdmit({ channel: 'telegram', uid: '1', admission: await a.code() });   // the first: the admin
    const door = withAssistantOps({ callSkill: async () => ({ ok: true }), threads: { langOf: () => null }, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), admin: { admission: a, users: async () => [...rows.values()] } });
    const minted = await door('assistant', 'assistant-invite', { role: 'observer' }, { caller: 'telegram:1', threadId: 'telegram:1' });
    const code = /([0-9a-f]{16}-[0-9a-f]{12}(?:-[a-z])?)/.exec(minted.message)?.[1];
    expect(code, minted.message).toMatch(/-o$/);
    const r = await doorAdmit({ channel: 'telegram', uid: '7', admission: code });
    expect(r.consumed).toBe(true);
    expect(rows.get('telegram:1').role).toBe('admin');
    expect(rows.get('telegram:7').role).toBe('observer');
    // a word the bot does not know: the usage, no code
    expect((await door('assistant', 'assistant-invite', { role: 'baas' }, { caller: 'telegram:1', threadId: 'telegram:1' })).ok).toBe(false);
  });
});
