/**
 * THE LINK FLOW SAYS WHAT IS TRUE, HOWEVER OFTEN A STEP IS REPEATED (the household's log, 2026-10-09): an offer the bot
 * refused (this row already had another identity) was pasted again after `/ontkoppel`, and twice heard "that is not a
 * link line" — the refusal had used up its nonce, and a replay was then worded as not an offer. A refused (or
 * already-linked) paste leaves the offer usable; only the paste that asks the code question uses it; a used offer says so.
 */
import { describe, it, expect } from 'vitest';
import { createBotUsers } from '../../src/v2/botUsers.js';
import { createIdentityLink, createLinkTombstones } from '../../src/v2/botIdentityLink.js';
import { linkedPerson } from '../support/linkedPerson.js';

function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, row); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }
const BOT = 'BOT-ADDRESS';
const question = () => ({ text: 'q', buttons: [] });

async function boot() {
  const users = createBotUsers({ store: memStore(), adminUid: '1' });
  await users.admit?.({ channel: 'telegram', uid: '1' });
  const link = createIdentityLink({
    users, botAddress: () => BOT, tombstones: createLinkTombstones({ vault: memVault() }),
    ask: async () => ({ ok: true }), sendPrivately: async () => ({ ok: true }), tellApp: async () => {},
    listGrants: async () => [], revokeView: async () => true, where: () => ({}),
  });
  return { users, link };
}

describe('the identity link, step by step and again', () => {
  it('an offer refused because the row has another identity is usable after /ontkoppel', async () => {
    const { users, link } = await boot();
    const first = await linkedPerson();
    const second = await linkedPerson();
    expect(await users.linkKey('telegram:1', { root: first.root, webid: first.webid })).toEqual({ ok: true });
    const { offer } = second.offer('phone', BOT);
    expect(await link.pasted('telegram:1', offer, question)).toMatchObject({ ok: false, reason: 'row-has-a-key' });
    expect(await link.unlink('telegram:1', { isPrivate: true })).toMatchObject({ ok: true });
    expect(await link.pasted('telegram:1', offer, question)).toMatchObject({ ok: true, pending: true });
  });
  it('the same offer pasted after the question was asked says it was USED, not that it is no link line', async () => {
    const { link } = await boot();
    const ann = await linkedPerson();
    const { offer } = ann.offer('phone', BOT);
    expect(await link.pasted('telegram:1', offer, question)).toMatchObject({ ok: true, pending: true });
    expect(await link.pasted('telegram:1', offer, question)).toMatchObject({ ok: false, reason: 'used' });
  });
});
