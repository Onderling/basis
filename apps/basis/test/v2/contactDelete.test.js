/** The words above a returning turn (L114): "verwijderd" after a deletion, "verborgen" for a merely hidden contact. */
import { describe, it, expect } from 'vitest';
import { returnedMarkerKey, deleteContact } from '../../src/v2/contactDelete.js';

describe('returnedMarkerKey', () => {
  it('a turn that is not a return has no marker', () => {
    expect(returnedMarkerKey({ text: 'hoi' }, 5)).toBeNull();
  });
  it('a return after a deletion says "verwijderd"', () => {
    expect(returnedMarkerKey({ returned: true, ts: 10 }, 5)).toBe('circle.contacts.returned_deleted_marker');
  });
  it('a return from before a later deletion keeps its own words', () => {
    expect(returnedMarkerKey({ returned: true, ts: 3 }, 5)).toBe('circle.contacts.returned_marker');
  });
  it('a hidden, never-deleted contact says "verborgen"', () => {
    expect(returnedMarkerKey({ returned: true, ts: 3 }, null)).toBe('circle.contacts.returned_marker');
  });
});

describe('deleteContact — what the person granted that contact ends with it', () => {
  const BOT = 'B'.repeat(43);
  it('every key the contact is reached at is revoked on every node the person owns; a failure there does not stop the delete', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push(`${app}.${op}:${JSON.stringify(args)}`);
      if (op === 'listContacts') return { contacts: [{ webid: 'https://id.example/bot', pubKey: 'K'.repeat(43), peerAddr: BOT }] };
      if (op === 'revokeCompanionGrant') { if (args.to === BOT) throw new Error('node away'); return { ok: true, revoked: 0 }; }
      return { ok: true };
    };
    const r = await deleteContact({ callSkill, contactWebid: 'https://id.example/bot' });
    expect(r.ok).toBe(true);
    expect(calls).toContain(`household.revokeCompanionGrant:${JSON.stringify({ to: BOT })}`);
    expect(calls).toContain(`household.revokeCompanionGrant:${JSON.stringify({ to: 'K'.repeat(43) })}`);
    expect(calls.findIndex((c) => c.startsWith('stoop.setContactHidden'))).toBeLessThan(calls.findIndex((c) => c.startsWith('household.revokeCompanionGrant')));
  });

  it('the delete never waits on the revokes: a node that does not answer does not hold it up', async () => {
    let asked = 0;
    const callSkill = async (app, op) => {
      if (op === 'listContacts') return { contacts: [{ webid: BOT, peerAddr: BOT }] };
      if (op === 'revokeCompanionGrant') { asked += 1; return new Promise(() => {}); }   // never answers
      return { ok: true };
    };
    const r = await Promise.race([deleteContact({ callSkill, contactWebid: BOT }), new Promise((res) => { setTimeout(() => res('waited'), 500); })]);
    expect(r).toMatchObject({ ok: true });
    await new Promise((res) => { setTimeout(res, 0); });
    expect(asked, 'the revoke was fired').toBe(1);
  });
});
