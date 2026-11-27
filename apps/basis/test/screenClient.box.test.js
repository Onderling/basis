/**
 * THE BUILT SCREEN CLIENT against the real box over the real relay (ledger L1035 and L1049): the one file a toolbox's
 * page imports pairs by the paste route for ITS toolbox, calls `tools.useTool` and gets the toolbox's own output, is
 * refused another toolbox ('toolbox-not-yours') and an op it does not hold ('op-not-allowed'); a page for a toolbox that
 * is not on is refused in words before anything is asked. The admin is on Telegram (a fake Bot API), the toolbox on a
 * real socket, the box is the device runner.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createSecureAgent } from '@onderling/secure-agent';
import { VaultMemory } from '@onderling/vault';
import { fakeBotApi } from './support/fakeBotApi.js';
import { fakeToolbox, TOOLBOX_KEY } from './support/fakeToolbox.js';
import { startJourneyRelay } from './support/testRelay.js';
import { until } from './support/pairRealAgents.js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(app, 'bin', 'device-runner.mjs');
const ADMIN = '9';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

describe('the built screen client, on the booted box over the relay', () => {
  const cleanup = [];
  afterAll(async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* */ } } });

  it('pairs for its toolbox, calls it, is refused another toolbox and an op it does not hold; a toolbox that is off cannot pair', async () => {
    execFileSync(process.execPath, [path.join(app, 'scripts', 'build-screen-client.mjs')], { cwd: app, stdio: 'pipe' });
    const { createScreenClient } = await import(pathToFileURL(path.join(app, 'dist', 'screen-client', 'onderling-screen-client.js')).href);
    const relay = await startJourneyRelay();
    cleanup.push(() => relay.close?.());
    const api = await fakeBotApi();
    cleanup.push(api.close);
    const tb = await fakeToolbox();
    cleanup.push(tb.close);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-screen-client-'));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(path.join(dataDir, 'toolboxes'));
    // its PAGE (L1113): the address the operator placed, and the household ops it may use beside its toolbox
    writeFileSync(path.join(dataDir, 'toolboxes', 'boodschappen.json'), JSON.stringify({ name: 'boodschappen', url: tb.base, words: [{ word: 'zoek', tool: 'products.choices', field: 'query' }], page: 'https://boodschappen.example/pagina', ops: ['lists.listEntries', 'lists.addToList'] }));
    writeFileSync(path.join(dataDir, 'toolboxes', 'boodschappen.key'), TOOLBOX_KEY);
    // a SECOND toolbox, on too: the case the binding guards (a page reading another toolbox that is there)
    writeFileSync(path.join(dataDir, 'toolboxes', 'recepten.json'), JSON.stringify({ name: 'recepten', url: tb.base, words: [{ word: 'recept', tool: 'products.choices', field: 'query' }] }));
    writeFileSync(path.join(dataDir, 'toolboxes', 'recepten.key'), TOOLBOX_KEY);
    let out = '';
    const child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function',
        ONDERLING_PRIMARY_DEVICE: '0', TG_BOT_TOKEN: '123:fake', TG_ADMIN_UID: ADMIN, ONDERLING_TELEGRAM_API_ROOT: api.root, ONDERLING_RELAY_URL: relay.url, BASIS_APP_URL: 'https://basis.example/app',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    cleanup.push(() => { child.kill('SIGKILL'); });
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
    const textOf = (msgs) => msgs.map((m) => m.text ?? m.caption ?? '').join('\n');
    const buttonsOf = (msgs) => msgs.flatMap((m) => (m?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data));

    await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    await ask('/start');
    await ask('/toolbox boodschappen aan');
    await tap('/toolbox boodschappen aan ja');
    await ask('/toolbox recepten aan');
    await tap('/toolbox recepten aan ja');
    const said = await ask('/scherm');
    const startLine = textOf(said);
    const bot = (/https?:\/\/\S*#scherm-nieuw=\S+/.exec(startLine) ?? [])[0];
    expect(bot, `the admin's /scherm gives the start address:\n${startLine}`).toBeTruthy();
    const agents = [];
    const makeAgent = async () => { const a = await createSecureAgent({ vault: new VaultMemory(), transportMode: 'relay', warnOnInsecure: false }); agents.push(a); return a; };
    cleanup.push(async () => { for (const a of agents) await a.stop?.().catch(() => {}); });

    // a toolbox page opened from Basis's own start address carries no ticket: refused in words, nothing asked (L1113)
    const unticketed = createScreenClient({ toolbox: 'boodschappen', bot, storage: memoryStorage(), makeAgent });
    const u = await unticketed.startPairing();
    const needsLink = await ask(u.paste);
    expect(textOf(needsLink)).toContain('/scherm boodschappen');
    expect(buttonsOf(needsLink).filter((b) => b.startsWith('/koppelen'))).toEqual([]);

    // `/scherm boodschappen`: the link to the toolbox's own placed page, with its one-use ticket
    const pageLine = textOf(await ask('/scherm boodschappen'));
    const pageLink = (/https:\/\/boodschappen\.example\/pagina#scherm-nieuw=\S+/.exec(pageLine) ?? [])[0];
    expect(pageLink, `the toolbox page's link:\n${pageLine}`).toBeTruthy();

    // the page for the toolbox that is on, opened from that link: pasted, the question names it and what it may do, the
    // code picked, granted: useTool and the placed ops, not the admin's whole column
    // A PAGE SERVED OVER PLAIN HTTP IN THE HOME NETWORK (L1183) has no crypto.subtle (a browser gives it to https and
    // loopback only): this page pairs, calls and resumes without it. The bot is another process and keeps its own.
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a) => realCrypto.getRandomValues(a), randomUUID: () => realCrypto.randomUUID() });
    cleanup.push(() => vi.unstubAllGlobals());
    // the page's own browser: its storage and its vault outlive a reload (L1179)
    const pageStorage = memoryStorage();
    const pageVault = new VaultMemory();
    const pageAgent = async () => { const a = await createSecureAgent({ vault: pageVault, transportMode: 'relay', warnOnInsecure: false }); agents.push(a); return a; };
    const page = createScreenClient({ toolbox: 'boodschappen', bot: pageLink, label: 'boodschappenpagina', storage: pageStorage, makeAgent: pageAgent });
    const p = await page.startPairing();
    expect(p.paste).toMatch(/^\/koppel-scherm onderling-connect:\/\//);
    const asked = await ask(p.paste);
    expect(textOf(asked), 'the question names the toolbox').toContain('boodschappen');
    expect(buttonsOf(asked)).toContain(`/koppelen ${p.code}`);
    await tap(`/koppelen ${p.code}`);
    expect(await page.waitForGrant()).toBe('granted');
    expect(page.state()).toBe('connected');
    expect(page.ops()).toContain('tools.useTool');
    // exactly useTool and the placed ops the admin's column holds: an empty grant does not pass this
    expect([...page.ops()].sort(), page.ops().join(', ')).toEqual(['lists.addToList', 'lists.listEntries', 'tools.useTool']);
    // the same link a second time: its ticket is spent
    const again = createScreenClient({ toolbox: 'boodschappen', bot: pageLink, storage: memoryStorage(), makeAgent });
    expect(textOf(await ask((await again.startPairing()).paste))).toContain('/scherm boodschappen');

    const found = await page.call('tools.useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } });
    expect(found, JSON.stringify(found).slice(0, 400)).toMatchObject({ ok: true, output: { '@type': 'ItemList' } });
    // a page that does not ask gets no pictures; one that asks gets them by identifier, fetched by the box from the
    // toolbox's own socket (the page cannot load that address itself), beside the same output
    expect(found.thumbs).toBeUndefined();
    const pictured = await page.call('tools.useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' }, pictures: true });
    expect(pictured.output).toEqual(found.output);
    const ids = found.output.itemListElement.map((el) => el.item.identifier);
    expect(Object.keys(pictured.thumbs ?? {}).length, JSON.stringify({ keys: Object.keys(pictured), row: pictured.items?.[0], img: found.output.itemListElement[0].item.image }).slice(0, 600)).toBeGreaterThan(0);
    expect(Object.keys(pictured.thumbs).every((id) => ids.includes(id))).toBe(true);
    expect(Object.values(pictured.thumbs).every((p) => p.mime === 'image/jpeg' && typeof p.data === 'string')).toBe(true);
    // the other toolbox is ON here, and still not this page's: refused at the door
    expect(await page.call('tools.useTool', { toolbox: 'recepten', tool: 'products.choices', input: { query: 'soep' } })).toMatchObject({ ok: false, code: 'toolbox-not-yours' });
    expect(await page.call('assistant.assistant-import', {})).toMatchObject({ ok: false, code: 'op-not-allowed' });
    // …and resumes from what it kept, still without crypto.subtle
    expect(globalThis.crypto.subtle).toBeUndefined();
    const resumed = createScreenClient({ toolbox: 'boodschappen', bot: pageLink, storage: pageStorage, makeAgent });
    expect(await resumed.resume()).toEqual({ ok: true });

    // THE PAGE RELOADED (L1179): the link's fragment is gone, the page has only its own address; it resumes from what
    // this browser kept (the bot's address, the grant) and calls again, with no new link and no pairing
    const reloaded = createScreenClient({ toolbox: 'boodschappen', bot: 'https://boodschappen.example/pagina', storage: pageStorage, makeAgent: pageAgent });
    expect(await reloaded.resume()).toEqual({ ok: true });
    const foundAgain = await reloaded.call('tools.useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } });
    expect(foundAgain, JSON.stringify(foundAgain).slice(0, 400)).toMatchObject({ ok: true, output: { '@type': 'ItemList' } });

    // a page for a toolbox that is NOT on here (not even placed): refused in words, nothing asked
    const other = createScreenClient({ toolbox: 'klusjesdienst', bot, storage: memoryStorage(), makeAgent });
    const q = await other.startPairing();
    const refused = await ask(q.paste);
    expect(textOf(refused)).toContain('klusjesdienst');
    expect(buttonsOf(refused).filter((b) => b.startsWith('/koppelen'))).toEqual([]);
  }, 240_000);
});
