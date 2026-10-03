/**
 * The export key from the admin's screen (setup brief §23): two screen-only ops over the box's own cores
 * (`exportKeyFile.js`), each held for a yes in the admin's private chat; the passphrase is a secret param that appears
 * nowhere — not in the question, the chat, the screen's answer, the told outcome or the screen's storage.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { createScreenStepUp } from '../src/v2/screenStepUp.js';
import { createExportKeyFile } from '../src/v2/exportKeyFile.js';
import { EXPORT_KEY_FILE, UNLOCKED_KEY_FILE, unlockedSecret } from '../src/v2/householdExportShelf.js';
import { sealExport, openExport } from '../src/v2/householdExportSeal.js';
import { screenColumnFor, SCREEN_ADMIN_OPS } from '../src/v2/screenActing.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';
import { buildToolDescriptors } from '../src/v2/interpretCommand.js';

// the door's words for what a request will do come back as words (a key that comes back as itself has none)
const t = (k, p) => (k.startsWith('circle.bot.stepup_what.') ? `WHAT:${k.split('.').pop()}` : (p ? `${k} ${JSON.stringify(p)}` : k));
const ADMIN = 'telegram:9';
const PASS = 'een geheime lange zin 42';
const fast = { m: 8, t: 1, p: 1 };   // fast argon2 for tests

function box({ memberCaller = null } = {}) {
  const m = new Map();
  const files = { read: (n) => m.get(n) ?? null, write: (n, x) => { m.set(n, x); }, remove: (n) => { m.delete(n); } };
  const asked = [];
  const told = [];
  const stepUp = createScreenStepUp({
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    tell: async (viewPubKey, o) => { told.push({ viewPubKey, ...o }); },
  });
  const users = [{ id: ADMIN, channel: 'telegram', uid: '9', role: 'admin' }, { id: 'telegram:7', channel: 'telegram', uid: '7', role: 'member' }];
  const call = withAssistantOps({
    callSkill: async () => ({ ok: true }), t, threads: { langOf: () => null },
    // the host gate: the admin's ops are the admin's
    refusal: async (op, caller, level) => (level === 'trusted' && caller !== ADMIN ? { layer: 'role', code: 'admin-only' } : null),
    admin: { users: async () => users, stepUp, exportKey: createExportKeyFile({ files, argonOpts: fast }) },
  });
  const fromScreen = (caller = ADMIN) => ({ caller, threadId: caller, via: 'screen', viewPubKey: 'VIEW', screenLabel: 'laptop' });
  const PRIVATE = { caller: ADMIN, threadId: ADMIN, chatId: '9' };
  const yes = async () => call('assistant', 'assistant-screen-approve', { answer: `ja ${/\/bevestig ja (\S+)/.exec(asked.at(-1).buttons[0].id)[1]}` }, PRIVATE);
  return { m, call, asked, told, fromScreen, yes, PRIVATE };
}

describe('the export key from the admin\'s screen', () => {
  it('the ops are the screen\'s alone: no slash, no chat, no model tool; on the admin\'s screen by name, not a member\'s', () => {
    for (const id of ['assistant-export-key-set', 'assistant-export-key-unlock']) {
      const op = assistantManifest.operations.find((o) => o.id === id);
      expect(op?.surfaces, id).toEqual({});
      expect(op.stepUp).toBe('private-door');
      // set takes the passphrase twice (two fields on the screen); unlock once
      expect(op.params).toEqual(id === 'assistant-export-key-set'
        ? [{ name: 'passphrase', kind: 'secret', required: true }, { name: 'passphraseAgain', kind: 'secret', required: true }]
        : [{ name: 'passphrase', kind: 'secret', required: true }]);
      expect(SCREEN_ADMIN_OPS).toContain(`assistant.${id}`);
    }
    const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
    expect((catalogue.commandMenu ?? []).some((e) => /export-key/.test(e.opId ?? ''))).toBe(false);
    expect(buildToolDescriptors(catalogue).some((d) => /export-key/.test(JSON.stringify(d)))).toBe(false);
    expect(screenColumnFor(catalogue, 'admin')).toContain('assistant.assistant-export-key-set');
    expect(screenColumnFor(catalogue, 'member')).not.toContain('assistant.assistant-export-key-set');
  });

  it('set from a screen writes no key file until the yes; the passphrase appears nowhere', async () => {
    const b = box();
    const held = await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.fromScreen());
    expect(held).toMatchObject({ ok: true, pending: true });
    expect(b.m.get(EXPORT_KEY_FILE)).toBeUndefined();
    expect(b.asked[0].text).toContain('WHAT:assistant-export-key-set');
    const done = await b.yes();
    expect(done.ok).toBe(true);
    expect(b.m.get(EXPORT_KEY_FILE)).toBeTruthy();
    expect(b.told.at(-1)).toMatchObject({ outcome: 'done' });
    for (const said of [held, done, ...b.asked, ...b.told]) expect(JSON.stringify(said)).not.toContain(PASS);
  });

  it('after the yes the next export is sealed to the new key; unlock from the screen opens it for the /import', async () => {
    const b = box();
    await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.fromScreen());
    await b.yes();
    const sealed = sealExport({ exportedAt: 'x', things: [1] }, JSON.parse(b.m.get(EXPORT_KEY_FILE)));
    await b.call('assistant', 'assistant-export-key-unlock', { passphrase: PASS }, b.fromScreen());
    expect(b.m.get(UNLOCKED_KEY_FILE)).toBeUndefined();   // nothing open before the yes
    const opened = await b.yes();
    expect(opened.ok).toBe(true);
    expect(openExport(sealed, unlockedSecret(b.m.get(UNLOCKED_KEY_FILE)))).toMatchObject({ things: [1] });
    expect(JSON.stringify(opened)).not.toContain(PASS);
  });

  it('a key already set: the question says files sealed with the old one open only with the old passphrase', async () => {
    const b = box();
    await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.fromScreen());
    await b.yes();
    await b.call('assistant', 'assistant-export-key-set', { passphrase: 'een nieuwe lange zin', passphraseAgain: 'een nieuwe lange zin' }, b.fromScreen());
    expect(b.asked.at(-1).text).toContain('circle.bot.stepup_export_key_replaces');
  });

  it('checked before the question: too short, a member\'s screen, an unlock with no key — refused, nothing asked', async () => {
    const b = box();
    expect((await b.call('assistant', 'assistant-export-key-set', { passphrase: 'kort', passphraseAgain: 'kort' }, b.fromScreen())).ok).toBe(false);
    expect((await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.fromScreen('telegram:7'))).ok).toBe(false);
    expect((await b.call('assistant', 'assistant-export-key-unlock', { passphrase: PASS }, b.fromScreen())).ok).toBe(false);
    expect(b.asked).toEqual([]);
    expect(b.m.size).toBe(0);
  });

  it('set: the two passphrases differ — refused at the op, nothing asked, nothing written', async () => {
    const b = box();
    const r = await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: `${PASS}!` }, b.fromScreen());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('circle.bot.export_key_mismatch');
    expect(JSON.stringify(r)).not.toContain(PASS);
    expect(b.asked).toEqual([]);
    expect(b.m.get(EXPORT_KEY_FILE)).toBeUndefined();
  });

  it('a wrong passphrase on unlock: said so after the yes, and the key stays locked', async () => {
    const b = box();
    await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.fromScreen());
    await b.yes();
    await b.call('assistant', 'assistant-export-key-unlock', { passphrase: 'niet de goede zin hoor' }, b.fromScreen());
    const r = await b.yes();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('circle.bot.export_key_wrong');
    expect(b.m.get(UNLOCKED_KEY_FILE)).toBeUndefined();
  });

  it('not from the chat: the ops run only after a screen\'s request was said yes to', async () => {
    const b = box();
    const r = await b.call('assistant', 'assistant-export-key-set', { passphrase: PASS, passphraseAgain: PASS }, b.PRIVATE);
    expect(r.ok).toBe(false);
    expect(b.m.get(EXPORT_KEY_FILE)).toBeUndefined();
  });

  it('the screen keeps no passphrase: its storage holds the grant only', async () => {
    const storage = new Map([['onderling.screen.BOT', JSON.stringify({ botAddress: 'BOT', relayUrl: 'wss://r', tokens: [{ skill: 'assistant.assistant-export-key-set' }] })]]);
    const view = createScreenView({
      link: `https://basis.example/app${screenAddressFor('BOT')}`,
      storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
      makeAgent: async () => ({ agent: { pubKey: 'V' }, relay: { connect: async () => {} }, peer: { invoke: async () => [{ data: { ok: true, pending: true } }] } }),
      setTimer: () => 1, clearTimer: () => {},
    });
    await view.resume();
    await view.call('assistant.assistant-export-key-set', { passphrase: PASS });
    expect(JSON.stringify([...storage.values()])).not.toContain(PASS);
  });
});
