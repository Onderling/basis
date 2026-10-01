/**
 * A household's data survives a wipe, a lost disk and a new version: exported as ONE file of public fields, and read
 * back through the ordinary ops on a bot with a NEW identity. What people see afterwards — each list's entries, the
 * chores and who holds them, the appointments and who comes, the people and their roles — is what they saw before.
 * The checked-in v1 file must keep importing: a change that breaks it turns this red (fix the import, or write v2
 * with a reader for v1).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel } from '../src/v2/botOpMap.js';
import { createBotUsers, contactBookStore } from '../src/v2/botUsers.js';
import { exportHousehold, importHousehold, countExport, checkExport } from '../src/v2/householdExport.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const PEOPLE = [
  { id: 'telegram:111', channel: 'telegram', uid: '111', role: 'member', displayName: 'Frits' },
  { id: 'telegram:222', channel: 'telegram', uid: '222', role: 'member', displayName: 'Bert' },
  { id: 'telegram:999', channel: 'telegram', uid: '999', role: 'admin', displayName: 'Anne' },
];
const [FRITS, BERT, ADMIN] = PEOPLE.map((p) => p.id);
const FIXTURE = new URL('./fixtures/household-export-v1.json', import.meta.url);

const dirs = [];
const agents = [];
afterAll(async () => {
  for (const a of agents) await a?.stop?.().catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** A household bot, composed as the box composes one, with a NEW identity each time. */
async function bot({ people = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bot-export-'));
  dirs.push(dir);
  const pass = randomBytes(32).toString('base64url');
  await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
  const agent = await createRealHouseholdAgent({
    ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
    chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
    householdPersistDb: { path: path.join(dir, 'household-items.json') },
    seedDemoData: false, seedHousehold: false,
    tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, t,
  });
  agents.push(agent);
  const own = (a, o, x, ctx) => agent.callSkill(a, o, x, ctx);
  await ensureHouseholdLists({ callSkill: (a, o, x) => agent.callSkill(a, o, x), t });
  // the admin is in the gate before anything (the door does this for whoever writes; an import restores the rest)
  await own('stoop', 'addContact', { webid: ADMIN, channel: 'telegram', role: 'admin', displayName: 'Anne' });
  await agent.setDoorCaller(ADMIN, 'admin');
  if (people) {
    for (const p of PEOPLE.filter((x) => x.id !== ADMIN)) {
      await own('stoop', 'addContact', { webid: p.id, channel: p.channel, role: p.role, displayName: p.displayName });
      await agent.setDoorCaller(p.id, p.role);
    }
  }
  return { agent, own, as: (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller }) };
}

/** What people read: the entries of each list, the open chores with holder and day, the appointments, the roles. */
async function reads({ agent, own }) {
  const entries = async (list) => (((await own('lists', 'listEntries', { list }))?.items) ?? []).map((i) => i.label).sort();
  const chores = (((await own('tasks', 'listOpen', {}))?.items) ?? [])
    .map((c) => `${c.text}|${[...new Set([...(c.assignees ?? []), c.assignee].filter(Boolean))].join(',')}|${String(c.dueAt ?? '').slice(0, 10)}`).sort();
  const events = (await agent.householdItems()).filter((i) => i.type === 'calendar-event')
    .map((e) => `${e.title}|${e.startsAt}|${e.state ?? ''}|${JSON.stringify(e.rsvp ?? {})}`).sort();
  return { boodschappen: await entries('Boodschappen'), reparaties: await entries('Reparaties'), chores, events };
}

describe('the household export', () => {
  it('export → a bot with a new identity → import: the same reads, and it says what it could not restore', async () => {
    const a = await bot();
    await a.as(FRITS)('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await a.as(BERT)('lists', 'addToList', { list: 'Boodschappen', text: 'kaas' });
    await a.as(BERT)('lists', 'markListItemDone', { item: 'kaas' });
    await a.as(ADMIN)('lists', 'addToList', { list: 'Reparaties', text: 'lamp keuken' });
    expect((await a.as(FRITS)('lists', 'addToList', { list: 'Klusjes', text: 'kleurenwiezen', assignee: 'mij', due: '2026-10-05' })).ok).toBe(true);
    expect((await a.as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis', assignee: 'bert', due: '2026-10-06' })).ok).toBe(true);
    const ev = await a.as(ADMIN)('calendar', 'addEvent', { title: 'tandarts', when: '2026-10-07T10:00', actor: ADMIN });
    expect(ev.ok, JSON.stringify(ev)).toBe(true);
    await a.as(BERT)('calendar', 'rsvpAccept', { id: ev.itemId, actor: BERT });
    const before = await reads(a);

    const file = exportHousehold({ items: await a.agent.householdItems(), people: PEOPLE, settings: { 'assistant.reminders': 'on' } });
    expect(checkExport(file)).toEqual({ ok: true });
    // public fields only: no store ids, no thread text
    expect(JSON.stringify(file)).not.toMatch(/"id":"[0-9A-Z]{26}"/);
    expect(countExport(file)).toMatchObject({ chores: 2, appointments: 1, people: 3 });

    const b = await bot({ people: false });
    const r = await importHousehold(JSON.parse(JSON.stringify(file)), { call: b.own, tier: (id, role) => b.agent.setDoorCaller(id, role) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.notRestored, JSON.stringify(r.notRestored)).toEqual([]);
    expect(await reads(b)).toEqual(before);
    // a ticked entry comes back ticked (a read hides it; the store keeps it), and the people with their roles
    const kaas = (await b.agent.householdItems()).find((i) => i.text === 'kaas');
    expect(kaas?.completedAt, JSON.stringify(kaas)).toBeTruthy();
    // the people as the box reads its book (`contactBookStore`)
    const book = await createBotUsers({ store: contactBookStore((x, y, z) => b.own(x, y, z)) }).list();
    for (const p of PEOPLE) expect(book.find((u) => u.id === p.id)?.role, JSON.stringify(book)).toBe(p.role);
  }, 120_000);

  it('the checked-in v1 file still imports, into the same reads', async () => {
    const file = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const b = await bot({ people: false });
    const r = await importHousehold(file, { call: b.own, tier: (id, role) => b.agent.setDoorCaller(id, role) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.notRestored).toEqual([]);
    const got = await reads(b);
    expect(got.boodschappen).toEqual(['melk']);
    expect(got.chores.map((c) => c.split('|').slice(0, 2).join('|')), JSON.stringify(got.chores)).toEqual(['kleurenwiezen|telegram:111', 'vuilnis|telegram:222']);
    // the due MOMENT comes back exactly, whatever zone the importing box runs in (a day would shift)
    const due = Object.fromEntries((await b.agent.householdItems()).filter((i) => i.type === 'task').map((i) => [i.text, i.dueAt]));
    expect(due).toEqual({ kleurenwiezen: '2026-10-04T22:00:00.000Z', vuilnis: '2026-10-05T22:00:00.000Z' });
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toContain('tandarts|2026-10-07');
    expect(got.events[0]).toContain('"telegram:222":"accepted"');
  }, 120_000);

  it('a file that is not an export, or of a version this one cannot read, is refused before anything is written', async () => {
    const calls = [];
    const call = async (...x) => { calls.push(x); return { ok: true }; };
    expect(await importHousehold({ format: 'something-else' }, { call })).toEqual({ ok: false, reason: 'not-an-export' });
    expect(await importHousehold({ format: 'onderling-household-export', v: 9 }, { call })).toEqual({ ok: false, reason: 'unknown-version' });
    expect(calls).toEqual([]);
  });
});

describe('the export shelf', () => {
  it('one file a day, the last few kept, and only its own names can be read', async () => {
    const { createExportShelf } = await import('../src/v2/householdExportShelf.js');
    const disk = new Map([['notes.txt', 'x']]);
    const files = { list: async () => [...disk.keys()], write: async (n, t) => { disk.set(n, t); }, read: async (n) => disk.get(n), remove: async (n) => { disk.delete(n); } };
    let at = new Date('2026-10-01T02:00:00').getTime();
    const shelf = createExportShelf({ files, exportNow: async () => ({ format: 'onderling-household-export', v: 1, at }), keep: 3, now: () => at });
    for (let d = 0; d < 5; d++) { await shelf.writeNow(); at += 86_400_000; }
    expect(await shelf.names()).toEqual(['household-export-2026-10-05-0200.json', 'household-export-2026-10-04-0200.json', 'household-export-2026-10-03-0200.json']);
    expect(disk.has('notes.txt')).toBe(true);
    expect((await shelf.read('household-export-2026-10-05-0200.json')).v).toBe(1);
    await expect(shelf.read('../vault.json')).rejects.toThrow('not-an-export-name');
  });
});

describe('the admin\'s /exports and /import', () => {
  it('the list, the question with what the file holds, the import — and a name that is not the shelf\'s is refused', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const { resolveDispatch } = await import('../src/router.js');
    const { mergeManifests } = await import('../src/manifestMerge.js');
    const { assistantManifest } = await import('../src/v2/assistantManifest.js');
    const file = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const imported = [];
    const exports = { names: async () => ['household-export-2026-10-01-0200.json'], read: async (n) => { if (n !== 'household-export-2026-10-01-0200.json') throw new Error('not-an-export-name'); return file; } };
    const tt = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    const call = withAssistantOps({ callSkill: async () => ({ ok: false }), threads: null, t: tt, admin: { exports, importFile: async (f) => { imported.push(f); return { ok: true, done: { lists: 0, entries: 1, chores: 2, appointments: 1, people: 3 }, notRestored: [] }; } } });
    expect((await call('assistant', 'assistant-exports', {})).message).toContain('household-export-2026-10-01-0200.json');
    const asked = await call('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json', preview: true });
    expect(asked.message).toContain('"chores":2');
    expect(imported).toEqual([]);
    expect((await call('assistant', 'assistant-import', { file: '../vault.json' })).ok).toBe(false);
    expect((await call('assistant', 'assistant-import', { file: 'household-export-2026-10-01-0200.json' })).message).toContain('circle.bot.import_done');
    expect(imported).toHaveLength(1);
    // it is asked first: the manifest's danger confirm, with the preview
    const r = resolveDispatch({ kind: 'slash', opId: 'assistant-import', args: { file: 'x' } }, mergeManifests([{ manifest: assistantManifest }]));
    expect(r.kind).toBe('needsConfirm');
  });
});

describe('the export shelf, with its defaults', () => {
  it('at most once a day by default (never a tight loop), and it keeps a week — found on the test bot, 2026-09-30', async () => {
    const { createExportShelf } = await import('../src/v2/householdExportShelf.js');
    const disk = new Map();
    const files = { list: async () => [...disk.keys()], write: async (n, t) => { disk.set(n, t); }, read: async (n) => disk.get(n), remove: async (n) => { disk.delete(n); } };
    const intervals = [];
    const timers = { setInterval: (_fn, ms) => { intervals.push(ms); return 1; }, clearInterval: () => {} };
    let at = new Date('2026-10-01T02:00:00').getTime();
    const shelf = createExportShelf({ files, exportNow: async () => ({ v: 1 }), now: () => at, timers });
    await shelf.start();
    expect(intervals).toEqual([24 * 3_600_000]);
    for (let d = 1; d < 10; d++) { at += 86_400_000; await shelf.writeNow(); }
    expect((await shelf.names()).length).toBe(7);
  });
});


describe('importing onto a bot that already has a household', () => {
  it('what is there stays: no doubles, and a person keeps the role the book gives them now', async () => {
    const file = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const b = await bot({ people: false });
    const tier = (id, role) => b.agent.setDoorCaller(id, role);
    expect((await importHousehold(file, { call: b.own, tier })).ok).toBe(true);
    // Bert was made an observer after the export; a second import of the same file
    await b.own('stoop', 'addContact', { webid: BERT, channel: 'telegram', role: 'observer', displayName: 'Bert' });
    const again = await importHousehold(file, { call: b.own, tier });
    expect(again.ok).toBe(true);
    const items = await b.agent.householdItems();
    expect(items.filter((i) => i.type === 'task' && i.text === 'kleurenwiezen')).toHaveLength(1);
    expect(items.filter((i) => i.type === 'calendar-event' && i.title === 'tandarts')).toHaveLength(1);
    expect(items.filter((i) => i.type === 'list-item' && i.text === 'melk')).toHaveLength(1);
    const book = await createBotUsers({ store: contactBookStore((x, y, z) => b.own(x, y, z)) }).list();
    expect(book.find((u) => u.id === BERT)?.role).toBe('observer');
  }, 120_000);
});

describe('a file is not trusted beyond the household', () => {
  it('it cannot make an admin, cannot reach settings outside the household\'s own, and says so', async () => {
    const calls = [];
    const call = async (app, op, args, ctx) => { calls.push({ app, op, args, caller: ctx?.caller ?? null }); return op === 'listLists' ? { ok: true, items: [] } : (op === 'listContacts' ? { ok: true, contacts: [] } : { ok: true, itemId: 'x' }); };
    const file = { format: 'onderling-household-export', v: 1, lists: [], loose: [],
      people: [{ id: 'telegram:666', channel: 'telegram', uid: '666', role: 'admin' }],
      settings: { 'assistant.reminders': 'off', 'relay.url': 'wss://evil.example' } };
    const r = await importHousehold(file, { call });
    expect(r.ok).toBe(true);
    const contact = calls.find((c) => c.op === 'addContact');
    expect(contact.args.role).toBe('member');
    expect(calls.filter((c) => c.op === 'set-param').map((c) => c.args.key)).toEqual(['assistant.reminders']);
    expect(r.notRestored).toEqual(expect.arrayContaining([
      expect.objectContaining({ what: 'role-capped', id: 'telegram:666' }),
      expect.objectContaining({ what: 'setting', key: 'relay.url' }),
    ]));
  });

  it('a step the gate refuses after the thing was made is reported, not counted as done', async () => {
    const call = async (app, op) => {
      if (op === 'listLists') return { ok: true, items: [{ label: 'Agenda' }] };
      if (op === 'listContacts') return { ok: true, contacts: [] };
      if (op === 'rsvpAccept') return { ok: false, error: 'refused' };
      return { ok: true, itemId: 'e1' };
    };
    const file = { format: 'onderling-household-export', v: 1, loose: [], settings: {},
      people: [{ id: 'telegram:2', channel: 'telegram', uid: '2', role: 'member' }],
      lists: [{ n: 1, name: 'Agenda', entries: [{ n: 2, type: 'calendar-event', title: 'x', startsAt: '2026-10-07T08:00:00.000Z', rsvp: { 'telegram:2': 'accepted' } }] }] };
    const r = await importHousehold(file, { call });
    expect(r.notRestored).toEqual([expect.objectContaining({ what: 'rsvp', who: 'telegram:2' })]);
  });
});

describe('the shelf never loses the last good copy', () => {
  it('no write at start; each write its own name; the newest file that holds something is always kept', async () => {
    const { createExportShelf } = await import('../src/v2/householdExportShelf.js');
    const disk = new Map();
    const files = { list: async () => [...disk.keys()], write: async (n, t) => { disk.set(n, t); }, read: async (n) => disk.get(n), remove: async (n) => { disk.delete(n); } };
    let at = new Date('2026-10-01T02:00:00').getTime();
    let full = true;
    const exportNow = async () => (full
      ? { format: 'onderling-household-export', v: 1, lists: [{ n: 1, name: 'B', entries: [{ n: 2, type: 'list-item', text: 'melk' }] }], people: [], loose: [] }
      : { format: 'onderling-household-export', v: 1, lists: [], people: [], loose: [] });
    const shelf = createExportShelf({ files, exportNow, keep: 3, now: () => at, timers: { setInterval: () => 1, clearInterval: () => {} } });
    await shelf.start();
    expect(disk.size, 'a boot does not write').toBe(0);
    await shelf.writeNow();
    at += 3_600_000; await shelf.writeNow();   // the same day: a second file, not a replacement
    expect(disk.size).toBe(2);
    full = false;   // a version that cannot read its store boots empty: the empty ones pile up
    for (let d = 1; d <= 5; d++) { at += 86_400_000; await shelf.writeNow(); }
    const names = await shelf.names();
    expect(names).toHaveLength(4);   // three newest + the newest one that holds something
    const kept = await Promise.all(names.map((n) => shelf.read(n)));
    expect(kept.some((f) => f.lists.length)).toBe(true);
  });
});

describe('a step by someone not in the book', () => {
  it('an rsvp is not written as the host (the host does not "come"); a tick or cancel is, and is reported', async () => {
    const calls = [];
    const call = async (app, op, args, ctx) => {
      calls.push({ op, caller: ctx?.caller ?? null });
      if (op === 'listLists') return { ok: true, items: [{ label: 'Agenda' }, { label: 'Boodschappen' }] };
      if (op === 'listContacts') return { ok: true, contacts: [] };
      return { ok: true, itemId: 'x1' };
    };
    const file = { format: 'onderling-household-export', v: 1, loose: [], settings: {}, people: [],
      lists: [
        { n: 1, name: 'Agenda', entries: [{ n: 2, type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-07T08:00:00.000Z', rsvp: { 'telegram:77': 'accepted' }, cancelled: true, createdBy: 'telegram:77' }] },
        { n: 3, name: 'Boodschappen', entries: [{ n: 4, type: 'list-item', text: 'melk', completedAt: '2026-10-01T08:00:00.000Z', completedBy: 'telegram:77' }] },
      ] };
    const r = await importHousehold(file, { call });
    expect(calls.filter((c) => c.op === 'rsvpAccept')).toEqual([]);
    expect(calls.find((c) => c.op === 'cancelEvent')?.caller).toBeNull();
    expect(calls.find((c) => c.op === 'markListItemDone')?.caller).toBeNull();
    expect(r.notRestored).toEqual(expect.arrayContaining([
      expect.objectContaining({ what: 'rsvp', who: 'telegram:77', why: 'not-in-the-book' }),
      expect.objectContaining({ what: 'by-the-host', step: 'cancel', who: 'telegram:77' }),
      expect.objectContaining({ what: 'by-the-host', step: 'tick', who: 'telegram:77' }),
    ]));
  });
});
