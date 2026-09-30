/**
 * What a walk of the household bot found, turned into its checks: a person names a chore or an appointment by its
 * WORDS ("ik doe het vuilnis", "ik kom naar de tandarts"), not by an id they never saw; "what do I still have to do"
 * lists chores, not the shopping or the Agenda; a tick of an entry that is not there says so; a cancelled appointment
 * is kept as cancelled (the Agenda's edge stays whole) and no longer listed; the confirmation of an appointment says
 * when, in the household's own clock.
 * One boot, composed as the box composes a household bot.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);

describe('the household bot, as a walk found it', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('chores and appointments by their words; mine is chores; a missing tick says so; cancel keeps the record', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-walk-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, t,
    });
    const call = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: call, t });
    await call('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis buiten zetten' });
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    const tomorrow = new Date(Date.now() + 86_400_000);
    const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const added = await call('calendar', 'addEvent', { title: 'tandarts', when: `${day}T10:00` });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    // the confirmation says when — in the household's clock (a local time is read and shown as local) — once, not
    // the title twice
    expect(added.message).toContain(`"when":"${day} 10:00"`);

    // the general task listing: the chores, not the shopping or the Agenda
    const open = await call('tasks', 'listOpen', {});
    const labels = (open.items ?? []).map((i) => i.text ?? i.label);
    expect(labels).toContain('vuilnis buiten zetten');
    expect(labels).not.toContain('tandarts');
    expect(labels).not.toContain('melk');
    // "wat moet ik nog doen" on the bot: MINE — the chores this person claimed and has not done (nothing yet)
    const mineBefore = await call('tasks', 'listMine', { actor: 'telegram:111' });
    expect((mineBefore.items ?? []).map((i) => i.text ?? i.label)).toEqual([]);
    // an add whose words are already open on that list is not a second entry
    const dup = await call('lists', 'addToList', { list: 'Klusjes', text: 'Vuilnis buiten zetten' });
    expect(String(dup.message ?? dup.error)).toContain('circle.lists.already_there');
    expect(((await call('lists', 'listEntries', { list: 'Klusjes' })).items ?? []).filter((i) => /vuilnis/i.test(i.label)).length).toBe(1);

    // a chore by its words
    const claimed = await call('tasks', 'claimTask', { id: 'vuilnis', actor: 'telegram:111' });
    expect(claimed?.result?.error, JSON.stringify(claimed)).toBeUndefined();
    const mineAfter = await call('tasks', 'listMine', { actor: 'telegram:111' });
    expect((mineAfter.items ?? []).map((i) => i.text ?? i.label)).toEqual(['vuilnis buiten zetten']);
    expect(((await call('tasks', 'listMine', { actor: 'telegram:222' })).items ?? [])).toEqual([]);
    // …confirmed in the household's words (the box hands the agent its translator), not a line of English
    expect(claimed?.message).toContain('circle.tasks.reply.claimed');
    // …naming the chore that was FOUND, not the words it was asked by (the walk: "✓ Opgepakt: " with nothing after it)
    expect(claimed?.message).toContain('"title":"vuilnis buiten zetten"');
    // a claim that loses is never a "✓": someone else has it, or you had it already (the walk: "✓ Opgepakt: " with
    // nothing after it was a lost claim reported as a win)
    const theirs = await call('tasks', 'claimTask', { id: 'vuilnis', actor: 'telegram:222' });
    expect(theirs.ok).toBe(false);
    expect(String(theirs.error)).toContain('circle.tasks.already_claimed');
    expect(String(theirs.error)).toContain('vuilnis buiten zetten');
    const again = await call('tasks', 'claimTask', { id: 'vuilnis', actor: 'telegram:111' });
    expect(again.ok).toBe(false);
    expect(String(again.error)).toContain('circle.tasks.already_yours');
    const done = await call('tasks', 'completeTask', { id: 'vuilnis', actor: 'telegram:111' });
    expect(done?.task?.id, JSON.stringify(done)).toBeTruthy();
    expect(done?.message).toContain('"title":"vuilnis buiten zetten"');
    // words that name no chore: said in the household's words, never the store's own error
    const none = await call('tasks', 'claimTask', { id: 'stofzuigen', actor: 'telegram:111' });
    expect(String(none?.error ?? '')).toContain('circle.tasks.no_such_task');

    // two chores that both contain the words: the bot asks which, naming both — never "no such chore", never a guess
    await call('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen boven' });
    await call('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen beneden' });
    const which = await call('tasks', 'claimTask', { id: 'ramen', actor: 'telegram:111' });
    expect(String(which?.error ?? '')).toContain('circle.lists.which_one');
    expect(String(which?.error ?? '')).toContain('ramen lappen boven');
    expect(String(which?.error ?? '')).toContain('ramen lappen beneden');

    // a tick names what was ticked ("Afgevinkt: melk.")
    const ticked = await call('lists', 'markListItemDone', { item: 'melk' });
    expect(ticked.message).toContain('circle.lists.done_named');
    expect(ticked.message).toContain('"text":"melk"');

    // a tick of an entry that is not there says so
    const miss = await call('lists', 'markListItemDone', { item: '1' });
    expect(miss.ok).toBe(false);

    // an appointment by its words: rsvp, then a soft cancel — the child stays (cancelled), the listing drops it
    const rsvp = await call('calendar', 'rsvpAccept', { id: 'tandarts', actor: 'telegram:111' });
    expect(rsvp.ok, JSON.stringify(rsvp)).toBe(true);
    // the reply names what it answered, and when (the walk: "Je komt: huisarts, vr 2 okt 09:00")
    expect(rsvp.message).toContain('"title":"tandarts"');
    expect(rsvp.message).toContain(`"when":"${day} 10:00"`);
    const cancelled = await call('calendar', 'cancelEvent', { id: 'tandarts' });
    expect(cancelled.ok, JSON.stringify(cancelled)).toBe(true);
    const snap = await call('calendar', 'getEventSnapshot', { id: added.itemId });
    expect(snap?.event?.state).toBe('cancelled');
    expect(((await call('calendar', 'listEvents', { days: 7 })).items ?? []).length).toBe(0);
  }, 180_000);
});
