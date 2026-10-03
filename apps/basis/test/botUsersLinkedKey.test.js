/**
 * The book's linked key: the Telegram person's row gains their Basis key (`pubKey`, the contact type's own field — the
 * keyless row "gains its key"), and a turn from that key at the inbox door IS that row. One key per row, one row per
 * key; linking the same key to the same row again says so; unlinking (or revoking the row) makes the key a stranger.
 */
import { describe, it, expect } from 'vitest';
import { createBotUsers } from '../src/v2/botUsers.js';

function memStore() {
  const m = new Map();
  return {
    get: async (id) => m.get(id) ?? null,
    put: async (row) => { m.set(row.id, { ...row }); return row; },
    list: async () => [...m.values()],
    hide: async (id) => { const r = m.get(id); if (r) m.set(id, { ...r, hidden: true }); },
  };
}
const KEY = 'PERSON-KEY-ANN';

describe('the book\'s linked key', () => {
  it('a linked key finds the row at the inbox door; one key per row, one row per key; relinking says so', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
    expect(await users.find('web', KEY)).toBeNull();
    expect(await users.linkKey('telegram:42', KEY)).toEqual({ ok: true });
    expect((await users.find('web', KEY))?.id).toBe('telegram:42');
    expect(await users.linkKey('telegram:42', KEY)).toEqual({ ok: true, already: true });
    expect(await users.linkKey('telegram:7', KEY)).toEqual({ ok: false, reason: 'key-on-another-row' });
    expect(await users.linkKey('telegram:42', 'ANOTHER-KEY')).toEqual({ ok: false, reason: 'row-has-a-key' });
  });

  it('a key that is an inbox-door person\'s own row is refused (one row per key)', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'web', uid: KEY, displayName: 'Ann (app)' });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    expect(await users.linkKey('telegram:42', KEY)).toEqual({ ok: false, reason: 'key-on-another-row' });
  });

  it('unlink: the key is a stranger again; revoke: the same', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    await users.linkKey('telegram:42', KEY);
    expect(await users.unlinkKey('telegram:42')).toEqual({ ok: true, key: KEY });
    expect(await users.find('web', KEY)).toBeNull();
    await users.linkKey('telegram:42', KEY);
    await users.revoke('telegram:42');
    expect(await users.find('web', KEY)).toBeNull();
  });
});

describe('the inbox door and a linked key', () => {
  it('a turn from the linked key is the Telegram row (its role, its thread) — never a second, web row', async () => {
    const { createDoorAdmit } = await import('../src/v2/botUsers.js');
    const store = memStore();
    const users = createBotUsers({ store });
    await users.admit({ channel: 'telegram', uid: '42' });   // no display name: the case that would re-admit
    await users.linkKey('telegram:42', KEY);
    const tiers = [];
    const admit = createDoorAdmit({ users, setDoorCaller: async (id, role) => { tiers.push([id, role]); }, admission: { redeem: async () => ({ ok: false, reason: 'no' }) } });
    const id = await admit({ channel: 'web', uid: KEY, displayName: 'Ann (app)' });
    expect(id).toBe('telegram:42');
    expect((await store.list()).map((r) => r.id).sort()).toEqual(['telegram:42']);
    // after unlinking, the key is a stranger: a code is needed
    await users.unlinkKey('telegram:42');
    expect(await admit({ channel: 'web', uid: KEY })).toMatchObject({ refused: 'needs-code' });
  });
});

describe('the linked key in the real contact book', () => {
  it('kept by the book and found at the inbox door; cleared again by unlink', async () => {
    const { createRealHouseholdAgent } = await import('../src/core/agent/realAgent.js');
    const { contactBookStore } = await import('../src/v2/botUsers.js');
    const agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false });
    try {
      const users = createBotUsers({ store: contactBookStore((a, o, x) => agent.callSkill(a, o, x)) });
      await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
      expect(await users.linkKey('telegram:42', KEY)).toEqual({ ok: true });
      expect((await users.find('web', KEY))?.id).toBe('telegram:42');
      expect(await users.unlinkKey('telegram:42')).toEqual({ ok: true, key: KEY });
      expect(await users.find('web', KEY)).toBeNull();
      expect((await users.list()).find((u) => u.id === 'telegram:42')?.pubKey).toBeUndefined();
    } finally { await agent.close?.()?.catch?.(() => {}); }
  }, 60_000);
});
