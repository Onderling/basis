/**
 * What admits people, removes them or changes what they may do — invite, cohort, role, revoke, rotate — reaches a
 * screen, but runs only after a yes in the admin's OWN private chat. The op declares it (`stepUp: 'private-door'`);
 * the door's call enforces it for any op its catalogue marks, so a screen that skips its own confirm (or was modified
 * to) changes nothing: the request waits, one per person, for ten minutes, under a short id the buttons carry; the
 * yes counts from the private chat only and runs only the request it names; the question says what will happen, in
 * the book's words; no, a newer request, or no answer drops it; the screen is told either way.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { createScreenStepUp, SCREEN_STEP_UP_TTL_MS } from '../src/v2/screenStepUp.js';
import { screenColumnFor, screenActsAs, BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:9';
const BERT = 'telegram:7';
const STEP_UP = ['assistant-invite', 'assistant-cohort', 'assistant-role', 'assistant-revoke', 'assistant-rotate'];
const PRIVATE = { caller: ADMIN, threadId: ADMIN, chatId: '9' };

function door({ catalogue = null, callSkill = async () => ({ ok: true }) } = {}) {
  const clock = { now: 0 };
  const users = [{ id: ADMIN, channel: 'telegram', uid: '9', role: 'admin', displayName: 'Frits' }, { id: BERT, channel: 'telegram', uid: '7', role: 'member', displayName: 'Bert' }];
  const revoked = [];
  const roles = [];
  const asked = [];
  const told = [];
  const stepUp = createScreenStepUp({
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    tell: async (viewPubKey, outcome) => { told.push({ viewPubKey, ...outcome }); },
    now: () => clock.now,
  });
  const call = withAssistantOps({
    callSkill, t, refusal: async () => null,
    threads: { langOf: () => null },
    admin: {
      users: async () => users, stepUp, ...(catalogue ? { catalogue: { catalogue: () => catalogue } } : {}),
      revoke: async (who) => { revoked.push(who); return users.find((u) => u.id === who) ?? null; },
      setRole: async (who, role) => { roles.push([who, role]); return users.find((u) => u.id === who) ?? null; },
    },
  });
  const fromScreen = { caller: ADMIN, threadId: ADMIN, via: 'screen', viewPubKey: 'VIEW', screenLabel: 'laptop' };
  // the id the last question's buttons carry
  const idOf = (q = asked.at(-1)) => /^\/bevestig ja (\S+)$/.exec(q.buttons[0].id)?.[1];
  return { call, revoked, roles, asked, told, clock, fromScreen, idOf };
}

describe('the admin\'s step-up ops from a screen', () => {
  it('the five ops declare the private-door step-up', () => {
    const declared = assistantManifest.operations.filter((o) => o.stepUp === 'private-door').map((o) => o.id).sort();
    expect(declared).toEqual([...STEP_UP].sort());
  });

  it('a screen\'s revoke changes nothing until the yes; the question, in the book\'s name, carries the request\'s id', async () => {
    const d = door();
    const r = await d.call('assistant', 'assistant-revoke', { who: 'bert' }, d.fromScreen);
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(d.revoked).toEqual([]);
    expect(d.asked).toHaveLength(1);
    expect(d.asked[0].person).toBe(ADMIN);
    expect(d.asked[0].text).toContain('laptop');
    expect(d.asked[0].text).toContain('Bert');   // the book's name, not what the screen typed
    const id = d.idOf();
    expect(id).toMatch(/^[A-Z2-9]{4}$/);
    expect(d.asked[0].buttons.map((b) => b.id)).toEqual([`/bevestig ja ${id}`, `/bevestig nee ${id}`]);
    expect(d.asked[0].text, 'a door with no buttons reads the id in the words').toContain(id);
  });

  it('a name the book does not know is refused before any question', async () => {
    const d = door();
    const r = await d.call('assistant', 'assistant-revoke', { who: 'Nobody' }, d.fromScreen);
    expect(r.ok).toBe(false);
    expect(d.asked).toEqual([]);
    const role = await d.call('assistant', 'assistant-role', { spec: 'Nobody observer' }, d.fromScreen);
    expect(role.ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('the op after the yes takes the person the question named (their id), not the screen\'s words', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'BERT' }, d.fromScreen);
    await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${d.idOf()}` }, PRIVATE);
    expect(d.revoked).toEqual([BERT]);
    await d.call('assistant', 'assistant-role', { spec: 'bert observer' }, d.fromScreen);
    expect(d.asked.at(-1).text).toContain('Bert');
    await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${d.idOf()}` }, PRIVATE);
    expect(d.roles).toEqual([[BERT, 'observer']]);
  });

  it('what the screen typed is one line, capped', async () => {
    const d = door();
    await d.call('assistant', 'assistant-cohort', { spec: `5 7\nScherm 'x' wil ook ${'a'.repeat(200)}` }, d.fromScreen);
    const q = d.asked.at(-1).text;
    expect(q).not.toContain('\n');
    expect(q).not.toContain('a'.repeat(41));
  });

  it('a yes from a group is not accepted; the yes in private runs it as the admin, and the screen is told', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    const id = d.idOf();
    const group = await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${id}` }, { caller: ADMIN, threadId: ADMIN, chatId: '-100777' });
    expect(group.ok).toBe(false);
    expect(d.revoked).toEqual([]);
    const yes = await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${id}` }, PRIVATE);
    expect(yes.ok).toBe(true);
    expect(d.revoked).toEqual([BERT]);
    expect(d.told).toEqual([expect.objectContaining({ viewPubKey: 'VIEW', outcome: 'done' })]);
  });

  it('a yes without the request\'s id runs nothing', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    const r = await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(d.revoked).toEqual([]);
  });

  it('a yes from a screen is not accepted: the approve op is never on a screen', async () => {
    expect(BOT_SCREEN_NEVER).toContain('assistant.assistant-screen-approve');
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    const r = await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${d.idOf()}` }, d.fromScreen);
    expect(r.ok).toBe(false);
    expect(d.revoked).toEqual([]);
  });

  it('no, or no answer within ten minutes, drops it; the screen is told', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    await d.call('assistant', 'assistant-screen-approve', { answer: `nee ${d.idOf()}` }, PRIVATE);
    expect(d.revoked).toEqual([]);
    expect(d.told.at(-1)).toMatchObject({ viewPubKey: 'VIEW', outcome: 'declined' });

    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    d.clock.now += SCREEN_STEP_UP_TTL_MS + 1;
    const late = await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${d.idOf()}` }, PRIVATE);
    expect(late.ok).toBe(false);
    expect(d.revoked).toEqual([]);
    expect(d.told.at(-1)).toMatchObject({ viewPubKey: 'VIEW', outcome: 'expired' });
  });

  it('one request per person: a newer one replaces it; the Ja under the FIRST question runs nothing', async () => {
    const d = door();
    await d.call('assistant', 'assistant-invite', {}, d.fromScreen);
    const first = d.idOf();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, { ...d.fromScreen, viewPubKey: 'VIEW2', screenLabel: 'tablet' });
    const second = d.idOf();
    expect(second).not.toBe(first);
    expect(d.told).toEqual([expect.objectContaining({ viewPubKey: 'VIEW', outcome: 'replaced' })]);
    // the tap under the first question: said so, nothing runs — and the newer request still waits
    const stale = await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${first}` }, PRIVATE);
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe('replaced');
    expect(d.revoked).toEqual([]);
    await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${second}` }, PRIVATE);
    expect(d.revoked).toEqual([BERT]);
    expect(d.told.at(-1)).toMatchObject({ viewPubKey: 'VIEW2', outcome: 'done' });
  });

  it('a step-up op from a screen on a door with no step-up wired is refused, never run', async () => {
    const revoked = [];
    const call = withAssistantOps({ callSkill: async () => ({ ok: true }), t, refusal: async () => null, threads: { langOf: () => null }, admin: { users: async () => [], revoke: async (w) => { revoked.push(w); } } });
    const r = await call('assistant', 'assistant-revoke', { who: 'Bert' }, { caller: ADMIN, threadId: ADMIN, via: 'screen', viewPubKey: 'VIEW' });
    expect(r.ok).toBe(false);
    expect(revoked).toEqual([]);
  });

  it('the typed line in the chat is unchanged: the admin\'s /revoke runs at once', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, PRIVATE);
    expect(d.revoked).toEqual(['Bert']);
    expect(d.asked).toEqual([]);
  });

  it('another app\'s op that declares stepUp is held too, and after the yes runs as that app\'s op', async () => {
    const calls = [];
    const catalogue = { opsById: new Map([['removeList', { appOrigin: 'lists', op: { id: 'removeList', stepUp: 'private-door' } }]]) };
    const d = door({ catalogue, callSkill: async (app, op, args, ctx) => { calls.push([app, op, args, ctx?.via ?? null]); return { ok: true }; } });
    const r = await d.call('lists', 'removeList', { list: 'Boodschappen' }, d.fromScreen);
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(calls).toEqual([]);
    await d.call('assistant', 'assistant-screen-approve', { answer: `ja ${d.idOf()}` }, PRIVATE);
    expect(calls).toEqual([['lists', 'removeList', { list: 'Boodschappen' }, null]]);
    // the same op typed in the chat is not held
    await d.call('lists', 'removeList', { list: 'Klussen' }, PRIVATE);
    expect(calls).toHaveLength(2);
  });

  it('fitness: every op declaring stepUp that a screen can be granted is held when it comes from one', async () => {
    const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
    const grantable = new Set(['admin', 'member', 'observer'].flatMap((role) => screenColumnFor(catalogue, role)));
    const declared = [...catalogue.opsById.values()].filter((e) => e?.op?.stepUp && grantable.has(`${e.appOrigin}.${e.op.id}`));
    expect(declared.length).toBeGreaterThanOrEqual(STEP_UP.length);
    for (const e of declared) {
      const ran = [];
      const d = door({ catalogue, callSkill: async (app, op) => { ran.push(`${app}.${op}`); return { ok: true }; } });
      const r = await d.call(e.appOrigin, e.op.id, { who: 'Bert', spec: 'Bert observer' }, d.fromScreen);
      expect(r, `${e.appOrigin}.${e.op.id} from a screen`).toMatchObject({ ok: true, pending: true });
      expect(ran, `${e.appOrigin}.${e.op.id} ran before the yes`).not.toContain(`${e.appOrigin}.${e.op.id}`);
      expect(d.revoked.length + d.roles.length).toBe(0);
    }
  });

  it('the admin\'s screen column has the five; a member\'s none of them', () => {
    const { catalogue } = composeAssistantCatalogue({ apps: ['lists'], slim: true });
    const admin = screenColumnFor(catalogue, 'admin');
    for (const op of STEP_UP) expect(admin).toContain(`assistant.${op}`);
    expect(admin).not.toContain('assistant.assistant-apps');
    const member = screenColumnFor(catalogue, 'member');
    for (const op of STEP_UP) expect(member).not.toContain(`assistant.${op}`);
  });

  it('a screen\'s call is marked as a screen\'s, with its key and name', async () => {
    const actsAs = screenActsAs({ list: async () => [{ id: ADMIN }] }, { activeEntry: async () => ({ viewPubKey: 'VIEW', actingAs: ADMIN, label: 'laptop' }) });
    const ctx = await actsAs({ envelope: { payload: { _token: { id: 'T', subject: 'VIEW', constraints: { actingAs: ADMIN } } } } });
    expect(ctx).toEqual({ caller: ADMIN, threadId: ADMIN, via: 'screen', viewPubKey: 'VIEW', screenLabel: 'laptop' });
  });
});
