// The second person of a walk, as a child process (e2e/support/relayPeer.mjs), and the phone's join of their circle.
//
// One copy for every walk that has a real other person: start it, wait for its invite, tell it to speak, wait for what
// it hears. The relayPeer prints one JSON line per step; the agent's own logging shares stdout and is skipped.
/* global device, element, by */
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { isVisible, soon, tapSoon, firstOf } = require('./ui');

/**
 * Start the second person and wait for its invite.
 * @param {string[]} args  relayPeer's arguments (`--circle`, `--offering`, `--talk`, …)
 * @returns {Promise<{ready: object, send: (cmd: object) => void, next: (step: string, pred?: function, ms?: number) => Promise<object>, stop: () => void}>}
 */
function startPeer(args) {
  const child = spawn(process.execPath, [path.join(__dirname, 'relayPeer.mjs'), ...args],
    { cwd: path.join(__dirname, '..', '..'), stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];        // every step line so far, so a wait never misses one that came early
  const waiters = new Set();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg = null;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg?.step) return;
    lines.push(msg);
    for (const w of [...waiters]) w(msg);
  });
  let consumed = 0;   // `next` hands out each line once, in order
  const next = (step, pred = () => true, ms = 60_000) => new Promise((resolve, reject) => {
    const take = () => {
      for (let i = consumed; i < lines.length; i += 1) {
        if (lines[i].step === step && pred(lines[i])) { consumed = i + 1; return lines[i]; }
      }
      return null;
    };
    const hit = take();
    if (hit) { resolve(hit); return; }
    const timer = setTimeout(() => { waiters.delete(w); reject(new Error(`relayPeer: no "${step}" within ${ms} ms; seen: ${JSON.stringify(lines.slice(-5))}`)); }, ms);
    const w = () => { const h = take(); if (h) { clearTimeout(timer); waiters.delete(w); resolve(h); } };
    waiters.add(w);
  });
  const ready = new Promise((resolve, reject) => {
    child.on('exit', (code) => reject(new Error(`relayPeer exited (${code})`)));
    next('error', () => true, 120_000).then((m) => reject(new Error(`relayPeer: ${m.error}`)), () => {});
    next('ready', () => true, 120_000).then(resolve, reject);
  });
  return ready.then((r) => ({
    ready: r,
    send: (cmd) => { child.stdin.write(`${JSON.stringify(cmd)}\n`); },
    next,
    stop: () => { try { child.stdin.end(); child.kill('SIGTERM'); } catch { /* already gone */ } },
  }));
}

/**
 * The phone opens the peer's invite as a link and joins through the real wizard, then sees the circle's tile.
 * The wizard SLIDES in: a tap mid-slide lands nowhere and the box stays unticked (screenshot 2026-10-22). Settle,
 * tick, press Next — and tick again only while the next step has not come (a tick that took would be undone).
 */
async function joinByInvite({ invite, circleId, handle = 'anna', shot = null, atWhoJoins = null }) {
  await device.openURL({ url: invite });
  const step = async (box, nextId) => {
    await soon(by.id(box), 60_000);
    for (let i = 0; i < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      await element(by.id(box)).tap();
      await tapSoon(by.id('join-next'));
      if (await firstOf([by.id(nextId)], 6_000) === 0) return;
    }
    throw new Error(`the join wizard did not move past ${box}`);
  };
  await step('join-rules-accept', 'join-privacy-accept');
  await step('join-privacy-accept', 'wizard-handle');
  // the wizard's third step says who joins: a walk may change that (a new persona) instead of typing a name
  if (atWhoJoins) await atWhoJoins();
  else if (await isVisible(by.id('wizard-handle'))) await element(by.id('wizard-handle')).replaceText(handle);
  if (shot) await device.takeScreenshot(shot);
  await tapSoon(by.id('join-submit'));
  await tapSoon(by.id('circle-tab-circles'), 60_000);
  await soon(by.id(`circle-tile-${circleId}`), 90_000);
}

module.exports = { startPeer, joinByInvite };
