/**
 * The bot's people as ONE read of rows (Fable, the screen-fields brief): `assistant-users` answers `{id, label, role,
 * linked}`; the chat's `/users` text and the screen's people both paint those rows. The label follows the household's
 * names ceiling (`mayNamePeople`): the admin sees names, or ids under `names: none` (the ids are theirs — they admitted
 * them); a member is never shown a row they may not name — it is left out, not shown by id. `/role` is two params
 * (`who`, `role`), by position on the slash (`/role bob coordinator`) and as two fields on the screen — the same op, the
 * same args.
 */
import { describe, it, expect } from 'vitest';
import { peopleRows } from '../src/v2/botPeople.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { bindMatchArg } from '../src/router.js';
import { readHousehold } from '../src/v2/screenHousehold.js';

const ROWS = [
  { id: 'telegram:1', displayName: 'Frits', role: 'admin', channel: 'telegram' },
  { id: 'telegram:7', displayName: 'Bert', role: 'member', channel: 'telegram', pubKey: 'K7', linkedRoot: 'R7' },
  { id: 'telegram:9', displayName: 'Cas', role: 'observer', channel: 'telegram' },
];

describe('the people as rows, under the names ceiling', () => {
  it('the admin: names; under names none: the ids (their own choice)', () => {
    expect(peopleRows({ rows: ROWS, setting: 'members', callerId: 'telegram:1' }).map((r) => r.label)).toEqual(['Frits', 'Bert', 'Cas']);
    expect(peopleRows({ rows: ROWS, setting: 'none', callerId: 'telegram:1' }).map((r) => r.label)).toEqual(['telegram:1', 'telegram:7', 'telegram:9']);
    expect(peopleRows({ rows: ROWS, setting: 'members', callerId: 'telegram:1' })[1]).toEqual({ id: 'telegram:7', label: 'Bert', role: 'member', linked: true });
  });
  it('a member: a row they may not name is left out, never shown by id; their own row stays', () => {
    const rows = peopleRows({ rows: ROWS, setting: 'admin', callerId: 'telegram:7' });
    expect(rows.map((r) => r.id)).toEqual(['telegram:7']);
    expect(JSON.stringify(rows)).not.toContain('telegram:9');
    expect(peopleRows({ rows: ROWS, setting: 'members', callerId: 'telegram:7' })).toHaveLength(3);
  });
});

describe('/users and the screen read the same rows', () => {
  const door = (setting = 'members') => withAssistantOps({
    callSkill: async (a, o) => (a === 'params' && o === 'list-user-params' ? { params: [{ key: 'assistant.names', value: setting }] } : {}),
    t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), threads: { langOf: () => null },
    admin: { users: async () => ROWS, setRole: async (who, role) => ({ ...ROWS.find((r) => r.id === who || r.displayName === who), role }) },
  });
  const ADMIN = { caller: 'telegram:1', threadId: 'telegram:1', chatId: '1' };

  it('assistant-users: the rows, and the chat text painted from them', async () => {
    const r = await door()('assistant', 'assistant-users', {}, ADMIN);
    // each row also carries the word a person reads for its role (under the standard preset, the role itself)
    expect(r.items).toEqual([
      { id: 'telegram:1', label: 'Frits', role: 'admin', linked: false, roleWord: 'admin' },
      { id: 'telegram:7', label: 'Bert', role: 'member', linked: true, roleWord: 'member' },
      { id: 'telegram:9', label: 'Cas', role: 'observer', linked: false, roleWord: 'observer' },
    ]);
    expect(r.message).toContain('Bert — member');
    const hidden = await door('none')('assistant', 'assistant-users', {}, ADMIN);
    expect(hidden.message).toContain('telegram:7 — member');
    expect(hidden.message).not.toContain('Bert');
  });

  it('/role: who and role, by position on the slash and as two fields — the same op, the same args', async () => {
    const op = assistantManifest.operations.find((o) => o.id === 'assistant-role');
    expect(op.params.map((p) => p.name)).toEqual(['who', 'role']);
    expect(op.params[0].pickerSource).toEqual({ listOp: 'assistant-users', appOrigin: 'assistant' });
    const fromSlash = bindMatchArg({ _match: 'Bert coordinator' }, op);
    expect(fromSlash).toEqual({ who: 'Bert', role: 'coordinator' });
    expect(bindMatchArg({ _match: 'Frits de Roos observer' }, op)).toEqual({ who: 'Frits de Roos', role: 'observer' });
    // the role word as a person types it: any case binds to the declared value
    expect(bindMatchArg({ _match: 'Bert Coordinator' }, op)).toEqual({ who: 'Bert', role: 'coordinator' });
    const fromScreen = { who: 'Bert', role: 'coordinator' };
    const a = await door()('assistant', 'assistant-role', fromSlash, ADMIN);
    const b = await door()('assistant', 'assistant-role', fromScreen, ADMIN);
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
    // revoke's who and reassign's new holder pick from the same read
    expect(assistantManifest.operations.find((o) => o.id === 'assistant-revoke').params[0].pickerSource).toEqual({ listOp: 'assistant-users', appOrigin: 'assistant' });
  });
});

describe('the screen paints the people as rows, each with its own actions', () => {
  it('rows from the read; role and revoke on the row, with the person filled in', async () => {
    const h = await readHousehold({
      call: async (skill) => (skill === 'assistant.assistant-users' ? { ok: true, items: [{ id: 'telegram:7', label: 'Bert', role: 'member', linked: false }] } : { ok: true, items: [] }),
      ops: ['assistant.assistant-users', 'assistant.assistant-role', 'assistant.assistant-revoke'],
      t: (k) => k,
    });
    expect(h.people).toEqual([expect.objectContaining({ id: 'telegram:7', label: 'Bert', role: 'member' })]);
    const actions = h.people[0].actions.map((a) => [a.skill, a.args]);
    expect(actions).toEqual([['assistant.assistant-role', { who: 'telegram:7' }], ['assistant.assistant-revoke', { who: 'telegram:7' }]]);
  });
});
