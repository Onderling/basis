/**
 * relayFixture.js — Playwright globalSetup/globalTeardown that brings up a local
 * @onderling/relay for the `relay` project (a hermetic WebSocket transport, so the
 * matrix's relay cells don't depend on public NKN reaching the sandbox network).
 *
 * ARMING: only starts a relay when `PEER_TEST_RELAY` is set (a ws://host:port URL) —
 * so DEFAULT runs (and the `nkn` project) are unchanged and never leak a process.
 *   PEER_TEST_RELAY=ws://127.0.0.1:8787 npx playwright test --project=relay
 * The harness (peerHarness.js) reads the SAME `PEER_TEST_RELAY` (inherited by the
 * worker processes from the CLI env) and seeds it into each relay/both-mode client
 * (localStorage `cc.relayUrl` + the `?relay=` boot param). globalTeardown kills it.
 *
 * If the port is ALREADY listening (a relay you started by hand, or a reused one),
 * globalSetup attaches to it instead of spawning — and teardown leaves it alone.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY_BIN = path.resolve(HERE, '../../../packages/relay/bin/relay.js');
const PID_FILE = path.join(HERE, '.relay-fixture.pid');
const PID_FILE_2 = path.join(HERE, '.relay-fixture-2.pid');

// The default port follows the scheme — a `wss://` relay behind a reverse proxy answers on 443, not on
// the relay's own 8787. Getting this wrong made a run against a PUBLIC relay try to start a relay on the
// public hostname, fail, and then silently degrade every relay cell (2026-09-07).
function parseHostPort(url) {
  try {
    const u = new URL(url);
    const secure = u.protocol === 'wss:' || u.protocol === 'https:';
    return { host: u.hostname || '127.0.0.1', port: Number(u.port || (secure ? 443 : 8787)), secure };
  } catch { return { host: '127.0.0.1', port: 8787, secure: false }; }
}

/** Only a relay on THIS machine is ours to start; anything else belongs to someone else. */
const isLocal = (host) => host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';

function portOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => { try { sock.destroy(); } catch { /* */ } resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function waitForPort(host, port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(host, port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export default async function globalSetup(config) {
  // A second relay (PEER_TEST_RELAY_2) arms the two-relay stories: a device on its own relay joining a
  // circle that rides another. Same rules: attach if listening, spawn only on this machine (2026-09-08).
  await startOne(process.env.PEER_TEST_RELAY, PID_FILE);
  await startOne(process.env.PEER_TEST_RELAY_2, PID_FILE_2);
  await warmAndCheckEveryServer(config);
}

/**
 * Warm each project's dev server and prove it is serving THIS tree — once, here, before any test.
 *
 * Playwright starts the web servers before globalSetup, so this is the first moment they exist. Two
 * things happen per server, for two reasons found on 2026-09-10/11:
 *
 * WARM. A dev server's readiness check only says the port answers. The first real page load then makes
 * vite compile the whole module graph, which for this app takes long enough to blow the first test's
 * action timeout — so the first test in every cold run (every CI run) failed on a click that had nothing
 * to do with it. Loading the app once here pays that cost where it belongs, outside any test's budget.
 *
 * CHECK. The freshness guard was called only from `peerHarness.js`, so the nine single-context specs never
 * checked that the server they hit was serving the working tree — and a stale vite is how a whole day
 * went into a defect that was not there. Checking once per server covers every spec of both projects.
 * (`peerHarness` still checks per boot; that catches a server going stale MID-run, which this cannot.)
 */
async function warmAndCheckEveryServer(config) {
  const bases = [...new Set((config?.projects ?? []).map((p) => p?.use?.baseURL).filter(Boolean))];
  if (!bases.length) return;
  const { chromium } = await import('@playwright/test');
  const { assertDevServerIsFresh } = await import('./devServerFreshness.js');
  const browser = await chromium.launch();
  try {
    for (const base of bases) {
      const t0 = Date.now();
      // Two attempts, not one. Vite's first compile of the whole module graph on a cold runner is the
      // slowest thing in the suite, and one shard lost a whole run to it on 2026-09-13 (180 s, no test
      // ever started). A second page load after the first timeout hits a server that has finished
      // compiling; only two failures in a row say the server is really not coming up.
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const page = await browser.newPage();
        try {
          await page.goto(base, { waitUntil: 'load', timeout: 180_000 });
          // The app is up when its root has painted something — the same signal every spec waits for.
          await page.waitForSelector('#circle-root :first-child', { timeout: 180_000 });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[dev-server] ${base} not warm after attempt ${attempt} (${Math.round((Date.now() - t0) / 1000)}s): ${err?.message?.split('\n')[0] ?? err}`);
        } finally { await page.close(); }
      }
      if (lastErr) throw lastErr;
      await assertDevServerIsFresh(base);
      console.log(`[dev-server] ${base} warm and serving this tree (${Math.round((Date.now() - t0) / 1000)}s).`);
    }
  } finally { await browser.close(); }
}

async function startOne(url, pidFile) {
  if (!url) return;   // not armed — default/nkn runs stay exactly as they were.
  const { host, port } = parseHostPort(url);

  if (await portOpen(host, port)) {
    console.log(`[relay-fixture] ${host}:${port} already listening — attaching (no spawn).`);
    return;
  }
  // An EXTERNAL relay (a deployed box, say) is never ours to spawn: say plainly that it is unreachable
  // rather than start a local one under its name and let every relay cell degrade without saying why.
  if (!isLocal(host)) {
    throw new Error(`[relay-fixture] PEER_TEST_RELAY points at ${url}, and ${host}:${port} is not reachable `
      + 'from here. An external relay is attached, never started — check the URL, DNS and that it is up.');
  }
  console.log(`[relay-fixture] starting @onderling/relay on ${host}:${port} …`);
  const child = spawn(process.execPath, [RELAY_BIN, String(port)], {
    env: { ...process.env, HOST: host, PORT: String(port) },
    stdio: 'inherit',
    detached: false,
  });
  try { fs.writeFileSync(pidFile, String(child.pid)); } catch { /* */ }
  const up = await waitForPort(host, port);
  if (!up) { console.warn(`[relay-fixture] relay did NOT come up on ${host}:${port} — relay cells will degrade.`); }
  else     { console.log(`[relay-fixture] relay ready at ${url}`); }
}

export async function globalTeardown() {
  for (const pidFile of [PID_FILE, PID_FILE_2]) {
    let pid = null;
    try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { continue; }
    if (pid) {
      try { process.kill(pid); console.log(`[relay-fixture] stopped relay (pid ${pid}).`); } catch { /* already gone */ }
    }
    try { fs.unlinkSync(pidFile); } catch { /* */ }
  }
}
