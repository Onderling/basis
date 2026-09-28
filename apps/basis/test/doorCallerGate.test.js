/**
 * A person at a door is a CALLER, and the gate checks them like any other.
 *
 * A household bot serves several people over its doors, and every call it made ran on its own (the owner's)
 * authority — so what a chat could reach was decided only by which surfaces a door happened to offer. Now a door
 * passes the person as `ctx.caller`, and `callSkill` runs the same tier-vs-visibility check a peer meets:
 *   - a stranger (no record) is `public` and reaches nothing a member reaches;
 *   - a member (`authenticated`) reaches the household's ops;
 *   - the bot's admin (`trusted`) reaches what an admin may, and NEVER the owner's own skills — those are `private`,
 *     self only, whatever tier anyone is given;
 *   - the owner, calling without a door caller, is unchanged.
 * A role can never be raised to `private` from a door: root is whoever holds the machine, not a role.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { createBotUsers, contactBookStore, createDoorAdmit } from '../src/v2/botUsers.js';

const nodes = [];
afterAll(() => teardown(nodes));

describe('the door caller gate', () => {
  it('stranger · member · admin · owner — each reaches what its level reaches, and the owner\'s skills stay the owner\'s', async () => {
    const node = await bootRealAgentNode('bot');
    nodes.push(node);
    const { agent } = node;
    await agent.setDoorCaller('telegram:111', 'member');
    await agent.setDoorCaller('telegram:222', 'admin');

    const refused = (r) => r && r.ok === false && typeof r.error === 'string';

    // a stranger: not admitted, so public — refused even an ordinary household read
    expect(refused(await agent.callSkill('household', 'listOpen', { type: 'shopping' }, { caller: 'telegram:999' }))).toBe(true);
    // a member reaches the household's ops…
    expect(refused(await agent.callSkill('household', 'listOpen', { type: 'shopping' }, { caller: 'telegram:111' }))).toBe(false);
    // …and never the owner's own
    const memberPhrase = await agent.callSkill('household', 'revealOwnerPhrase', {}, { caller: 'telegram:111' });
    expect(refused(memberPhrase)).toBe(true);
    expect(JSON.stringify(memberPhrase)).not.toMatch(/mnemonic/);
    // the admin does not reach them either
    const adminPhrase = await agent.callSkill('household', 'revealOwnerPhrase', {}, { caller: 'telegram:222' });
    expect(refused(adminPhrase)).toBe(true);
    expect(JSON.stringify(adminPhrase)).not.toMatch(/mnemonic/);
    // the owner, with no door caller, is unchanged
    const own = await agent.callSkill('household', 'revealOwnerPhrase', {});
    expect(refused(own)).toBe(false);
  }, 90_000);

  it('a door\'s task is recorded as the person\'s: the host vouches for them as its actor', async () => {
    const node = await bootRealAgentNode('bot3');
    nodes.push(node);
    const { agent } = node;
    await agent.setDoorCaller('telegram:111', 'member');
    const added = await agent.callSkill('tasks', 'addTask', { text: 'fietsband plakken' }, { caller: 'telegram:111' });
    expect(added?.error, JSON.stringify(added)).toBeUndefined();
    const mine = await agent.callSkill('tasks', 'listMine', {}, { caller: 'telegram:111' });
    const row = (mine?.items ?? []).find((t) => (t.text ?? t.title) === 'fietsband plakken');
    expect(row, JSON.stringify(mine)).toBeTruthy();
    expect(row.actor).toBe('telegram:111');
    // a stranger adds nothing
    const refused = await agent.callSkill('tasks', 'addTask', { text: 'nope' }, { caller: 'telegram:999' });
    expect(refused).toMatchObject({ ok: false });
  }, 90_000);

  it('the door admits people into the contact book: the named admin is admin, everyone else a member, both keyless', async () => {
    const node = await bootRealAgentNode('bot4');
    nodes.push(node);
    const { agent } = node;
    const users = createBotUsers({ store: contactBookStore(agent.callSkill), adminUid: '222' });
    const admit = createDoorAdmit({ users, setDoorCaller: agent.setDoorCaller });
    const ann = await admit({ channel: 'telegram', uid: '111', displayName: 'Ann' });
    const frits = await admit({ channel: 'telegram', uid: '222', displayName: 'Frits' });
    expect([ann, frits]).toEqual(['telegram:111', 'telegram:222']);
    expect(await users.roleOf('telegram:111')).toBe('member');
    expect(await users.roleOf('telegram:222')).toBe('admin');
    // they are rows of the contact book, with no key
    const book = await agent.callSkill('stoop', 'listContacts', {});
    const rows = (book?.contacts ?? book ?? []).filter((c) => String(c.webid).startsWith('telegram:'));
    expect(rows.map((r) => r.webid).sort()).toEqual(['telegram:111', 'telegram:222']);
    for (const r of rows) expect(r.pubKey ?? null).toBeNull();
    // admitted again: the same row, the same role
    await admit({ channel: 'telegram', uid: '111' });
    expect(await users.list()).toHaveLength(2);
    // and the gate knows them: the member reaches the household, a stranger does not
    const refused = (r) => r && r.ok === false;
    expect(refused(await agent.callSkill('household', 'listOpen', { type: 'shopping' }, { caller: ann }))).toBe(false);
    expect(refused(await agent.callSkill('household', 'listOpen', { type: 'shopping' }, { caller: 'telegram:999' }))).toBe(true);
  }, 90_000);

  it('the door\'s own admin ops: the admin passes `trusted`, a member does not, a stranger nothing', async () => {
    const node = await bootRealAgentNode('bot5');
    nodes.push(node);
    const { agent } = node;
    await agent.setDoorCaller('telegram:111', 'member');
    await agent.setDoorCaller('telegram:222', 'admin');
    expect(await agent.doorRefusal('assistant-apps', 'telegram:222', 'trusted')).toBeNull();
    expect(await agent.doorRefusal('assistant-apps', 'telegram:111', 'trusted')).toBeTruthy();
    expect(await agent.doorRefusal('assistant-memory', 'telegram:111', 'authenticated')).toBeNull();
    expect(await agent.doorRefusal('assistant-memory', 'telegram:999', 'authenticated')).toBeTruthy();
  }, 90_000);

  it('a door can never raise anyone to the owner\'s level', async () => {
    const node = await bootRealAgentNode('bot2');
    nodes.push(node);
    await expect(node.agent.setDoorCaller('telegram:333', 'private')).rejects.toThrow();
    await expect(node.agent.setDoorCaller('telegram:333', 'root')).rejects.toThrow();
  }, 90_000);
});
