/**
 * NEARBY THE FIRST TIME, IN A REAL BROWSER: the three-step wizard (visible and as whom; the card and the offer; the
 * conversation), each press through the shared rule (`nearbyWizardPress`) and the real controller, the way `showNearby`
 * wires it. Checked: "Ja, als …" makes the person visible, a card saved in step 2 turns the card switch on and goes out
 * with the offer chips still listed, step 3's switch turns the chat on, and after "Klaar" the page is the two tabs.
 * "Alleen kijken" writes nothing and leaves the person hidden.
 *
 * How it reaches the screen: as nearby-tabs.spec.js (the web paints no Nearby tab in the alpha): the real app boots, then
 * the real controller and painter are composed in its root, in Dutch.
 *
 * Screenshots at phone width (390 px): wizard-1.png, wizard-2.png, wizard-3.png, after-wizard.png.
 *
 *   PEER_TEST_PORT=5274 npx playwright test --project=no-relay test-browser/nearby-wizard.spec.js
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test.setTimeout(120_000);
const here = path.dirname(fileURLToPath(import.meta.url));
const fsUrl = (rel) => `/@fs${path.resolve(here, rel)}`;
const MODS = {
  screen: fsUrl('../src/v2/nearbyScreen.js'),
  painter: fsUrl('../web/v2/circleNearby.js'),
  loc: fsUrl('../src/localisation.js'),
  wizard: fsUrl('../src/v2/nearbyWizard.js'),
};
const ready = async (page) => {
  await expect.poll(() => page.evaluate(() => typeof window.onderlingCall === 'function'), { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 30_000 });
};

/** Compose Nearby with the wizard open on a self with no level yet; `window.__wiz` holds what went out and what was set. */
async function openWizard(page) {
  return page.evaluate(async (mods) => {
    const [{ createNearbyScreen }, { renderCircleNearby }, loc, { nearbyWizardPress }] = await Promise.all(
      [mods.screen, mods.painter, mods.loc, mods.wizard].map((u) => import(u)));
    await loc.setLang('nl');
    const root = document.getElementById('circle-root');
    root.innerHTML = '';
    let report = null;
    const control = {
      set: (state) => { report = { requested: state, effective: state, degraded: false, shortfall: false, perTransport: [] }; return report; },
      report: () => report,
      subscribe: () => () => {},
    };
    const out = { sent: [], level: 'none', levelSet: false, asked: false };
    const screen = createNearbyScreen({
      control,
      subscribeToPeers: () => () => {},
      subscribeToChat: () => () => {},
      askChannel: { broadcastKind: async (kind, body) => { out.sent.push({ kind, body }); return { sent: 1, failed: 0, peers: 1 }; } },
      allows: { card: false, chat: false },
      myRoomAddress: () => 'me-room-addr',
      roomLevel: async () => out.level,
      levelChosen: () => out.levelSet,
      mySkills: () => ['koken', 'fietsen repareren'],
      t: loc.t,
    });
    let wizard = { step: 1 };
    const roomSelf = { view: { ask: false, self: { id: 'default', name: 'Frits' }, choices: [] } };
    const press = async (p, input) => {
      const r = await nearbyWizardPress(wizard, p, input, {
        now: { level: out.level, visibility: screen.visibility() },
        setLevel: async (l) => { out.level = l; out.levelSet = true; screen.levelChanged(); return { ok: true }; },
        setQuiet: (q) => screen.setQuiet(q),
        setRadio: (v) => screen.setRadio(v),
        markAsked: () => { out.asked = true; },
        setAllow: (k, v) => screen.setAllow(k, v),
        showCard: (fields) => screen.showCard(fields),
      });
      wizard = r.done ? null : { step: r.step, notice: r.notice ?? null };
      draw();
    };
    const draw = () => renderCircleNearby(root, {
      model: { ...screen.model(), ownProfile: { publishedSkills: ['koken', 'fietsen repareren'] } }, t: loc.t, roomSelf,
      wizard: wizard ? { ...wizard, onPress: press } : null,
      onToggleAllow: () => {}, onSetQuiet: (v) => screen.setQuiet(v), onSetRadio: (v) => screen.setRadio(v),
    });
    screen.subscribe(() => draw());
    screen.open();
    draw();
    window.__wiz = { out, screen };
  }, MODS);
}
const state = (page) => page.evaluate(() => ({ ...window.__wiz.out, allows: window.__wiz.screen.allows(), vis: window.__wiz.screen.visibility() }));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await ready(page);
});

test('the three steps: visible as yourself, a card with the offers left on it, the chat on; then the tabs', async ({ page }, testInfo) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await openWizard(page);
  const wz = page.locator('.circle-nearby__wizard');
  await expect(wz.locator('.circle-nearby__wizard-head')).toHaveText('In de buurt · stap 1 van 3');
  await expect(wz.locator('.circle-nearby__wizard-title')).toHaveText('Wil je hier zichtbaar zijn?');
  await expect(wz.locator('.circle-nearby__wizard-self')).toHaveText('Frits · jijzelf');
  await expect(page.locator('.circle-nearby__gear')).toBeHidden();
  await expect(page.locator('.circle-nearby__tabs'), 'while open the wizard is the page').toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wizard-1.png'), fullPage: true });
  await wz.locator('[data-press="yes"]').click();
  await expect(wz.locator('.circle-nearby__wizard-head')).toHaveText('In de buurt · stap 2 van 3');
  let s = await state(page);
  expect(s.level, 'the floor, as the menu\'s Zichtbaar').toBe('handle');
  expect(s.asked).toBe(true);
  expect(s.vis.requested).toBe('browse+publish');

  await wz.locator('.circle-nearby__wizard-field--name input').fill('Frits');
  await wz.locator('.circle-nearby__wizard-field--line input').fill('ik woon op nummer 8');
  await wz.locator('.circle-nearby__offers input').check();
  await wz.locator('.circle-nearby__offer-chip', { hasText: 'koken' }).click();
  await expect(wz.locator('.circle-nearby__offer-chip')).toHaveText(['fietsen repareren']);
  await page.screenshot({ path: testInfo.outputPath('wizard-2.png'), fullPage: true });
  await wz.locator('[data-press="next"]').click();
  await expect(wz.locator('.circle-nearby__wizard-head')).toHaveText('In de buurt · stap 3 van 3');
  s = await state(page);
  expect(s.allows.card).toBe(true);
  const card = s.sent.find((m) => m.body?.card)?.body.card;
  expect(card).toMatchObject({ label: 'Frits', line: 'ik woon op nummer 8', tags: ['fietsen repareren'] });

  await expect(wz.locator('.circle-nearby__wizard-box')).toHaveText('Hier wordt niets bewaard. Wie weggaat, is het gesprek kwijt.');
  await wz.locator('.circle-nearby__wizard-chat input').check();
  await page.screenshot({ path: testInfo.outputPath('wizard-3.png'), fullPage: true });
  await wz.locator('[data-press="done"]').click();
  await expect(page.locator('.circle-nearby__wizard')).toHaveCount(0);
  await expect(page.locator('.circle-nearby__tab')).toHaveCount(2);
  await expect(page.locator('.circle-nearby__gear')).toBeVisible();
  expect((await state(page)).allows.chat).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('after-wizard.png'), fullPage: true });
  expect(errs).toEqual([]);
});

test('"Alleen kijken" writes no level, no card, no chat: the person stays hidden and the wizard ends', async ({ page }) => {
  await openWizard(page);
  await page.locator('.circle-nearby__wizard [data-press="look"]').click();
  await expect(page.locator('.circle-nearby__wizard')).toHaveCount(0);
  const s = await state(page);
  expect(s).toMatchObject({ level: 'none', levelSet: false, asked: true, sent: [] });
  expect(s.allows).toEqual({ card: false, chat: false });
  await expect(page.locator('.circle-nearby__visibility')).toHaveAttribute('data-visibility', /hidden|not_chosen/);
});
