/**
 * NEARBY'S TWO TABS IN A REAL BROWSER: Gesprek (one stream by arrival: chat lines, and a card for each question asked
 * here and each circle offered here) and Vragen, each tab with a count of what is new; and the empty room, where no
 * part says it is empty and the tabs are still there.
 *
 * How it reaches the screen: the web shows no Nearby tab (the alpha paints it only on a device with a local mesh,
 * `MESH_TABS` in alphaSurface.js; a browser has none), and there is no flag that turns it on. So this boots the real
 * app (its CSS, its translator), then composes the screen the way `showNearby` does — the real controller
 * (`createNearbyScreen`) and the real painter (`renderCircleNearby`) in the app's own root — with the room's inbound
 * subscriptions handed questions, a circle and chat lines, as a mesh would. The acts go through the controller's own
 * methods (`say`, `dismissAsk`), the same ones the app wires.
 *
 * Screenshots at phone width (390 px) for the notes: gesprek.png, vragen.png, verborgen.png (hidden: no stream, one
 * line) and empty-room.png under the test's output.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/nearby-tabs.spec.js
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.setTimeout(120_000);
const here = path.dirname(fileURLToPath(import.meta.url));
// vite's root is `web/`, so the shared modules are served by their file path — the same module instances the app uses
const fsUrl = (rel) => `/@fs${path.resolve(here, rel)}`;
const MODS = {
  screen: fsUrl('../src/v2/nearbyScreen.js'),
  painter: fsUrl('../web/v2/circleNearby.js'),
  alpha: fsUrl('../src/v2/alphaSurface.js'),
  loc: fsUrl('../src/localisation.js'),
  menu: fsUrl('../src/v2/nearbyMenu.js'),
};
const ready = async (page) => {
  await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 });
};

/** Compose Nearby in the app's root, in Dutch; `fill` says whether the room has people talking and asking, `chat`
 *  whether the person is in the chat (default: when filled). The device is seen by the room through a stand-in for
 *  the radio's discoverability control (a browser has none), which reports exactly the state it is asked for — so the
 *  controller's own `setQuiet` really makes the person hidden. */
async function openNearby(page, { fill, chat = fill }) {
  return page.evaluate(async ([mods, full, inChat]) => {
    const [{ createNearbyScreen }, { renderCircleNearby }, { isAlphaTab }, loc, { nearbyHereChoose }] = await Promise.all(
      [mods.screen, mods.painter, mods.alpha, mods.loc, mods.menu].map((u) => import(u)));
    await loc.setLang('nl');
    const root = document.getElementById('circle-root');
    root.innerHTML = '';
    root.removeAttribute('data-nearby-tab');
    let clock = Date.now() - 10 * 60_000;
    const push = {};
    let report = null;
    const control = {
      set: (state) => { report = { requested: state, effective: state, degraded: false, shortfall: false, perTransport: [] }; return report; },
      report: () => report,
      subscribe: () => () => {},
    };
    const screen = createNearbyScreen({
      control,
      subscribeToPeers: (fn) => { push.peers = fn; return () => {}; },
      subscribeToAsks: (fn) => { push.ask = fn; return () => {}; },
      subscribeToInvites: (fn) => { push.invite = fn; return () => {}; },
      subscribeToChat: (fn) => { push.chat = fn; return () => {}; },
      askChannel: { broadcastKind: async () => ({ sent: 2, failed: 0, peers: 2 }) },
      allows: { card: false, chat: inChat },
      myRoomAddress: () => 'me-room-addr',
      levelChosen: () => true,
      now: () => clock,
      t: loc.t,
    });
    const draw = () => renderCircleNearby(root, {
      model: screen.model(), t: loc.t,
      onAskAction: (action, ask) => { if (action === 'dismiss-ask') screen.dismissAsk(ask?.id); },
      onToggleAllow: () => {},
      onSetQuiet: (v) => screen.setQuiet(v),
      onSetRadio: (v) => screen.setRadio(v),
      // the phone's shape: all three ways to be here, through the one shared rule (the level is already chosen here)
      onHereChoose: (c) => nearbyHereChoose(c, { level: 'handle', visibility: screen.visibility() },
        { setLevel: async () => ({ ok: true }), setQuiet: (q) => screen.setQuiet(q), setRadio: (r) => screen.setRadio(r) }),
    });
    screen.subscribe(() => draw());
    screen.open();
    if (full) {
      const ans = 'ansAAAA11111'; const bob = 'bobBBBB22222'; const dirk = 'dirkCCC33333';
      push.peers?.([{ pubKey: ans, displayName: 'Ans', skills: [] }, { pubKey: bob, displayName: 'Bob', skills: [] }, { pubKey: dirk, displayName: 'Dirk', skills: [] }]);
      push.chat({ id: 'm1', text: 'Goeiemorgen allemaal', from: ans, receivedAt: clock });
      clock += 60_000;
      push.ask({ id: 'ask-1', text: 'Heeft iemand een fietspomp?', tags: [], from: bob, createdAt: clock, expiresAt: clock + 30 * 60_000 });
      await new Promise((r) => setTimeout(r, 20));
      clock += 60_000;
      await screen.say('Ik ben er over tien minuten');
      clock += 60_000;
      push.invite({ uri: 'onderling-invite://example', circleId: 'c-tuin', circleName: 'Buurtmoestuin', expiresAt: clock + 20 * 60_000, from: dirk, receivedAt: clock });
      clock += 60_000;
      push.chat({ id: 'm3', text: 'Wie gaat er mee koffie halen?', from: ans, receivedAt: clock });
      await new Promise((r) => setTimeout(r, 20));
    }
    draw();
    window.__nearbyTest = { screen };
    return { webShowsNearbyTab: isAlphaTab('nearby') };
  }, [MODS, fill, chat]);
}

const tabLabel = (page, id) => page.locator(`.circle-nearby__tab--${id}`).innerText();
const sectionsOf = (page, tab) => page.locator(`.circle-nearby__panel--${tab} > [data-section]`).evaluateAll((els) => els.map((e) => e.dataset.section));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
});

test('Gesprek: one stream by arrival, cards for a question and a circle; Vragen counts what is new', async ({ page }, testInfo) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  const { webShowsNearbyTab } = await openNearby(page, { fill: true });
  expect(webShowsNearbyTab, 'the web paints no Nearby tab in the alpha — composed here as showNearby does').toBe(false);

  // in the chat: opens on Gesprek
  await expect(page.locator('.circle-nearby__panel--conversation')).toBeVisible();
  const kinds = await page.locator('[data-section="nearby-chat"] > .circle-nearby__chat-line, [data-section="nearby-chat"] > .circle-nearby__stream-card')
    .evaluateAll((els) => els.map((e) => e.dataset.streamKind ?? 'line'));
  expect(kinds).toEqual(['line', 'ask', 'line', 'invite', 'line']);
  await expect(page.locator('.circle-nearby__stream-card[data-stream-kind="ask"] .circle-nearby__stream-head')).toHaveText('Vraag van Bob');
  await expect(page.locator('.circle-nearby__stream-card[data-stream-kind="ask"] .circle-nearby__ask-clock')).toHaveText(/nog \d+ min/);
  await expect(page.locator('.circle-nearby__stream-card[data-stream-kind="invite"] .circle-nearby__stream-head')).toHaveText('Kring aangeboden door Dirk');
  // one name per person: the line names Ans as her row does
  await expect(page.locator('.circle-nearby__chat-line[data-message-id="m1"] .circle-nearby__chat-meta')).toContainText('Ans');
  // my own line says "you"; others' lines say who
  await expect(page.locator('.circle-nearby__chat-line[data-mine="true"] .circle-nearby__chat-meta')).toContainText('Jij');
  // Gesprek is open, so seen; Vragen holds the new question and the new circle
  expect(await tabLabel(page, 'conversation')).toBe('Gesprek');
  expect(await tabLabel(page, 'questions')).toBe('Vragen · 2');
  await page.screenshot({ path: testInfo.outputPath('gesprek.png'), fullPage: true });

  // Vragen: the question and the circle are there too; opening it marks it seen
  await page.locator('.circle-nearby__tab--questions').click();
  expect(await sectionsOf(page, 'questions')).toEqual(expect.arrayContaining(['nearby-ask-field', 'nearby-asks', 'nearby-invites']));
  await expect(page.locator('.circle-nearby__panel--questions .circle-nearby__ask[data-ask-id="ask-1"]')).toBeVisible();
  await expect(page.locator('.circle-nearby__panel--questions .circle-nearby__invite[data-circle-id="c-tuin"]')).toBeVisible();
  expect(await tabLabel(page, 'questions')).toBe('Vragen');
  await page.screenshot({ path: testInfo.outputPath('vragen.png'), fullPage: true });

  // Dismiss on the card in the stream is the same act as in Vragen: the question is gone from both
  await page.locator('.circle-nearby__tab--conversation').click();
  await page.locator('.circle-nearby__stream-card[data-stream-kind="ask"] [data-action="dismiss-ask"]').click();
  await expect(page.locator('.circle-nearby__stream-card[data-stream-kind="ask"]')).toHaveCount(0);
  await expect(page.locator('.circle-nearby__ask[data-ask-id="ask-1"]')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('hidden from the room ("even stil"): no stream and no field to talk in; one line, and becoming visible brings the stream back', async ({ page }, testInfo) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await openNearby(page, { fill: true });
  await expect(page.locator('[data-section="nearby-chat"]')).toBeVisible();
  // go quiet through the controller's own act, as the state line's switch does
  await page.evaluate(() => window.__nearbyTest.screen.setQuiet(true));
  await page.locator('.circle-nearby__tab--conversation').click();
  await expect(page.locator('.circle-nearby__visibility')).toHaveAttribute('data-visibility', 'hidden');
  await expect(page.locator('[data-section="nearby-chat"]')).toHaveCount(0);
  await expect(page.locator('.circle-nearby__chat-input')).toHaveCount(0);
  await expect(page.locator('.circle-nearby__chat-off-line')).toHaveText('Je bent verborgen. Word zichtbaar om mee te praten.');
  expect(await tabLabel(page, 'conversation'), 'nothing in a stream you cannot see counts as new').toBe('Gesprek');
  // the controller itself refuses: a line said while hidden goes to no one, and says why
  expect(await page.evaluate(() => window.__nearbyTest.screen.say('hoi').then((r) => ({ ok: r.ok, reason: r.reason, notice: r.notice }))))
    .toEqual({ ok: false, reason: 'hidden', notice: 'chat_hidden_line' });
  await page.screenshot({ path: testInfo.outputPath('verborgen.png'), fullPage: true });
  // Vragen while hidden: no composer to type a whole question into and then be refused; its own line, the same button
  await page.locator('.circle-nearby__tab--questions').click();
  await expect(page.locator('[data-section="nearby-ask-field"]')).toHaveCount(0);
  await expect(page.locator('.circle-nearby__ask-off-line')).toHaveText('Je bent verborgen. Word zichtbaar om iets te vragen.');
  await expect(page.locator('.circle-nearby__ask-visible')).toBeVisible();
  // the card and the circle are refused by the controller too, and nothing is said to be shown
  expect(await page.evaluate(() => window.__nearbyTest.screen.publishInvite({ uri: 'x', circleId: 'c1' }).then((r) => r.reason))).toBe('hidden');
  await page.screenshot({ path: testInfo.outputPath('verborgen-vragen.png'), fullPage: true });
  await page.locator('.circle-nearby__tab--conversation').click();
  await page.locator('.circle-nearby__chat-visible').click();
  await expect(page.locator('.circle-nearby__visibility')).toHaveAttribute('data-visibility', 'visible');
  await expect(page.locator('[data-section="nearby-chat"]')).toBeVisible();
  expect(errs).toEqual([]);
});

test('the empty room: no part says it is empty, the two tabs are still there', async ({ page }, testInfo) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await openNearby(page, { fill: false });
  await expect(page.locator('.circle-nearby__tab')).toHaveCount(2);
  expect(await tabLabel(page, 'conversation')).toBe('Gesprek');
  expect(await tabLabel(page, 'questions')).toBe('Vragen');
  // not in the chat: opens on Vragen, which holds only the ask field
  await expect(page.locator('.circle-nearby__panel--questions')).toBeVisible();
  expect(await sectionsOf(page, 'questions')).toEqual(['nearby-ask-field']);
  expect(await sectionsOf(page, 'conversation')).toEqual(['nearby-chat-off']);
  for (const gone of ['.circle-nearby__asks', '.circle-nearby__invites', '.circle-nearby__peers', '.circle-nearby__chat-empty']) {
    await expect(page.locator(gone), `${gone} is not painted in an empty room`).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('empty-room.png'), fullPage: true });
  expect(errs).toEqual([]);
});

test('the gear menu: the state line and the gear open it; Even stil hides you, Zichtbaar brings you back', async ({ page }, testInfo) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.setViewportSize({ width: 390, height: 844 });
  await openNearby(page, { fill: true });
  const menu = page.locator('.circle-nearby__menu');
  await expect(menu).toBeHidden();
  await expect(page.locator('.circle-nearby__mine'), 'nothing about you stands on the page').toHaveCount(0);
  await page.locator('.circle-nearby__gear').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.circle-nearby__menu-title')).toHaveText('In de buurt instellen');
  await expect(menu.locator('.circle-nearby__here-label')).toHaveText(['Zichtbaar', 'Even stil', 'Helemaal uit']);
  await expect(menu.locator('.circle-nearby__allow-off--chat'), 'out of the chat: what that means').toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('menu.png'), fullPage: true });
  await menu.locator('.circle-nearby__here--quiet').click();
  await expect(page.locator('.circle-nearby__visibility')).toHaveAttribute('data-visibility', 'hidden');
  // the state line opens the same menu, with the choice that holds now
  await menu.locator('.circle-nearby__menu-close').click();
  await expect(menu).toBeHidden();
  await page.locator('.circle-nearby__visibility-title').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.circle-nearby__here--quiet input')).toBeChecked();
  await menu.locator('.circle-nearby__menu-row--card').click();
  await expect(menu.locator('[data-menu-view="card"] input[data-allow="card"]'), 'the card switch, in the card editor').toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('menu-card.png'), fullPage: true });
  await menu.locator('[data-menu-view="card"] .circle-nearby__menu-back').click();
  await menu.locator('.circle-nearby__here--visible').click();
  await expect(page.locator('.circle-nearby__visibility')).toHaveAttribute('data-visibility', 'visible');
  expect(errs).toEqual([]);
});
