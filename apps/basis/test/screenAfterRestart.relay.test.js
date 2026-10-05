/**
 * A CONNECTED SCREEN KEEPS WORKING ACROSS A RESTART OF THE BOX (live bug L196: "Token has been revoked" on the
 * tablet's management screen). The box runner as a household bot, a person in its inbox (its admin), a screen paired
 * as the browser pairs it — then the runner is STOPPED and started again on the same data dir, and the screen calls
 * with the tokens it kept: they must still be honoured. And the same browser key paired again after the page lost
 * its grant record: the new grant acts (the earlier one is superseded, by design).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/stoop/lib/contactCard';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '@onderling/secure-agent';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
const botSaid = async (node) => (await node.contactThreadChannel.rehydrateAll()).filter((t) => t.origin === 'bot').map((t) => t.text);

describe('a screen across a restart of the box', () => {
  let relay; let dataDir; let ann; let box = null;
  const walk = () => { try { const dir = path.join(dataDir, 'walks'); return readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const start = async () => {
    const p = { out: '' };
    p.child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir, '--walk-log', path.join(dataDir, 'walks') + path.sep], {
      env: { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', BASIS_APP_URL: 'https://basis.example/app' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.child.stdout.on('data', (b) => { p.out += String(b); });
    p.child.stderr.on('data', (b) => { p.out += String(b); });
    p.exited = new Promise((r) => p.child.on('exit', r));
    const up = await until(async () => (p.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${p.out.slice(-1500)}`).toBe(true);
    return p;
  };

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-restart-'));
    box = await start();
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    await connectNodesOverRelay([ann], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('paired, the box restarted, the kept tokens still act; paired again after the page lost its record, the new grant acts', async () => {
    const card = cardFrom(box.out);
    const send = (text, extra = {}) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    await send('hallo', { admission: /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(box.out)?.[1] });
    await until(async () => ((await botSaid(ann)).length ? true : null), { timeout: 30_000, step: 300 });

    const pair = async (store) => {
      const seen = (await botSaid(ann)).length;
      await send('/scherm link');
      const line = await until(async () => (await botSaid(ann)).slice(seen).find((t) => t.includes('#scherm=')) ?? null, { timeout: 30_000, step: 300 });
      const view = createScreenView({ link: /https?:\/\/\S+/.exec(line)[0], makeAgent, storage: store });
      const before = (await botSaid(ann)).length;
      const { code } = await view.connect({ label: 'browser' });
      await until(async () => ((await botSaid(ann)).slice(before).some((t) => /koppelen|connect/i.test(t)) ? true : null), { timeout: 30_000, step: 300 });
      await send(`/koppelen ${code}`);
      await view.granted();
      return view;
    };
    const vault = new VaultMemory();   // the browser's key, kept across visits
    const agents = [];
    const makeAgent = async () => { const a = await createSecureAgent({ vault, transportMode: 'relay', warnOnInsecure: false }); agents.push(a); return a; };
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
    try {
      const view = await pair(store);
      expect(await view.call('assistant.assistant-users', {}), 'acts before the restart').toMatchObject({ ok: true });

      // ── the box restarts on the same data dir ──
      box.child.kill('SIGTERM');
      await box.exited;
      box = await start();
      const ready = await until(async () => (walk().some((e) => e.kind === 'surface-grants' && e.ready === true) ? true : null), { timeout: 30_000, step: 300 });
      expect(ready, `the grants lane never folded after the restart: ${JSON.stringify(walk().filter((e) => e.kind === 'surface-grants'))}`).toBe(true);
      const again = createScreenView({ link: `https://basis.example/app/${screenAddressFor(card.peerAddr)}`, makeAgent, storage: store });
      expect(await again.resume()).toBe(true);
      const r = await until(async () => { const x = await again.call('assistant.assistant-users', {}).catch((e) => ({ error: String(e?.message ?? e) })); return x?.ok ? x : (/revoked/i.test(JSON.stringify(x)) ? x : null); }, { timeout: 30_000, step: 1000 });
      expect(r, 'the kept tokens act after the restart').toMatchObject({ ok: true });

      // ── the page lost its grant record (the key is kept): paired again — the new grant acts ──
      storage.clear();
      const fresh = await pair(store);
      expect(await fresh.call('lists.listLists', {}), 'the new grant acts').not.toMatchObject({ ok: false });
      const grants = walk().filter((e) => e.kind === 'screen-grant');
      expect(grants.length).toBeGreaterThanOrEqual(2);
    } finally { for (const a of agents) await a.stop?.().catch(() => {}); }
  }, 300_000);
});
