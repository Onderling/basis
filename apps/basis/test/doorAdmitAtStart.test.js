/**
 * After a restart, every admitted person is in the host's gate again before they write: the box's reminder tick and
 * the Sunday overview call ops AS a person, and a person the gate does not know is refused (or, with no role on
 * record, taken for a member). The book is the source; a revoked person is not put back.
 */
import { describe, it, expect } from 'vitest';
import { createBotUsers, createDoorAdmit } from '../src/v2/botUsers.js';

function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }

describe('the gate knows the book at start', () => {
  it('every admitted person gets their tier and role back; a revoked one does not', async () => {
    const store = memStore();
    const users = createBotUsers({ store, adminUid: '1' });
    await users.admit({ channel: 'telegram', uid: '1' });
    const bert = await users.admit({ channel: 'telegram', uid: '2' });
    const ann = await users.admit({ channel: 'telegram', uid: '3' });
    await users.revoke(ann.id);

    // a restart: a new door over the same book, nobody has written yet
    const set = [];
    const admit = createDoorAdmit({ users: createBotUsers({ store, adminUid: '1' }), setDoorCaller: async (id, role) => { set.push([id, role]); } });
    expect(admit.roleOf(bert.id)).toBeNull();
    expect(await admit.atStart()).toBe(2);
    expect(set).toEqual(expect.arrayContaining([['telegram:1', 'admin'], [bert.id, 'member']]));
    expect(set.map(([id]) => id)).not.toContain(ann.id);
    expect(admit.roleOf(bert.id)).toBe('member');
    // their first message does not set it twice
    await admit({ channel: 'telegram', uid: '2' });
    expect(set.filter(([id]) => id === bert.id)).toHaveLength(1);
  });
});
