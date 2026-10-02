/**
 * A person's screens on a household bot: `/scherm` gives a one-time link (ten minutes, for them alone, its nonce kept
 * as a hash), a screen's offer with that nonce is granted the person's role column as that person, and `/schermen`
 * lists and drops them; revoking the person drops them all.
 */
import { describe, it, expect } from 'vitest';
import { createBotScreens, parseScreenLink, SCREEN_LINK_TTL_MS } from '../../src/v2/botScreens.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { EventLog } from '../../src/eventLog.js';

function setup() {
  let clock = 1_000_000;
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore(), now: () => clock });
  const grants = [];
  const told = [];
  const privately = [];
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
    where: () => ({ appUrl: 'https://basis.example/app', botAddress: 'BOT', relayUrl: 'wss://relay.example' }),
    now: () => clock,
  });
  return { threads, screens, grants, told, privately, admitted, unreachable: () => { reachable = false; }, tick: (ms) => { clock += ms; } };
}
const linkText = (link, minutes) => `link ${link} (${minutes} min)`;
const start = async (ctx, person = 'telegram:1') => { const r = await ctx.screens.start(person, linkText); return r.ok ? ctx.privately.at(-1).text : null; };
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
    const ok = await screens.offer({ from: 'VIEW1', viewPubKey: 'VIEW1', nonce: n });
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
    expect(grants).toHaveLength(1);
  });

  it('/schermen lists only the person\'s own; drop one; revoking the person drops them all', async () => {
    const ctx = setup(); const { screens, grants } = ctx;
    for (const v of ['A', 'B']) await screens.offer({ from: v, viewPubKey: v, nonce: nonceOf(await start(ctx)) });
    grants.push({ viewPubKey: 'OTHERS', actingAs: 'telegram:2', ops: ['x'] });
    expect((await screens.list('telegram:1')).map((g) => g.viewPubKey)).toEqual(['A', 'B']);
    expect(await screens.drop('telegram:1', 1)).toMatchObject({ ok: true, viewPubKey: 'A' });
    expect(await screens.drop('telegram:1', 5)).toMatchObject({ ok: false, reason: 'no-such-screen' });
    expect(await screens.dropAll('telegram:1')).toBe(1);
    expect(grants.map((g) => g.viewPubKey)).toEqual(['OTHERS']);
  });

  it('no app address configured: no link', async () => {
    const { threads } = setup();
    const s = createBotScreens({ threads, isAdmitted: async () => true, sendPrivately: async () => ({ ok: true }), columnOf: async () => [], grant: async () => ({}), revokeView: async () => true, listGrants: async () => [], where: () => ({ appUrl: null, botAddress: 'BOT' }) });
    expect(await s.start('telegram:1', linkText)).toMatchObject({ ok: false, reason: 'no-app-url' });
  });
});
