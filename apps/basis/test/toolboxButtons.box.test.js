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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeBotApi } from './support/fakeBotApi.js';
import { fakeToolbox, TOOLBOX_KEY as KEY } from './support/fakeToolbox.js';
import { until } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const ADMIN = '9';

describe('a toolbox\'s things as buttons, on the booted box', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('zoek melk gives a button per thing; the tap puts it on the shopping list; a second tap raises the quantity', async () => {
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const box = await fakeToolbox({ perShop: 8 });
    cleanup.push(box.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-toolbox-buttons-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    // placed as the operator places one (deploy/roles/assistant.yml): the record and its key beside it
    mkdirSync(path.join(dataDir, 'toolboxes'));
    writeFileSync(path.join(dataDir, 'toolboxes', 'boodschappen.json'), JSON.stringify({ name: 'boodschappen', url: box.base, words: [{ word: 'zoek', tool: 'products.choices', field: 'query',
      slots: [{ param: 'stores', list: true, values: { ah: ['bij albert heijn', 'bij ah'], jumbo: ['bij jumbo', 'bij de jumbo'] } }] }] }));
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
    const card = await ask('/toolbox boodschappen aan');
    // the card's Ja and Nee reach Telegram as buttons
    expect(card.flatMap((m) => buttonsOf(m))).toEqual(['/toolbox boodschappen aan ja', '/toolbox boodschappen aan nee']);
    const on = await tap('/toolbox boodschappen aan ja');
    expect(on.map((m) => m.text).join('\n')).toMatch(/aan|on/i);

    const albumsBefore = api.albums(ADMIN).length;
    const found = await ask('zoek melk');
    // per shop ONE album of its three cards (the toolbox answers shop by shop, 8 each: the pictures went to the cards,
    // not to the first ten rows), a number in each caption, bytes from the box
    const albums = api.albums(ADMIN).slice(albumsBefore);
    expect(albums.map((a) => a.captions.map((c) => c.split('.')[0]))).toEqual([['1', '2', '3'], ['9', '10', '11']]);
    expect(albums[0].captions[0]).toMatch(/^1\. Halfvolle melk 1 L/);
    expect(albums.every((a) => a.files.length === 3 && a.files.every((f) => f.bytes > 0))).toBe(true);
    expect(api.photos(ADMIN)).toHaveLength(0);
    // under each album ONE message: the shop, the numbered lines, a Kies button per card and one "Meer"
    expect(found.map((m) => m.text.split('\n')[0])).toEqual(['Boodschappen:', 'Albert Heijn:', 'Jumbo:']);
    expect(found[1].text).toMatch(/^Albert Heijn:\n1\. Halfvolle melk 1 L[^\n]*\n2\. [^\n]+\n3\. [^\n]+$/);
    expect(found[2].text).toMatch(/^Jumbo:\n9\. Jumbo halfvolle melk 1 L[^\n]*\n10\. [^\n]+\n11\. [^\n]+$/);
    const kb = (m) => (m?.reply_markup?.inline_keyboard ?? []).map((row) => row.map((b) => b.callback_data));
    expect(kb(found[1]).map((row) => row.map((d) => d.replace(/:[a-z0-9]+\./, ':').replace(/^\/meer .*/, 'meer')))).toEqual([['pickThing:1', 'pickThing:2', 'pickThing:3'], ['meer']]);
    // a button names its list and its number (`pickThing:<tag>.<n>`)
    const [first, second] = kb(found[1])[0];

    const added = await tap(first);
    expect(added.map((m) => m.text)).toEqual(['Op Boodschappen: Halfvolle melk 1 L.']);
    const raised = await tap(first);
    expect(raised.map((m) => m.text).join('\n')).toMatch(/2/);

    // the words, at every door (Fable's ruling on L1035): the list is numbered, and '9' or 'kies 9' picks thing 9 of the
    // LAST list shown in this thread; the button only sends the same thing
    const typed = await ask('9');
    expect(typed.map((m) => m.text)).toEqual(['Op Boodschappen: Jumbo halfvolle melk 1 L.']);
    const kies = await ask('kies 9');
    expect(kies.map((m) => m.text).join('\n')).toMatch(/Jumbo halfvolle melk 1 L[\s\S]*2|2[\s\S]*Jumbo halfvolle melk 1 L/);

    // the operator's slot words: the shop phrase comes off the question and fills the tool's parameter
    await ask('zoek hagelslag bij Albert Heijn');
    expect(box.inputs.at(-1)).toEqual({ query: 'hagelslag', stores: ['ah'] });
    // a newer list replaces the kept one: a button of the OLDER message picks nothing (never a thing of the newer list)
    await ask('zoek kaas');
    const stale = await tap(second);
    expect(stale.map((m) => m.text)).toEqual(["Die lijst ken ik niet meer. Zoek opnieuw en tik er een aan."]);
    // nothing the toolbox should not see, and the key in no message
    expect(JSON.stringify(api.calls)).not.toContain(KEY);
  }, 180_000);
});
