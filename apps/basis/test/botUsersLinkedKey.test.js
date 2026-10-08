/**
 * The book's link: the Telegram person's row records their ROOT (`linkedRoot`) — what a turn from their app is checked
 * against, through a device statement — and the chat identity their offer named (`pubKey`, what names them in the
 * household's circle). A turn at the inbox door finds the row by the ROOT the door verified, never by the key it came
 * from. One root per row, one row per root; relinking the same root says so; unlinking (or revoking the row) makes the
 * root nobody's.
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
const ROOT = 'ROOT-ANN';
const KEY = 'PERSON-KEY-ANN';
const ANN = { root: ROOT, webid: KEY };

describe('the book\'s link', () => {
  it('the linked root finds the row at the inbox door — the chat key alone does not; one root per row, one row per root', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
    expect(await users.find('web', KEY, { linkedRoot: ROOT })).toBeNull();
    expect(await users.linkKey('telegram:42', ANN)).toEqual({ ok: true });
    expect((await users.find('web', KEY, { linkedRoot: ROOT }))?.id).toBe('telegram:42');
    expect(await users.find('web', KEY)).toBeNull();
    expect(await users.linkKey('telegram:42', ANN)).toEqual({ ok: true, already: true });
    expect(await users.linkKey('telegram:7', ANN)).toEqual({ ok: false, reason: 'key-on-another-row' });
    expect(await users.linkKey('telegram:7', { root: 'ROOT-BERT', webid: KEY })).toEqual({ ok: false, reason: 'key-on-another-row' });
    expect(await users.linkKey('telegram:42', { root: 'ANOTHER-ROOT', webid: 'ANOTHER-KEY' })).toEqual({ ok: false, reason: 'row-has-a-key' });
  });

  it('a chat key that is an inbox-door person\'s own row is refused (one row per key)', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'web', uid: KEY, displayName: 'Ann (app)' });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    expect(await users.linkKey('telegram:42', ANN)).toEqual({ ok: false, reason: 'key-on-another-row' });
  });

  it('unlink: the root is nobody\'s again; revoke: the same', async () => {
    const users = createBotUsers({ store: memStore() });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    await users.linkKey('telegram:42', ANN);
    expect(await users.unlinkKey('telegram:42')).toEqual({ ok: true, root: ROOT, key: KEY });
    expect(await users.find('web', KEY, { linkedRoot: ROOT })).toBeNull();
    await users.linkKey('telegram:42', ANN);
    await users.revoke('telegram:42');
    expect(await users.find('web', KEY, { linkedRoot: ROOT })).toBeNull();
  });
});

describe('the inbox door and a linked root', () => {
  it('a turn the door verified to the linked root is the Telegram row (its role, its thread) — never a second, web row', async () => {
    const { createDoorAdmit } = await import('../src/v2/botUsers.js');
    const store = memStore();
    const users = createBotUsers({ store });
    await users.admit({ channel: 'telegram', uid: '42' });   // no display name: the case that would re-admit
    await users.linkKey('telegram:42', ANN);
    const tiers = [];
    const admit = createDoorAdmit({ users, setDoorCaller: async (id, role) => { tiers.push([id, role]); }, admission: { redeem: async () => ({ ok: false, reason: 'no' }) } });
    const id = await admit({ channel: 'web', uid: KEY, displayName: 'Ann (app)', linkedRoot: ROOT });
    expect(id).toBe('telegram:42');
    expect((await store.list()).map((r) => r.id).sort()).toEqual(['telegram:42']);
    // the same key without a verified root: a stranger, a code is needed
    expect(await admit({ channel: 'web', uid: KEY })).toMatchObject({ refused: 'needs-code' });
    // after unlinking, the root is nobody's
    await users.unlinkKey('telegram:42');
    expect(await admit({ channel: 'web', uid: KEY, linkedRoot: ROOT })).toMatchObject({ refused: 'needs-code' });
  });
});

describe('the link in the real contact book', () => {
  it('kept by the book (the root and the chat key) and found at the inbox door by the root; cleared again by unlink', async () => {
    const { createRealHouseholdAgent } = await import('../src/core/agent/realAgent.js');
    const { contactBookStore } = await import('../src/v2/botUsers.js');
    const agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false });
    try {
      const users = createBotUsers({ store: contactBookStore((a, o, x) => agent.callSkill(a, o, x)) });
      await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
      expect(await users.linkKey('telegram:42', ANN)).toEqual({ ok: true });
      const row = (await users.list()).find((u) => u.id === 'telegram:42');
      expect(row).toMatchObject({ linkedRoot: ROOT, pubKey: KEY });
      expect((await users.find('web', KEY, { linkedRoot: ROOT }))?.id).toBe('telegram:42');
      expect(await users.unlinkKey('telegram:42')).toEqual({ ok: true, root: ROOT, key: KEY });
      expect(await users.find('web', KEY, { linkedRoot: ROOT })).toBeNull();
      const after = (await users.list()).find((u) => u.id === 'telegram:42');
      expect(after?.pubKey).toBeUndefined();
      expect(after?.linkedRoot).toBeUndefined();
    } finally { await agent.close?.()?.catch?.(() => {}); }
  }, 60_000);
});
