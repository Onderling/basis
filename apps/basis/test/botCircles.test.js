/**
 * The bot joins a circle on its admin's word (`/kring <invite>`), from the admin's PRIVATE chat: the bot says the
 * circle's name and rules and what joining means for this box (it keeps that circle's data here), with Ja / Nee. Only
 * the yes joins, with the rules accepted and a roster handle that names the bot's operator. `/kringen` lists the circles
 * it joined; `/kring los <naam>` leaves one and FORGETS its content on the box; a removal (eviction) forgets it too.
 */
import { describe, it, expect } from 'vitest';
import { createBotCircles, botCircleHandle } from '../src/v2/botCircles.js';

const invite = (o = {}) => `onderling-invite://${Buffer.from(JSON.stringify({ groupId: 'circle-1', code: 'C0DE', name: 'Huize Rood', rules: { purpose: 'samen boodschappen' }, adminPeerAddr: 'ADMIN', ...o })).toString('base64url')}`;

function memRows() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], remove: async (id) => { m.delete(id); } };
}

function make({ joinResult = { ok: true, circleId: 'circle-1' }, onLeave = null } = {}) {
  const asked = []; const joins = []; const left = []; const forgot = [];
  const circles = createBotCircles({
    store: memRows(),
    join: async (a) => { joins.push(a); return joinResult; },
    leave: async (circleId) => { left.push(circleId); if (onLeave) await onLeave(circles); return { ok: true }; },
    forget: async (circleId) => { forgot.push(circleId); return { ok: true, rows: 3, entries: 5 }; },
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    handle: () => 'huisbot-van-frits',
  });
  const question = ({ name, rules, id, handle }) => ({ text: `Q ${name} | ${rules} | @${handle}`, buttons: [{ id: `/kring ja ${id}` }, { id: `/kring nee ${id}` }] });
  return { circles, asked, joins, left, forgot, question };
}

describe('the bot joins a circle on its admin\'s word', () => {
  it('the invite pasted: the question names the circle and its rules; nothing joined before the yes', async () => {
    const d = make();
    const r = await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(d.asked[0].text).toContain('Huize Rood');
    expect(d.asked[0].text).toContain('samen boodschappen');
    expect(d.asked[0].text).toContain('@huisbot-van-frits');   // the admin's name going to the circle, said first
    expect(d.joins).toEqual([]);
    expect(await d.circles.list()).toEqual([]);
  });

  it('pasted in a group: refused, nothing asked', async () => {
    const d = make();
    expect(await d.circles.offered('admin', invite(), d.question, { isPrivate: false })).toMatchObject({ ok: false, reason: 'not-private' });
    expect(d.asked).toEqual([]);
  });

  it('not an invite: refused, nothing asked', async () => {
    const d = make();
    expect(await d.circles.offered('admin', 'hallo', d.question, { isPrivate: true })).toMatchObject({ ok: false, reason: 'not-an-invite' });
    expect(d.asked).toEqual([]);
  });

  it('no: not joined; the question is spent', async () => {
    const d = make();
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    const id = d.asked[0].buttons[0].id.split(' ').pop();
    expect(await d.circles.answer('admin', false, id, { isPrivate: true })).toMatchObject({ ok: true, declined: true });
    expect(await d.circles.answer('admin', true, id, { isPrivate: true })).toMatchObject({ ok: false, reason: 'nothing-pending' });
    expect(d.joins).toEqual([]);
  });

  it('the yes from a group does not join; the yes with another id does not join', async () => {
    const d = make();
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    const id = d.asked[0].buttons[0].id.split(' ').pop();
    expect(await d.circles.answer('admin', true, id, { isPrivate: false })).toMatchObject({ ok: false, reason: 'not-private' });
    expect(await d.circles.answer('admin', true, 'other-id', { isPrivate: true })).toMatchObject({ ok: false, reason: 'replaced' });
    expect(d.joins).toEqual([]);
  });

  it('the yes joins: rules accepted, the operator\'s handle, the circle recorded', async () => {
    const d = make();
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    const id = d.asked[0].buttons[0].id.split(' ').pop();
    const r = await d.circles.answer('admin', true, id, { isPrivate: true });
    expect(r).toMatchObject({ ok: true, joined: true, name: 'Huize Rood' });
    expect(d.joins[0]).toMatchObject({ rulesAccepted: true, handle: 'huisbot-van-frits' });
    expect(await d.circles.list()).toEqual([expect.objectContaining({ id: 'circle-1', name: 'Huize Rood' })]);
    expect(await d.circles.isJoined('circle-1')).toBe(true);
    expect(await d.circles.handleIn('circle-1')).toBe('huisbot-van-frits');
  });

  it('a join that fails says why and records nothing', async () => {
    const d = make({ joinResult: { error: 'admin-unreachable', reason: 'admin-unreachable' } });
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    const id = d.asked[0].buttons[0].id.split(' ').pop();
    expect(await d.circles.answer('admin', true, id, { isPrivate: true })).toMatchObject({ ok: false, reason: 'admin-unreachable' });
    expect(await d.circles.list()).toEqual([]);
  });

  it('an invite for a circle it is in already: said, nothing asked', async () => {
    const d = make();
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    await d.circles.answer('admin', true, d.asked[0].buttons[0].id.split(' ').pop(), { isPrivate: true });
    expect(await d.circles.offered('admin', invite(), d.question, { isPrivate: true })).toMatchObject({ ok: true, already: true });
    expect(d.asked).toHaveLength(1);
  });
});

describe('leaving, and being removed', () => {
  async function joined() {
    const d = make();
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    await d.circles.answer('admin', true, d.asked[0].buttons[0].id.split(' ').pop(), { isPrivate: true });
    return d;
  }

  it('/kring los <naam> (private): leaves, then forgets the circle\'s content; the record goes', async () => {
    const d = await joined();
    expect(await d.circles.leaveNamed('huize rood', { isPrivate: false })).toMatchObject({ ok: false, reason: 'not-private' });
    const r = await d.circles.leaveNamed('huize rood', { isPrivate: true });
    expect(r).toMatchObject({ ok: true, name: 'Huize Rood' });
    expect(d.left).toEqual(['circle-1']);
    expect(d.forgot).toEqual(['circle-1']);
    expect(await d.circles.list()).toEqual([]);
    expect(await d.circles.isJoined('circle-1')).toBe(false);
  });

  it('a removal noticed WHILE it leaves (its own leave folding back) is not a second forget', async () => {
    const d = make({ onLeave: async (circles) => { d.during = await circles.removed('circle-1'); } });
    await d.circles.offered('admin', invite(), d.question, { isPrivate: true });
    await d.circles.answer('admin', true, d.asked[0].buttons[0].id.split(' ').pop(), { isPrivate: true });
    const r = await d.circles.leaveNamed('huize rood', { isPrivate: true });
    expect(r.ok).toBe(true);
    expect(d.during).toMatchObject({ ok: false });
    expect(d.forgot).toEqual(['circle-1']);
  });

  it('one removal noticed twice at once (two membership changes): forgotten once', async () => {
    const d = await joined();
    const [a, b] = await Promise.all([d.circles.removed('circle-1'), d.circles.removed('circle-1')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(d.forgot).toEqual(['circle-1']);
  });

  it('an unknown name: said, nothing left', async () => {
    const d = await joined();
    expect(await d.circles.leaveNamed('nergens', { isPrivate: true })).toMatchObject({ ok: false, reason: 'unknown-circle' });
    expect(d.left).toEqual([]);
  });

  it('removed from a joined circle: its content forgotten, the record goes; another circle is not touched', async () => {
    const d = await joined();
    expect(await d.circles.removed('some-pair-circle')).toMatchObject({ ok: false });
    expect(d.forgot).toEqual([]);
    expect(await d.circles.removed('circle-1')).toMatchObject({ ok: true });
    expect(d.forgot).toEqual(['circle-1']);
    expect(await d.circles.list()).toEqual([]);
  });
});

describe('the handle on the circle\'s roster names the operator', () => {
  it('a slug of the bot and its operator, within the handle rule', () => {
    expect(botCircleHandle('Huisbot', 'Frits de Roos')).toBe('huisbot-van-frits-de-roos');
    expect(botCircleHandle(null, null)).toBe('huisbot');
    expect(botCircleHandle('@Onderling_bot', 'Ånne')).toBe('onderling_bot-van-anne');
    expect(botCircleHandle('bot', 'een heel lange naam van iemand die niet stopt')).toMatch(/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/);
  });
});
