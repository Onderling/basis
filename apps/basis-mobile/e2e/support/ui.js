/* global device, element, by, expect */
// The phone walks' shared moves: launch, poll for a screen, tap through the moment one RN modal closes as the next
// opens, and the first boot of a fresh install. One copy, so a fix to a flake lands in every walk.

async function launch({ fresh = false } = {}) {
  // The app's network timers never let RN idle; launch with synchronization off (see circleDefault.test.js).
  await device.launchApp({ newInstance: true, delete: !!fresh, launchArgs: { detoxEnableSynchronization: 0 } });
  await device.disableSynchronization();
}

async function isVisible(matcher) {
  try { await expect(element(matcher)).toBeVisible(); return true; } catch { return false; }
}

/** Poll until visible — survives the moment one RN modal closes as the next opens (no window focus, Detox throws). */
async function soon(matcher, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await isVisible(matcher)) return; await new Promise((r) => setTimeout(r, 400)); }
  // what the screen showed instead — a timeout without a picture sends the next reader guessing
  try { await device.takeScreenshot(`not-visible-${Date.now()}`); } catch { /* the device may be gone */ }
  throw new Error(`not visible within ${ms} ms: ${JSON.stringify(matcher)}`);
}

/** Tap once it is visible, retrying through the same moment without focus. */
async function tapSoon(matcher, ms = 30_000) {
  await soon(matcher, ms);
  for (let i = 0; i < 6; i += 1) {
    try { await element(matcher).tap(); return; } catch (err) { if (i === 5) throw err; await new Promise((r) => setTimeout(r, 500)); }
  }
}

/** Wait for the first of several matchers; returns its index (-1 when none showed). */
async function firstOf(matchers, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (let i = 0; i < matchers.length; i += 1) if (await isVisible(matchers[i])) return i;
    await new Promise((r) => setTimeout(r, 300));
  }
  return -1;
}

/** A fresh install's first minutes: the welcome, then the recovery words once (a throwaway identity), until the
 *  launcher shows its help circle. The words do not always come first, so they are confirmed whenever they appear. */
async function firstBoot({ ms = 180_000 } = {}) {
  await soon(by.id('first-run-welcome'), 90_000);
  await element(by.id('first-run-start')).tap();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await isVisible(by.id('mnemonic-create'))) await element(by.id('mnemonic-create-written')).tap();
    if (await isVisible(by.id('circle-tile-cc-help')) || await isVisible(by.id('vandaag-day'))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`first boot: no launcher within ${ms} ms`);
}

/** Back out to the launcher (its tab bar showing), so a test starts where the last one should have left the app —
 *  a failed test can leave it in a thread. Bounded, and only while the tab bar is gone, so it never leaves the app. */
async function backToLauncher(tries = 4) {
  for (let i = 0; i < tries && !(await isVisible(by.id('circle-tab-circles'))); i += 1) {
    await device.pressBack();
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/** A walk that deletes the app must never run on a person's phone. */
function emulatorOnly(name) {
  if (!String(device.id ?? '').startsWith('emulator-')) {
    throw new Error(`${name} refuses to run on ${device.id}: it deletes the app — emulator only`);
  }
}

module.exports = { launch, isVisible, soon, tapSoon, firstOf, firstBoot, backToLauncher, emulatorOnly };
