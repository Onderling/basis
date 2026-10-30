/**
 * WHAT IS LEFT IN PINBOARD'S OWN PILE — measured, not assumed.
 *
 * Pinboard keeps its own store (the "pile", persisted beside the member cache) for every row that has no home of its
 * own yet: posts went to their circle's store, the roster trail and the rules head to their lanes, the invite code and
 * the post answers to the person's own-devices store. Before the pile and the member cache can be deleted, nothing a
 * reader needs may still land there. Three real agents composed as the shells compose them (with the device log); every write under the pile's and the
 * member cache's root is recorded in the clear, just above where it is sealed; the
 * usual acts; after each, what the medium holds. It pins EXACTLY what is left, so a new tenant fails it, and each step that
 * removes one shrinks the pinned list until it is empty and the pile and the member cache can go.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { CachingDataSource } from '@onderling/local-store';
import { bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, teardown } from '../support/pairRealAgents.js';


const GID = 'pile-tenants';
// What pinboard's own medium holds right now, path → row type (written in the clear here, sealed below this layer).
const held = new Map();   // `${medium}|${path}` → row type (one medium per agent)
const mediumIds = new WeakMap();
const idOf = (m) => { if (!mediumIds.has(m)) mediumIds.set(m, ++n); return mediumIds.get(m); };
let n = 0;
const describeRow = (data) => {
  let v = data;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return 'text'; } }
  if (!v || typeof v !== 'object') return typeof v;
  const tag = [v.type, v.kind, v.relation ? `relation=${v.relation}` : null, v.role ? `role=${v.role}` : null].filter(Boolean).join(' ');
  return tag || `{${Object.keys(v).slice(0, 5).join(',')}}`;
};
const shape = (p) => p.replace(/[0-9A-HJKMNP-TV-Z]{20,}|[A-Za-z0-9_%-]{30,}/g, '<id>');
function census() {
  const out = {};
  for (const [key, t] of held) { const p = key.slice(key.indexOf('|') + 1); const k = `${shape(p)} :: ${t}`; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

describe('pinboard\'s pile and member cache after the usual acts', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); vi.restoreAllMocks(); });

  it('lists what still lands there', async () => {
    const write = CachingDataSource.prototype.write;
    const del = CachingDataSource.prototype.delete;
    vi.spyOn(CachingDataSource.prototype, 'write').mockImplementation(async function (p, data) {
      if (String(p).startsWith('mem://neighbourhood/')) held.set(`${idOf(this)}|${p}`, describeRow(data));
      return write.call(this, p, data);
    });
    vi.spyOn(CachingDataSource.prototype, 'delete').mockImplementation(async function (p) {
      held.delete(`${idOf(this)}|${p}`);
      return del.call(this, p);
    });
    [A, B, C] = await Promise.all(['A', 'B', 'C'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
    await connectNodesOverBus([A, B, C]);
    const seen = {};
    const take = async (act) => { await new Promise((r) => { setTimeout(r, 400); }); seen[act] = census(); };
    await take('boot');
    await createCircle(A, { groupId: GID, name: 'Pile' }); await bindCircleAddresses([A], GID); await take('found');
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' }); await joinExistingCircle(A, C, { groupId: GID, handle: 'cee' }); await take('join');
    await A.agent.callSkill('pinboard', 'postAnnouncement', { groupId: GID, text: 'hallo' }); await take('post');
    await B.agent.callSkill('pinboard', 'leaveGroup', { groupId: GID, confirm: true }); await take('leave');
    await A.agent.callSkill('pinboard', 'removeMember', { groupId: GID, memberWebid: C.pubKey }); await take('remove');
    await A.agent.callSkill('pinboard', 'addContact', { webid: B.pubKey, pubKey: B.pubKey, displayName: 'Bee' }); await take('contact');
    await A.agent.callSkill('pinboard', 'setMyHandle', { handle: 'anna' });
    await A.agent.callSkill('pinboard', 'setMyDisplayName', { displayName: 'Anna' });
    await A.agent.callSkill('pinboard', 'setMyLocation', { location: 'Groningen' }); await take('profile');
    // Not covered here: an enrolment. On the in-process bus the consume stops at "seed-not-received" (the relay walks
    // cover the enrol: contactsReachEveryOwnDevice.relay.test.js); a census of it is the relay variant's to add.
    // What the medium still holds after every act, by kind of row. Each removal step shrinks this to nothing:
    //   the exits (group-leave / group-removal) have their home on the membership lane (`leave`, `evict`);
    //   the member entries are each device's own entry and the admin's entry per joiner.
    const kinds = (c) => [...new Set(Object.keys(c).map((k) => k.replace(/^mem:\/\/neighbourhood\/(\w+)\/.* :: /, '$1 :: ')))].sort();
    expect(kinds(seen.profile), `the census after every act:\n${JSON.stringify(seen, null, 1)}`).toEqual([
      'items :: group-leave',
      'items :: group-removal',
      'members :: relation=group-member',
      'members :: relation=group-member role=admin',
    ]);
  }, 120_000);
});
