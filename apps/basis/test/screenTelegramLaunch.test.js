/**
 * A screen opened inside Telegram connects by Telegram's signed launch data, not the code to pick — under the rules:
 * the hash checked (constant time), at most a minute old, used once, from a private chat, for an ADMITTED person (a launch
 * admits nobody), offered from the key it names. One Telegram-launched screen per person: a new launch replaces the
 * first (that key revoked, the person told); the same key again is the same screen. And the grant equals the one the
 * code pick gives the same person — the same ops, acting as them.
 */
import { describe, it, expect } from 'vitest';
import { createBotScreens } from '../src/v2/botScreens.js';
import { verifyTelegramLaunch, telegramLaunchHash, launchDataFrom } from '../src/v2/telegramLaunch.js';
import { screenCode } from '../src/v2/botScreens.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const TOKEN = '123456:test-only-token';
const NOW = 1_800_000_000_000;

async function launchData({ id = 42, ageS = 5, chatType = null, token = TOKEN, queryId = 'q1' } = {}) {
  const p = new URLSearchParams();
  p.set('query_id', queryId);
  p.set('user', JSON.stringify({ id, first_name: 'Ann' }));
  p.set('auth_date', String(Math.floor(NOW / 1000) - ageS));
  if (chatType) p.set('chat_type', chatType);
  p.set('hash', await telegramLaunchHash(p, token));
  return p.toString();
}

function bot({ admitted = ['telegram:42'] } = {}) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const grants = []; const revoked = []; const told = []; const refused = [];
  const asked = [];
  const deps = {
    threads,
    isAdmitted: async (p) => admitted.includes(p),
    columnOf: async () => ['lists.addToList', 'assistant.assistant-menu'],
    grant: async (g) => { grants.push(g); return { ok: true }; },
    revokeView: async (k) => { revoked.push(k); return true; },
    listGrants: async () => grants.map((g) => ({ viewPubKey: g.viewPubKey, actingAs: g.actingAs, label: g.label, ops: g.ops })),
    notify: async (person, key) => { told.push([person, key]); },
    ask: async (person, q) => { asked.push([person, q]); return { ok: true }; },
    tellRefused: async (k) => { refused.push(k); },
    sendPrivately: async () => ({ ok: true }),
    where: () => ({ appUrl: 'https://onderling.org/basis', botAddress: 'BOT', relayUrl: null }),
    verifyLaunch: (initData) => verifyTelegramLaunch(initData, { botToken: TOKEN, now: () => NOW }),
    personOfTelegram: async (id) => (admitted.includes(`telegram:${id}`) ? `telegram:${id}` : null),
    launchLabel: () => 'Telegram-scherm',
    now: () => NOW,
  };
  const screens = createBotScreens(deps);
  return { screens, deps, threads, grants, revoked, told, refused, asked };
}

describe('the launch data', () => {
  it('a true launch: the person it names', async () => {
    expect(await verifyTelegramLaunch(await launchData(), { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: true, telegramId: '42' });
  });
  it('a tampered field, another bot\'s token, older than a minute, a group: refused', async () => {
    const good = await launchData();
    const tampered = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(tampered).not.toBe(good);
    expect(await verifyTelegramLaunch(tampered, { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: false, reason: 'bad-hash' });
    expect(await verifyTelegramLaunch(await launchData({ token: '999:other' }), { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: false, reason: 'bad-hash' });
    expect(await verifyTelegramLaunch(await launchData({ ageS: 61 }), { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await verifyTelegramLaunch(await launchData({ chatType: 'group' }), { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: false, reason: 'not-private' });
    expect(await verifyTelegramLaunch(await launchData({ chatType: 'sender' }), { botToken: TOKEN, now: () => NOW })).toMatchObject({ ok: true });
  });
  it('read from the page\'s address as Telegram puts it there', async () => {
    const d = await launchData();
    expect(launchDataFrom(`#tgWebAppData=${encodeURIComponent(d)}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`)).toBe(d);
    expect(launchDataFrom('#scherm-bot=x')).toBe(null);
  });
});

describe('a screen launched inside Telegram', () => {
  it('a true launch from the key it names: granted, no code asked', async () => {
    const b = bot();
    const r = await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n1', initData: await launchData() });
    expect(r).toMatchObject({ ok: true, person: 'telegram:42' });
    expect(b.asked).toEqual([]);
    expect(b.grants).toEqual([expect.objectContaining({ viewPubKey: 'K1', actingAs: 'telegram:42', label: 'Telegram-scherm', nonce: 'n1' })]);
  });

  it('refused before anything: a tampered hash, a stale launch, an offer not from the key it names', async () => {
    const b = bot();
    const good = await launchData();
    expect(await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n', initData: good.replace(/hash=[0-9a-f]{4}/, 'hash=0000') })).toMatchObject({ ok: false, reason: 'bad-hash' });
    expect(await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n', initData: await launchData({ ageS: 120 }) })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await b.screens.launched({ from: 'OTHER', viewPubKey: 'K1', nonce: 'n', initData: good })).toMatchObject({ ok: false, reason: 'wrong-sender' });
    expect(b.grants).toEqual([]);
    // the wrong sender spent nothing: the true launch still goes
    expect((await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n', initData: good })).ok).toBe(true);
  });

  it('the same launch twice: the second refused, whatever key sends it', async () => {
    const b = bot();
    const d = await launchData();
    expect((await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n1', initData: d })).ok).toBe(true);
    expect(await b.screens.launched({ from: 'K2', viewPubKey: 'K2', nonce: 'n2', initData: d })).toMatchObject({ ok: false, reason: 'used' });
    expect(b.grants).toHaveLength(1);
    expect(b.refused).toEqual(['K2']);
  });

  it('one use per person survives a restart: a launch not newer than the last taken one is refused', async () => {
    const b = bot();
    const d = await launchData({ ageS: 10 });
    expect((await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n1', initData: d })).ok).toBe(true);
    // the box restarts: the in-memory record is gone, the thread rows stay
    const again = createBotScreens({ ...b.deps, now: () => NOW });
    expect(await again.launched({ from: 'K2', viewPubKey: 'K2', nonce: 'n2', initData: d })).toMatchObject({ ok: false, reason: 'used' });
    expect(await again.launched({ from: 'K2', viewPubKey: 'K2', nonce: 'n2', initData: await launchData({ ageS: 20, queryId: 'older' }) })).toMatchObject({ ok: false, reason: 'used' });
    expect((await again.launched({ from: 'K2', viewPubKey: 'K2', nonce: 'n3', initData: await launchData({ ageS: 2, queryId: 'newer' }) })).ok).toBe(true);
  });

  it('a Telegram id not in the book: refused, no grant (a launch admits nobody)', async () => {
    const b = bot({ admitted: [] });
    expect(await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n', initData: await launchData() })).toMatchObject({ ok: false, reason: 'stranger' });
    expect(b.grants).toEqual([]);
  });

  it('a second launch replaces the first: that key revoked, the person told; the same key again is the same screen', async () => {
    const b = bot();
    await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n1', initData: await launchData({ queryId: 'a', ageS: 9 }) });
    await b.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n2', initData: await launchData({ queryId: 'b', ageS: 6 }) });
    expect(b.revoked).toEqual([]);
    await b.screens.launched({ from: 'K2', viewPubKey: 'K2', nonce: 'n3', initData: await launchData({ queryId: 'c', ageS: 3 }) });
    expect(b.revoked).toEqual(['K1']);
    expect(b.told).toContainEqual(['telegram:42', 'circle.bot.screen_launch_replaced']);
    expect(b.threads.telegramScreenOf('telegram:42')).toBe('K2');
  });

  it('the grant equals the one the code pick gives the same person', async () => {
    const viaLaunch = bot();
    await viaLaunch.screens.launched({ from: 'K1', viewPubKey: 'K1', nonce: 'n1', initData: await launchData() });
    const viaPick = bot();
    viaPick.threads.setScreenNonce('telegram:42', null);
    await viaPick.screens.pasted('telegram:42', { viewPubKey: 'K1', nonce: 'n1', label: 'Telegram-scherm' });
    await viaPick.screens.confirm('telegram:42', await screenCode('K1', 'n1'), { isPrivate: true });
    expect(viaLaunch.grants).toEqual(viaPick.grants);
  });

  it('a launch pasted into the chat is not a launch: the paste route asks for the code as always', async () => {
    const b = bot();
    await b.screens.pasted('telegram:42', { viewPubKey: 'K1', nonce: 'n1', initData: await launchData() });
    expect(b.asked).toHaveLength(1);
    expect(b.grants).toEqual([]);
  });

  it('/scherm puts the "Open het scherm" button in the person\'s private chat when there is one', async () => {
    const sent = [];
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const screens = createBotScreens({
      threads, isAdmitted: async () => true, columnOf: async () => [], grant: async () => ({}), revokeView: async () => true, listGrants: async () => [],
      sendPrivately: async (person, text, remember, buttons) => { sent.push({ person, buttons }); return { ok: true }; },
      where: () => ({ appUrl: 'https://onderling.org/basis', botAddress: 'BOT' }),
      launchButton: (person) => (person.startsWith('telegram:') ? { label: 'Open het scherm', webApp: 'https://onderling.org/basis/?scherm-tg=x' } : null),
    });
    await screens.start('telegram:42', (l) => l);
    await screens.startPaste('telegram:9', (l) => l);
    await screens.start('web-key', (l) => l);
    expect(sent.map((s) => s.buttons)).toEqual([[{ label: 'Open het scherm', webApp: 'https://onderling.org/basis/?scherm-tg=x' }], [{ label: 'Open het scherm', webApp: 'https://onderling.org/basis/?scherm-tg=x' }], null]);
  });
});
