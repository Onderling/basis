/**
 * A toolbox's things as buttons, crossed for real (ledger L1035): the box booted as the device runner, a Bot API of our
 * own (`ONDERLING_TELEGRAM_API_ROOT`) and a toolbox of our own on a real socket, placed as the operator places one.
 *
 * @guard on the booted box, a toolbox's list of things comes with a button each, and tapping one puts that thing on the household's shopping list (a second tap raises its quantity)
 *
 * The admin switches the placed toolbox on in their private chat, asks `zoek melk`, gets the things with buttons, taps
 * the first: it goes on the shopping list (no list of its shop exists); tapping it again raises the quantity.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { until } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const ADMIN = '9';
const KEY = 'sleutel-voor-de-proef';

/** A toolbox as the recorded one answers: the card, and products.choices as a schema.org ItemList. */
async function fakeToolbox() {
  let base = '';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (status, v) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
        return json(200, { name: 'Boodschappen', supportedInterfaces: [{ url: `${base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], skills: [{ id: 'products.choices', name: 'Products Choices' }] });
      }
      if (req.method === 'POST' && req.url === '/a2a') {
        if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
        const msg = JSON.parse(body);
        const data = msg.params.message.parts[0].data;
        const product = (id, name, price, seller) => ({ '@type': 'ListItem', item: { '@type': 'Product', identifier: id, name, offers: { price, seller: { name: seller } } } });
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { message: { role: 'ROLE_AGENT', parts: [{ data: { operation: data.operation, output: {
          '@type': 'ItemList', itemListElement: [product('ah:33693', 'Halfvolle melk 1 L', '1.19', 'Albert Heijn'), product('jumbo:753536PAK', 'Jumbo halfvolle melk 1 L', '1.05', 'Jumbo')],
        } } }] } } });
      }
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

describe('a toolbox\'s things as buttons, on the booted box', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('zoek melk gives a button per thing; the tap puts it on the shopping list; a second tap raises the quantity', async () => {
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const box = await fakeToolbox();
    cleanup.push(box.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-toolbox-buttons-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    // placed as the operator places one (deploy/roles/assistant.yml): the record and its key beside it
    mkdirSync(path.join(dataDir, 'toolboxes'));
    writeFileSync(path.join(dataDir, 'toolboxes', 'boodschappen.json'), JSON.stringify({ name: 'boodschappen', url: box.base, words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }] }));
    writeFileSync(path.join(dataDir, 'toolboxes', 'boodschappen.key'), KEY);
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        ONDERLING_PRIMARY_DEVICE: '0', TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });

    /** Everything the box said after one line or tap, once it stopped talking. */
    const after = async (act, label) => {
      const before = api.said(ADMIN).length;
      act();
      const got = await until(async () => (api.said(ADMIN).length > before ? true : null), { timeout: 60_000, step: 250 });
      expect(got, `no answer to ${label}:\n${out.slice(-1500)}`).toBe(true);
      let n = -1;
      while (n !== api.said(ADMIN).length) { n = api.said(ADMIN).length; await new Promise((r) => { setTimeout(r, 1200); }); }
      return api.said(ADMIN).slice(before);
    };
    const ask = (text) => after(() => api.write(ADMIN, text, 'Frits'), `"${text}"`);
    const tap = (data) => after(() => api.tap(ADMIN, data, 'Frits'), `the tap ${data}`);
    const buttonsOf = (m) => (m?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

    await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    await ask('/start');
    const card = await ask("/toolbox boodschappen aan"); console.info("CARD", JSON.stringify(card.map((m) => [m.text, (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data)])));
    const on = await tap('/toolbox boodschappen aan ja');
    expect(on.map((m) => m.text).join('\n')).toMatch(/aan|on/i);

    console.info("ON", JSON.stringify(on.map((m) => [m.text, (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data)])));
    const found = await ask('zoek melk');
    console.info("FOUND", JSON.stringify(found.map((m) => [m.text, (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data)])));
    const withButtons = found.find((m) => buttonsOf(m).length);
    expect(withButtons, `no buttons: ${JSON.stringify(found)}`).toBeTruthy();
    expect(withButtons.text).toContain('Halfvolle melk 1 L');
    expect(buttonsOf(withButtons)).toEqual(['/kies 1', '/kies 2']);

    const added = await tap('/kies 1');
    expect(added.map((m) => m.text)).toEqual(['Op Boodschappen: Halfvolle melk 1 L.']);
    const raised = await tap('/kies 1');
    expect(raised.map((m) => m.text).join('\n')).toMatch(/2/);
    // nothing the toolbox should not see, and the key in no message
    expect(JSON.stringify(api.calls)).not.toContain(KEY);
  }, 180_000);
});
