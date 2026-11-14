/**
 * The pod walks' shared moves (the circle-types walk and the pod-sync walk): a sign-in into the local pod through the
 * app's own redirect flow, a circle made in the create wizard with its storage radio set, and a count of what a pod
 * holds read through the signed-in session.
 */
import { expect } from '@playwright/test';
import { gotoCircles } from './peerHarness.js';
import { fillFounderHandle } from './helpers.js';

export const PW = 'pw-123456';
export const call = (page, app, opId, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
export const myCircles = async (page) => ((await call(page, 'pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);

/** Sign the page into the local pod through the app's own sign-in (the redirect flow a person takes). */
export async function signIn(page, issuer, email) {
  await page.evaluate((iss) => { window.onderlingPodSignIn(iss); }, issuer);
  await page.waitForURL((u) => u.href.startsWith(issuer), { timeout: 30_000 });
  const login = page.locator('#email');
  if (!(await login.isVisible().catch(() => false))) {
    // the account page first: take the password login
    const pw = page.locator('a[href*="login/password"]');
    if (await pw.count()) await pw.first().click();
  }
  await login.waitFor({ timeout: 20_000 });
  await login.fill(email);
  await page.locator('#password').fill(PW);
  await page.locator('button[type="submit"][name="submit"]').click();
  const authorize = page.locator('#authorize');
  await authorize.waitFor({ timeout: 30_000 });
  await expect(authorize).toBeEnabled({ timeout: 15_000 });
  await authorize.click();
  await page.waitForURL((u) => !u.href.startsWith(issuer), { timeout: 60_000 });
  const webid = await expect.poll(() => page.evaluate(() => window.onderlingPodSession?.webid ?? null),
    { timeout: 90_000, intervals: [1000], message: `the app never held a pod session for ${email}` }).toBeTruthy();
  return webid;
}

/** Every resource under a container, through the founder's own authenticated fetch (ld+json listing). */
export async function podResourceCount(page, root) {
  return page.evaluate(async (start) => {
    const f = window.onderlingPodSession?.fetch;
    if (typeof f !== 'function') return -1;
    const seen = new Set(); const queue = [start];
    while (queue.length && seen.size < 400) {
      const uri = queue.shift();
      if (seen.has(uri)) continue;
      seen.add(uri);
      if (!uri.endsWith('/')) continue;
      try {
        const r = await f(uri, { headers: { accept: 'application/ld+json' } });
        if (!r.ok) continue;
        const doc = await r.json();
        const nodes = Array.isArray(doc) ? doc : (doc['@graph'] ?? [doc]);
        for (const n of nodes) {
          for (const c of [].concat(n['http://www.w3.org/ns/ldp#contains'] ?? n.contains ?? n['ldp:contains'] ?? [])) {
            const id = typeof c === 'string' ? c : c?.['@id'];
            if (id) queue.push(new URL(id, uri).href);
          }
        }
      } catch { /* an unreadable container counts as itself */ }
    }
    return seen.size;
  }, root);
}

/** The create wizard, with the storage radio set; returns the new circle's id. */
export async function createWithStorage(page, name, { storage, podUri = null, handle = 'anna', offered = null }) {
  const before = new Set(await myCircles(page));
  await gotoCircles(page);
  await page.locator('.circle-launcher__new').click();
  await page.locator('.cc-wizard-input:visible').first().waitFor({ timeout: 15_000 });
  await page.locator('.cc-wizard-input:visible').nth(0).fill(name);
  await fillFounderHandle(page, handle);
  // the kind, asked on the first step (never assumed)
  await page.locator('input[type="radio"][value="household"]:visible').first().check();
  // the storage choice lives behind the first step's "advanced" fold; opened, the wizard walks every step
  await page.locator('details[data-role="advanced"] > summary').first().click();
  await page.waitForTimeout(500);
  let picked = false;
  for (let step = 0; step < 12; step += 1) {
    if (Array.isArray(offered)) {
      for (const v of await page.locator('input[type="radio"]:visible').evaluateAll((els) => els.map((e) => e.value))) {
        if (['none', 'personal', 'shared', 'hybrid'].includes(v) && !offered.includes(v)) offered.push(v);
      }
    }
    const radio = page.locator(`input[type="radio"][value="${storage}"]:visible`);
    if (!picked && await radio.count()) {
      await radio.first().click({ force: true });
      picked = true;
      await page.waitForTimeout(800);
      expect(await radio.first().isChecked(), `the storage radio "${storage}" did not take the click`).toBe(true);
      if (podUri) {
        const field = page.locator('.cc-wizard-field').filter({ hasText: /pod address|pod-adres/i }).locator('input');
        await field.first().waitFor({ timeout: 10_000 });
        await field.first().fill(podUri);
      }
    }
    const advance = page.locator('.cc-wizard-btn:visible').filter({ hasText: /next|review|create|volgende|overzicht|controle|maken/i });
    if (await advance.count() === 0) break;
    const label = (await advance.first().textContent() ?? '').trim();
    await advance.first().click();
    await page.waitForTimeout(1200);
    if (/create|maken/i.test(label)) break;
  }
  expect(picked, `the wizard never offered the storage choice "${storage}"`).toBe(true);
  const done = page.locator('button:visible').filter({ hasText: /^(done|klaar)$/i });
  await done.first().waitFor({ timeout: 30_000 }).catch(() => {});
  if (await done.count()) await done.first().click();
  const id = await expect.poll(async () => (await myCircles(page)).find((c) => !before.has(c)) ?? null,
    { timeout: 30_000, intervals: [1000], message: 'the wizard made no circle' }).not.toBeNull().then(async () => (await myCircles(page)).find((c) => !before.has(c)));
  return id;
}
