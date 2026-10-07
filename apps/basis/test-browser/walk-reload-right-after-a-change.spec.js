/**
 * A CHANGE MADE A MOMENT BEFORE A RELOAD IS STILL THERE (2026-10-07). The stores save behind a short debounce; a
 * reload inside it used to lose the change — add an appointment, close the tab at once, and it was gone. The page now
 * writes what is waiting when it leaves (pagehide). No pause here on purpose: the reload follows the add directly.
 *
 *   PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-reload-right-after-a-change.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, gotoCircles, log } from './peerHarness.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('an appointment added right before a reload survives it', async ({ browser }) => {
  test.setTimeout(180_000);
  let A = null;
  try {
    A = await bootPeer(browser, 'A');
    await gotoCircles(A.page);
    // The app publishes its call door once it has booted. When it never does, say on WHICH side of the reload and what
    // the page reported: a blank page after `net::ERR_NETWORK_CHANGED` is this machine's network moving under the
    // browser (its modules never loaded — a container restarting in a loop does it), not the app.
    const errors = new Set();
    A.page.on('console', (m) => { if (m.type() === 'error') errors.add(m.text().slice(0, 160)); });
    A.page.on('pageerror', (e) => errors.add(`pageerror: ${e.message.slice(0, 160)}`));
    const callable = async (step) => {
      try { await A.page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 30_000 }); }
      catch { throw new Error(`${step}: the app never published onderlingCall — the page said: ${[...errors].slice(0, 3).join(' | ') || 'nothing'} · first boot ${JSON.stringify(A.boot)}`); }
    };
    await callable('before the add');
    const when = await A.page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(9, 30, 0, 0); return d.toISOString(); });
    const made = await A.page.evaluate(async (w) => window.onderlingCall('calendar', 'addEvent', { title: 'huisarts', when: w }), when);
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    log('STEP1 add', 'PASS', 'my own appointment, no circle');

    await A.page.reload();   // at once — inside the store's save delay
    await gotoCircles(A.page);
    await callable('after the reload');
    const titles = await A.page.evaluate(async () => {
      const r = await window.onderlingCall('calendar', 'listEvents', { days: 7 });
      const rows = r?.events ?? r?.items ?? r?.data ?? (Array.isArray(r) ? r : []);
      return { ok: r?.ok, titles: rows.map((e) => e.title ?? e.text ?? '') };
    });
    expect(titles.titles, `still there after an immediate reload: ${JSON.stringify(titles)}`).toContain('huisarts');
    log('STEP2 reload', 'PASS', 'the waiting save was made on the way out');
  } finally {
    await teardown([A].filter(Boolean));
  }
});
