/**
 * The bot's users: a person admitted on a door becomes a contact with a channel and a role, and the bot knows who
 * its admin is. Pure over an injected store (where the contacts live is a separate decision).
 *
 * Three levels on the bot: root = whoever opens the machine's vault (never reachable from a door); admin = the
 * admin-role contact (users, apps, invites); member = everyone else admitted.
 */
import { describe, it, expect } from 'vitest';
import { createBotUsers, CHANNELS, isChannel } from '../src/v2/botUsers.js';

function memoryStore() {
  const rows = new Map();
  return {
    get: async (id) => rows.get(id) ?? null,
    put: async (row) => { rows.set(row.id, row); return row; },
    list: async () => [...rows.values()],
  };
}

describe('the bot\'s users', () => {
  it('the channels are one closed set', () => {
    expect(CHANNELS).toEqual(['telegram', 'web', 'whatsapp']);
    expect(Object.isFrozen(CHANNELS)).toBe(true);
    expect(isChannel('telegram')).toBe(true);
    expect(isChannel('sms')).toBe(false);
  });

  it('the first person admitted is the admin; the next ones are members', async () => {
    const users = createBotUsers({ store: memoryStore() });
    const ann = await users.admit({ channel: 'telegram', uid: '111', displayName: 'Ann' });
    const bo = await users.admit({ channel: 'telegram', uid: '222', displayName: 'Bo' });
    expect(ann).toMatchObject({ id: 'telegram:111', channel: 'telegram', role: 'admin', displayName: 'Ann' });
    expect(bo.role).toBe('member');
    expect(await users.isAdmin('telegram:111')).toBe(true);
    expect(await users.isAdmin('telegram:222')).toBe(false);
  });

  it('the one named as admin is admin, whoever came first', async () => {
    const users = createBotUsers({ store: memoryStore(), adminUid: '222' });
    const ann = await users.admit({ channel: 'telegram', uid: '111' });
    const bo = await users.admit({ channel: 'telegram', uid: '222' });
    expect(ann.role).toBe('member');
    expect(bo.role).toBe('admin');
  });

  it('admitting again is the same contact (a name update is kept, the role is not reset)', async () => {
    const users = createBotUsers({ store: memoryStore() });
    await users.admit({ channel: 'telegram', uid: '111', displayName: 'Ann' });
    await users.admit({ channel: 'telegram', uid: '222', displayName: 'Bo' });
    const again = await users.admit({ channel: 'telegram', uid: '111', displayName: 'Anna' });
    expect(again).toMatchObject({ id: 'telegram:111', role: 'admin', displayName: 'Anna' });
    expect((await users.list()).map((u) => u.id)).toEqual(['telegram:111', 'telegram:222']);
  });

  it('refuses an unknown channel and an empty uid', async () => {
    const users = createBotUsers({ store: memoryStore() });
    await expect(users.admit({ channel: 'sms', uid: '1' })).rejects.toThrow(/channel/);
    await expect(users.admit({ channel: 'telegram', uid: '' })).rejects.toThrow(/uid/);
  });

  it('an unknown contact has no role and is not admin', async () => {
    const users = createBotUsers({ store: memoryStore() });
    expect(await users.roleOf('telegram:999')).toBeNull();
    expect(await users.isAdmin('telegram:999')).toBe(false);
  });
});
