/**
 * A person's screens on a household bot: `/scherm` gives a one-time link (ten minutes, for them alone, its nonce kept
 * as a hash), a screen's offer with that nonce is granted the person's role column as that person, and `/schermen`
 * lists and drops them; revoking the person drops them all.
 */
import { describe, it, expect } from 'vitest';
import { createBotScreens, parseScreenLink, screenCode, codeChoices, screenLabel, SCREEN_LINK_TTL_MS } from '../../src/v2/botScreens.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { EventLog } from '../../src/eventLog.js';

function setup() {
  let clock = 1_000_000;
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore(), now: () => clock });
  const grants = [];
  const told = [];
  const privately = [];
  const asked = [];
  const admitted = new Set(['telegram:1']);
  let reachable = true;
  const screens = createBotScreens({
    threads,
    isAdmitted: async (p) => admitted.has(p),
    sendPrivately: async (person, text) => { if (!reachable) return { ok: false, reason: 'no-private-chat' }; privately.push({ person, text }); return { ok: true }; },
    columnOf: async (p) => (p === 'telegram:1' ? ['lists.addToList', 'assistant.assistant-overview'] : []),
    grant: async (g) => { grants.push(g); return { ok: true }; },
    revokeView: async (v) => { const i = grants.findIndex((g) => g.viewPubKey === v); if (i < 0) return false; grants.splice(i, 1); return true; },
    listGrants: async () => grants.map((g) => ({ viewPubKey: g.viewPubKey, label: g.label, ops: g.ops, actingAs: g.actingAs })),
    notify: (person, key, params) => { told.push({ person, key, params }); },
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    where: () => ({ appUrl: 'https://basis.example/app', botAddress: 'BOT', relayUrl: 'wss://relay.example' }),
    now: () => clock,
  });
  return { threads, screens, grants, told, privately, asked, admitted, unreachable: () => { reachable = false; }, tick: (ms) => { clock += ms; } };
}
const linkText = (link, minutes) => `link ${link} (${minutes} min)`;
const start = async (ctx, person = 'telegram:1') => { const r = await ctx.screens.start(person, linkText); return r.ok ? ctx.privately.at(-1).text : null; };
const connect = async (ctx, v, person = 'telegram:1') => {
  const nonce = nonceOf(await start(ctx, person));
  await ctx.screens.offer({ from: v, viewPubKey: v, nonce });
  return ctx.screens.confirm(person, await screenCode(v, nonce), { isPrivate: true });
};
const nonceOf = (text) => parseScreenLink(/https?:\/\/\S+/.exec(text)[0]).nonce;

describe('a person connects a screen to the bot', () => {
  it('the link goes to the person privately; it carries the bot, the relay and a nonce — kept only as its hash', async () => {
    const ctx = setup();
    const r = await ctx.screens.start('telegram:1', linkText);
    expect(r).toMatchObject({ ok: true });
    expect(r.link, 'the link is not handed back to the chat it was asked in').toBeUndefined();
    expect(ctx.privately).toHaveLength(1);
    const link = /https?:\/\/\S+/.exec(ctx.privately[0].text)[0];
    expect(parseScreenLink(link)).toMatchObject({ ok: true, botAddress: 'BOT', relayUrl: 'wss://relay.example' });
    expect(link.startsWith('https://basis.example/app/#scherm=')).toBe(true);
    const row = ctx.threads.screenNonceOf('telegram:1');
    expect(JSON.stringify(row)).not.toContain(nonceOf(ctx.privately[0].text));
  });

  it('a person the bot cannot write to privately gets no link, and no pending nonce stays', async () => {
    const ctx = setup();
    ctx.unreachable();
    expect(await ctx.screens.start('telegram:1', linkText)).toMatchObject({ ok: false, reason: 'no-private-chat' });
    expect(ctx.threads.screenNonceOf('telegram:1')).toBeNull();
  });

  it('a person revoked inside the ten minutes: the offer is refused, nothing is granted; /revoke kills the link', async () => {
    const ctx = setup();
    const n = nonceOf(await start(ctx));
    ctx.admitted.delete('telegram:1');
    expect(await ctx.screens.offer({ from: 'V', viewPubKey: 'V', nonce: n })).toMatchObject({ ok: false, reason: 'not-admitted' });
    expect(ctx.grants).toHaveLength(0);
    ctx.admitted.add('telegram:1');
    const n2 = nonceOf(await start(ctx));
    await ctx.screens.dropAll('telegram:1');
    expect(await ctx.screens.offer({ from: 'V', viewPubKey: 'V', nonce: n2 })).toMatchObject({ ok: false, reason: 'unknown-nonce' });
  });

  it('the offer: granted the person\'s column as that person, and they are told; the nonce works once', async () => {
    const ctx = setup(); const { screens, grants, told } = ctx;
    const n = nonceOf(await start(ctx));
    const offered = await screens.offer({ from: 'VIEW1', viewPubKey: 'VIEW1', nonce: n });
    expect(offered).toMatchObject({ ok: true, pending: true, person: 'telegram:1', code: await screenCode('VIEW1', n) });
    expect(grants, 'nothing is granted before the person says yes').toEqual([]);
    expect(ctx.asked).toHaveLength(1);
    expect(ctx.asked[0].codes).toHaveLength(3);
    expect(ctx.asked[0].codes).toContain(offered.code);
    const ok = await screens.confirm('telegram:1', offered.code, { isPrivate: true });
    expect(ok).toMatchObject({ ok: true, person: 'telegram:1' });
    expect(grants[0]).toMatchObject({ viewPubKey: 'VIEW1', actingAs: 'telegram:1', ops: ['lists.addToList', 'assistant.assistant-overview'], nonce: n });
    expect(told).toEqual([{ person: 'telegram:1', key: 'circle.bot.screen_connected', params: { n: 2 } }]);
    expect(await screens.offer({ from: 'VIEW2', viewPubKey: 'VIEW2', nonce: n })).toMatchObject({ ok: false, reason: 'unknown-nonce' });
    expect(grants).toHaveLength(1);
  });

  it('refused: too late, from another key than it names, a nonce nobody asked for; a new link ends the old one', async () => {
    const ctx = setup(); const { screens, grants, tick } = ctx;
    const late = nonceOf(await start(ctx));
    tick(SCREEN_LINK_TTL_MS + 1);
    expect(await screens.offer({ from: 'V', viewPubKey: 'V', nonce: late })).toMatchObject({ ok: false, reason: 'expired' });
    const n = nonceOf(await start(ctx));
    expect(await screens.offer({ from: 'OTHER', viewPubKey: 'V', nonce: n })).toMatchObject({ ok: false, reason: 'wrong-sender' });
    expect(await screens.offer({ from: 'V', viewPubKey: 'V', nonce: 'made-up' })).toMatchObject({ ok: false, reason: 'unknown-nonce' });
    const first = nonceOf(await start(ctx));
    const second = nonceOf(await start(ctx));
    expect(await screens.offer({ from: 'V', viewPubKey: 'V', nonce: first })).toMatchObject({ ok: false, reason: 'unknown-nonce' });
    expect((await screens.offer({ from: 'V', viewPubKey: 'V', nonce: second })).ok).toBe(true);
    expect(grants, 'still nothing without a yes').toHaveLength(0);
  });

  it('/schermen lists only the person\'s own; drop one; revoking the person drops them all', async () => {
    const ctx = setup(); const { screens, grants } = ctx;
    for (const v of ['A', 'B']) await connect(ctx, v);
    grants.push({ viewPubKey: 'OTHERS', actingAs: 'telegram:2', ops: ['x'] });
    expect((await screens.list('telegram:1')).map((g) => g.viewPubKey)).toEqual(['A', 'B']);
    expect(await screens.drop('telegram:1', 1)).toMatchObject({ ok: true, viewPubKey: 'A' });
    expect(await screens.drop('telegram:1', 5)).toMatchObject({ ok: false, reason: 'no-such-screen' });
    expect(await screens.dropAll('telegram:1')).toBe(1);
    expect(grants.map((g) => g.viewPubKey)).toEqual(['OTHERS']);
  });

  it('the confirm: only the code the screen shows grants; a wrong code, "geen" or a bare yes drop the offer; a group, ten minutes, a second offer', async () => {
    const ctx = setup();
    const offerFor = async (v) => { const nonce = nonceOf(await start(ctx)); await ctx.screens.offer({ from: v, viewPubKey: v, nonce }); return screenCode(v, nonce); };
    let code = await offerFor('A');
    expect(ctx.grants, 'a valid nonce and no answer: nothing on the lane').toEqual([]);
    expect(await ctx.screens.confirm('telegram:1', code, { isPrivate: false })).toMatchObject({ ok: false, reason: 'not-private' });
    expect(ctx.threads.screenOfferOf('telegram:1'), 'a group answer does not spend the offer').toBeTruthy();
    // a wrong code, "geen", and a bare yes: nothing granted, the offer dropped
    for (const wrong of ['ZZZZ', 'geen', 'ja']) {
      code = await offerFor('W');
      expect(await ctx.screens.confirm('telegram:1', wrong, { isPrivate: true }), wrong).toMatchObject({ ok: true, declined: true });
      expect(ctx.threads.screenOfferOf('telegram:1')).toBeNull();
    }
    expect(ctx.grants).toEqual([]);
    // a second offer while one waits: the first is dropped, the person told
    await offerFor('B1');
    const codeB = await offerFor('B');
    expect(ctx.asked.at(-1)).toMatchObject({ replaced: true });
    expect((await ctx.screens.confirm('telegram:1', codeB, { isPrivate: true })).ok).toBe(true);
    expect(ctx.grants.map((g) => g.viewPubKey)).toEqual(['B']);
    // too late
    const codeD = await offerFor('D');
    ctx.tick(SCREEN_LINK_TTL_MS + 1);
    expect(await ctx.screens.confirm('telegram:1', codeD, { isPrivate: true })).toMatchObject({ ok: false, reason: 'expired' });
    expect(ctx.grants.map((g) => g.viewPubKey)).toEqual(['B']);
  });

  it('three codes to pick from, the real one among them; a label is one line of 40 characters', () => {
    const c = codeChoices('4F7K', () => 0.42);
    expect(new Set(c).size).toBe(3);
    expect(c).toContain('4F7K');
    expect(screenLabel('a\nvery   long\tlabel that goes on and on past forty characters for sure')).toMatch(/^[^\n]{1,40}$/);
  });

  it('the code is what both sides compute: four letters, the same for the same key and nonce, different otherwise', async () => {
    const a = await screenCode('VIEW', 'n1');
    expect(a).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
    expect(await screenCode('VIEW', 'n1')).toBe(a);
    expect(await screenCode('VIEW', 'n2')).not.toBe(a);
  });

  it('no app address configured: no link', async () => {
    const { threads } = setup();
    const s = createBotScreens({ threads, ask: async () => ({ ok: true }), isAdmitted: async () => true, sendPrivately: async () => ({ ok: true }), columnOf: async () => [], grant: async () => ({}), revokeView: async () => true, listGrants: async () => [], where: () => ({ appUrl: null, botAddress: 'BOT' }) });
    expect(await s.start('telegram:1', linkText)).toMatchObject({ ok: false, reason: 'no-app-url' });
  });
});
