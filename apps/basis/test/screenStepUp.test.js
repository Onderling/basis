/**
 * What admits people, removes them or changes what they may do — invite, cohort, role, revoke, rotate — reaches a
 * screen, but runs only after a yes in the admin's OWN private chat. The op declares it (`stepUp: 'private-door'`);
 * the door's call enforces it, so a screen that skips its own confirm (or was modified to) changes nothing: the
 * request waits, one per person, for ten minutes; the yes counts from the private chat only, a group's does not; no
 * or no answer drops it; the screen is told either way.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { createScreenStepUp, SCREEN_STEP_UP_TTL_MS } from '../src/v2/screenStepUp.js';
import { screenColumnFor, screenActsAs, BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:9';
const STEP_UP = ['assistant-invite', 'assistant-cohort', 'assistant-role', 'assistant-revoke', 'assistant-rotate'];

function door({ clock = { now: 0 } } = {}) {
  const users = [{ id: ADMIN, channel: 'telegram', uid: '9', role: 'admin', displayName: 'Frits' }, { id: 'telegram:7', channel: 'telegram', uid: '7', role: 'member', displayName: 'Bert' }];
  const revoked = [];
  const asked = [];
  const told = [];
  const stepUp = createScreenStepUp({
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    tell: async (viewPubKey, outcome) => { told.push({ viewPubKey, ...outcome }); },
    now: () => clock.now,
  });
  const call = withAssistantOps({
    callSkill: async () => ({ ok: true }), t, refusal: async () => null,
    threads: { langOf: () => null },
    admin: { users: async () => users, revoke: async (who) => { revoked.push(who); return { id: who }; }, stepUp },
  });
  const fromScreen = { caller: ADMIN, threadId: ADMIN, via: 'screen', viewPubKey: 'VIEW', screenLabel: 'laptop' };
  return { call, revoked, asked, told, clock, fromScreen };
}

describe('the admin\'s step-up ops from a screen', () => {
  it('the five ops declare the private-door step-up', () => {
    const declared = assistantManifest.operations.filter((o) => o.stepUp === 'private-door').map((o) => o.id).sort();
    expect(declared).toEqual([...STEP_UP].sort());
  });

  it('a screen\'s revoke changes nothing until the yes; the question is in the admin\'s private chat', async () => {
    const d = door();
    const r = await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(d.revoked).toEqual([]);
    expect(d.asked).toHaveLength(1);
    expect(d.asked[0].person).toBe(ADMIN);
    expect(d.asked[0].text).toContain('laptop');
    expect(d.asked[0].text).toContain('Bert');
    expect(d.asked[0].buttons.map((b) => b.id)).toEqual(['/bevestig ja', '/bevestig nee']);
  });

  it('a yes from a group is not accepted; the yes in private runs it as the admin, and the screen is told', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    const group = await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, { caller: ADMIN, threadId: ADMIN, chatId: '-100777' });
    expect(group.ok).toBe(false);
    expect(d.revoked).toEqual([]);
    const yes = await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(yes.ok).toBe(true);
    expect(d.revoked).toEqual(['Bert']);
    expect(d.told).toEqual([expect.objectContaining({ viewPubKey: 'VIEW', outcome: 'done' })]);
  });

  it('a yes from a screen is not accepted: the approve op is never on a screen', async () => {
    expect(BOT_SCREEN_NEVER).toContain('assistant.assistant-screen-approve');
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    const r = await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, d.fromScreen);
    expect(r.ok).toBe(false);
    expect(d.revoked).toEqual([]);
  });

  it('no, or no answer within ten minutes, drops it; the screen is told', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    await d.call('assistant', 'assistant-screen-approve', { answer: 'nee' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(d.revoked).toEqual([]);
    expect(d.told.at(-1)).toMatchObject({ viewPubKey: 'VIEW', outcome: 'declined' });

    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    d.clock.now += SCREEN_STEP_UP_TTL_MS + 1;
    const late = await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(late.ok).toBe(false);
    expect(d.revoked).toEqual([]);
    expect(d.told.at(-1)).toMatchObject({ viewPubKey: 'VIEW', outcome: 'expired' });
  });

  it('one request per person: a second replaces the first, whose screen is told', async () => {
    const d = door();
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, d.fromScreen);
    await d.call('assistant', 'assistant-revoke', { who: 'Ann' }, { ...d.fromScreen, viewPubKey: 'VIEW2', screenLabel: 'tablet' });
    expect(d.told).toEqual([expect.objectContaining({ viewPubKey: 'VIEW', outcome: 'replaced' })]);
    await d.call('assistant', 'assistant-screen-approve', { answer: 'ja' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(d.revoked).toEqual(['Ann']);
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
    await d.call('assistant', 'assistant-revoke', { who: 'Bert' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(d.revoked).toEqual(['Bert']);
    expect(d.asked).toEqual([]);
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
