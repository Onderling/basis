/**
 * THE ONE-TIME MOVE OF THE OLD CONTACT BOOK. Before the contact book became own-devices rows, a contact was a MemberMap
 * entry marked `relation: 'contact'` — and on a box, the household bot's admitted people are such rows (`botUsers` over
 * `contactBookStore`). A device that updates must keep them: at boot each old contact row is written once into the
 * book, as the self it is filed under, and its MemberMap entry stops being a contact (the marker: a second boot moves
 * nothing). Here a box's bot users are written the old way, the pinboard restarts over the same files on the new
 * bytes, and the bot's people are unchanged.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '@onderling-app/pinboard';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createBotUsers, contactBookStore } from '../src/v2/botUsers.js';

const ME = 'me-webid';
const invoke = (agent) => (app, op, args) => agent.skills.get(op).handler({ parts: [DataPart(args ?? {})], from: ME, agent, envelope: null });

describe('the old contact book moves into the own-devices book once', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it("a box's admitted bot users are the bot's users still after the update", async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'contacts-move-'));
    const own = createOwnDevicesStore();
    const boot = async () => {
      const id = await AgentIdentity.generate(new VaultMemory());
      return createNeighbourhoodAgent({
        identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
        offeringMatch: { group: 'g', localActor: ME, peers: [] },
        members: [{ webid: ME }], persistPath: dir,
        contactStore: () => own, contactSelfFor: () => ({ id: 'default', writer: ME }),
      });
    };

    // the old bytes' rows: the bot's admitted people and a person's card, as MemberMap contact entries
    const first = await boot();
    await first.members.addMember({ webid: 'telegram:42', relation: 'contact', channel: 'telegram', role: 'member', displayName: 'Ann' });
    await first.members.addMember({ webid: 'telegram:7', relation: 'contact', channel: 'telegram', role: 'admin' });
    await first.members.addMember({ webid: 'w:bea', relation: 'contact', displayName: 'Bea', pubKey: 'w:bea', trustLevel: 'vertrouwd', hidden: true, hiddenAt: 5 });
    await new Promise((r) => setTimeout(r, 300));   // the debounced save

    const second = await boot();
    const users = createBotUsers({ store: contactBookStore(invoke(second.agent)) });
    const byId = Object.fromEntries((await users.list()).map((u) => [u.id, u]));
    expect(byId['telegram:42'], 'an admitted member is still the bot\'s').toMatchObject({ channel: 'telegram', uid: '42', role: 'member', displayName: 'Ann' });
    expect(byId['telegram:7'], 'the admin still is').toMatchObject({ role: 'admin' });
    const bea = await second.contacts.get('w:bea');
    expect(bea, 'a person\'s contact moved with its marks').toMatchObject({ displayName: 'Bea', trustLevel: 'vertrouwd', hidden: true, hiddenAt: 5 });
    expect((await second.members.resolveByWebid('w:bea'))?.relation, 'the old entry is no longer a contact (moved)').toBe('group-member');
    const rowsAfterMove = (await own.list()).length;
    await new Promise((r) => setTimeout(r, 300));

    // a third boot moves nothing again
    const third = await boot();
    await third.contacts.listContacts();
    expect((await own.list()).length, 'run once: nothing written twice').toBe(rowsAfterMove);
  });
});
