/**
 * walk-sweep.spec.js — breadth rather than depth.
 *
 * Frits, 2026-08-28: *"I prefer to continue finding new issues, so we can fix a lot in one run."* The
 * story walks go deep on one flow; this goes wide: open every destination a circle offers and report
 * what a person finds there. A surface that is empty, errors, or shows an identifier where a name
 * belongs is a finding — and the cheapest ones to collect in bulk.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, log, gotoCircles, createCircle,
  openCircleMatching, joinFromInvite, dismissAnyModal } from './peerHarness.js';

test.setTimeout(420_000);

const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;

test('sweep — every destination a circle offers, and what a person finds there', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Sweep Kring', re: /sweep.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);

    const errors = [];
    A.page.on('pageerror', (e) => errors.push(String(e?.message ?? e).slice(0, 120)));

    // 1 · every TAB the circle shows
    const tabs = await A.page.evaluate(() => [...document.querySelectorAll('.circle-view__tab')].map((e) => e.dataset.tab));
    log('sweep · tabs offered', 'OBSERVED', JSON.stringify(tabs));
    const tabReport = [];
    for (const id of tabs) {
      const t = A.page.locator(`.circle-view__tab[data-tab="${id}"]`);
      if (!(await t.count())) continue;
      await t.first().click();
      await A.page.waitForTimeout(2200);
      const body = (await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 200);
      const empty = /nog niets|niets om te tonen|geen |nothing yet/i.test(body);
      const rawId = body.includes(gid);
      tabReport.push(`${id}${empty ? ' EMPTY' : ''}${rawId ? ' SHOWS-RAW-ID' : ''}`);
    }
    log('sweep · what each tab shows', 'OBSERVED', tabReport.join(' · '));

    // 2 · every ⋯ destination
    const s = await surface(A.page);
    const nav = (s?.nav ?? []).map((n) => n.id);
    log('sweep · ⋯ destinations offered', 'OBSERVED', JSON.stringify(nav));
    const navReport = [];
    // Each destination is walked INDEPENDENTLY: a screen with no way back, or a modal that swallows the
    // next click, must cost one entry and not the whole sweep. A sweep that dies on its third stop
    // reports two findings and hides ten.
    for (const id of nav) {
      if (id === 'back') continue;
      let verdict = 'ok';
      try {
        // A FULL RELOAD between destinations. Escape + dismissAnyModal + gotoCircles was not enough:
        // after `settings` the circle view never came back and every remaining destination reported
        // NO-MENU — ten findings that were all one broken loop. Reloading costs ~10s each and makes
        // every entry independent, which is the only property that matters in a sweep.
        await A.page.goto('/');
        await A.page.waitForTimeout(7000);
        await gotoCircles(A.page).catch(() => {});
        await openCircleMatching(A.page, new RegExp(`sweep.?kring|${gid}`, 'i')).catch(() => {});
        const more = A.page.locator('.circle-view__more');
        if (!(await more.count())) { navReport.push(`${id}:NO-MENU`); continue; }
        await more.first().click({ timeout: 6000 });
        await A.page.waitForTimeout(500);
        const item = A.page.locator(`.circle-view__more-item[data-action="${id}"]`);
        if (!(await item.count())) { navReport.push(`${id}:MISSING`); continue; }
        await item.first().click({ timeout: 6000 });
        await A.page.waitForTimeout(2500);
        const body = (await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 300);
        if (/kon daar geen actie|couldn|\[object|undefined/i.test(body)) verdict = 'BROKEN';
        else if (/nog niets|niets om te tonen|nothing yet/i.test(body)) verdict = 'EMPTY';
        else if (body.includes(gid)) verdict = 'SHOWS-RAW-ID';
      } catch (err) {
        verdict = `UNREACHABLE(${String(err?.message ?? err).slice(0, 28)})`;
      }
      navReport.push(`${id}:${verdict}`);
    }
    log('sweep · what each ⋯ destination gives you', 'OBSERVED', navReport.join(' · '));
    const bad = navReport.filter((r) => /BROKEN|MISSING|NO-MENU|UNREACHABLE/.test(r));
    log('sweep · destinations that do not work', bad.length ? 'FINDING' : 'PASS', bad.join(' · ') || 'all reachable');

    log('sweep · uncaught page errors while walking', errors.length ? 'FINDING' : 'PASS',
      JSON.stringify([...new Set(errors)].slice(0, 5)));
  } finally { await teardown(peers); }
});

test('corpus 2.3 / 2.4 — the same person in two circles, by choice', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const [A, Bram, Cato] = peers;
  try {
    // Two circles with DIFFERENT admins, so nothing is shared but Cato.
    await gotoCircles(A.page);
    const pX = await pair(A, Cato, { name: 'Kring X', re: /kring.?x/i, handle: 'cato' });
    test.skip(!pX.joined, 'X pairing failed');
    const gx = await activeCircle(A.page);

    await gotoCircles(Bram.page);
    await createCircle(Bram.page, 'Kring Y');
    await openCircleMatching(Bram.page, /kring.?y/i);
    const gy = await activeCircle(Bram.page);
    const inviteY = await Bram.page.evaluate(async () => {
      const more = document.querySelector('.circle-view__more'); if (more) more.click();
      await new Promise((r) => setTimeout(r, 800));
      const item = document.querySelector('.circle-view__more-item[data-action="invite"]'); if (item) item.click();
      await new Promise((r) => setTimeout(r, 3000));
      const code = document.querySelector('.cc-mydata-modal code, .cc-mydata-modal__card code');
      const uri = code ? code.textContent.trim() : null;
      document.body.click();
      return uri;
    });
    test.skip(!inviteY, 'no invite for Y');

    await gotoCircles(Cato.page);
    const joinedY = await joinFromInvite(Cato.page, inviteY, { handle: 'cato', tag: 'c23' });
    log('corpus 2.3 · Cato joins a second circle', joinedY?.joined ? 'PASS' : 'BLOCKED', JSON.stringify(joinedY));
    test.skip(!joinedY?.joined, 'Y join failed');

    // THE QUESTION: can the admin of Y learn anything about X — or that Cato is the same person?
    const catoWebid = (await call(Cato.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const inX = ((await call(A.page, 'stoop', 'listGroupMembers', { groupId: gx }))?.members ?? [])
      .find((m) => m.webid === catoWebid);
    const inY = ((await call(Bram.page, 'stoop', 'listGroupMembers', { groupId: gy }))?.members ?? [])
      .find((m) => m.webid === catoWebid);
    log('corpus 2.3 · is Cato the same WEBID in both circles?', (inX && inY) ? 'OBSERVED' : 'OBSERVED',
      `X:${inX ? 'same webid' : 'different/absent'} · Y:${inY ? 'same webid' : 'different/absent'}`);

    const addrX = inX?.circleAddress ?? null;
    const addrY = inY?.circleAddress ?? null;
    log('corpus 2.4 · are the per-circle ADDRESSES different?',
      addrX && addrY && addrX !== addrY ? 'PASS' : 'FINDING',
      `X=${String(addrX).slice(0, 12)} Y=${String(addrY).slice(0, 12)}`);

    // Can Y's admin see circle X at all?
    const yAdminSeesX = await call(Bram.page, 'stoop', 'listGroupRoster', { groupId: gx });
    log('corpus 2.3 · can Y\'s admin read X\'s roster?',
      (yAdminSeesX?.members ?? []).length === 0 ? 'PASS' : 'FINDING',
      JSON.stringify(yAdminSeesX)?.slice(0, 140));

    const yAdminCircles = await call(Bram.page, 'stoop', 'listMyCircles', {});
    log('corpus 2.3 · does Y\'s admin know X exists?',
      (yAdminCircles?.circles ?? []).includes(gx) ? 'FINDING' : 'PASS',
      JSON.stringify(yAdminCircles?.circles));
  } finally { await teardown(peers); }
});
