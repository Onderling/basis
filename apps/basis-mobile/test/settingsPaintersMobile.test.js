// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * The settings painters on mobile paint ITS section and nothing else, and the old My data page keeps every section no
 * group took, in its order. `src/screens/**` cannot be rendered under vitest, so the paint is pinned as source text (as
 * meSubscreensChrome does): the section titles each painter opens, and the old page's, in order.
 *
 * Why: the first cut of the Weergave group (2026-10-23) took mobile's week switch up to "where the app opens", and on
 * mobile nine sections sat between — Waar het staat, Sleutels & back-up, Mijn apparaten and more. They left the old
 * page and showed on the Weergave screen instead, custody among them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsSectionIds } from '../../basis/src/v2/settingsHome.js';
import { basisManifest } from '../../basis/manifest.js';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleMyDataScreen.js', import.meta.url)), 'utf8');
const titles = (text) => [...text.matchAll(/<Section title=\{t\('([^']+)'\)\}|<ActSection\b/g)].map((m) => m[1] ?? ACT);

/**
 * Each section id a group declares, and the one title its painter opens — or `ACT` for a section of one act or two whose
 * button says what it does (`<ActSection>`, no heading: the split of the old "Sleutels & back-up", 2026-11-20).
 */
const ACT = '<act>';
const OWN_TITLE = {
  'theme': 'circle.mydata.theme',
  'language': 'circle.mydata.language',
  'start-screen': 'circle.mydata.start_title',
  'plus-middle': 'circle.params.key.plus_middle',
  'bot-actions': 'circle.mydata.surface_pref',
  'week-overview': 'circle.profile.week_switch',
  'notifications': 'circle.mydata.notifications',
  'assistant': 'circle.userLlm.title',
  'connection-points': 'circle.nearbyScreen.points_open',
  'delivery': 'circle.nearbyScreen.delivery_section',
  'address-sharing': 'circle.mydata.address_sharing',
  'relay': 'circle.mydata.relay',
  'device-keeps': 'circle.mydata.sync',
  'history-mirror': 'circle.mydata.history',
  'message-cleanup': 'circle.mydata.cleanup',
  'privacy': 'circle.mydata.privacy',
  'usage': 'circle.mydata.usage',
  'frequent': 'circle.mydata.frequent',
  'devices': 'circle.mydata.devices',
  'agents': 'circle.companionGrant.nodes',
  'connections': 'circle.mydata.connections',
  'connection-add': 'circle.mydata.connection_add',
  'device-add': ACT,
  'device-replace': ACT,
  'device-primary': ACT,
  'companion-claim': ACT,
  'bot-link': ACT,
  'recovery-phrase': ACT,
  'restore': ACT,
  'recovery-file': ACT,
  'personas-receive': ACT,
  'app-lock': 'circle.lock.section_title',
  'storage': 'circle.mydata.storage',
  'own-actions': 'circle.params.key.ownActions_record',
};

const painterBodies = () => {
  const start = SRC.indexOf('const painters = {');
  const block = SRC.slice(start, SRC.indexOf('\n  };\n', start));
  const heads = [...block.matchAll(/^ {4}'([a-z0-9-]+)': \(\) =>/gm)];
  return Object.fromEntries(heads.map((m, i) => [m[1], block.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : block.length)]));
};

describe('mobile settings painters', () => {
  it('every section a group declares has its painter here (a new section that only web paints is red, not missing)', () => {
    const declared = [...settingsSectionIds(basisManifest)];
    expect(declared.filter((id) => !(id in OWN_TITLE)), 'declared, but no title pinned in OWN_TITLE').toEqual([]);
    const bodies = painterBodies();
    expect(declared.filter((id) => !bodies[id]), 'declared, but mobile paints nothing for it').toEqual([]);
  });

  it('each painter opens exactly its own section, and no other', () => {
    const bodies = painterBodies();
    for (const [id, title] of Object.entries(OWN_TITLE)) expect(titles(bodies[id] ?? ''), id).toEqual([title]);
  });

  it('the wizards a section opens are mounted on the group screen too (Herstel opens restore, Apparaten enrol)', () => {
    const at = SRC.indexOf('testID="circle-settings-group"');
    const group = SRC.slice(at, SRC.indexOf('</ScrollView>', at));
    expect(group).toMatch(/\{overlays\}/);
    expect(SRC.slice(SRC.indexOf('const overlays = ('), SRC.indexOf('if (Array.isArray(only))'))).toMatch(/RestoreFromMnemonicWizardModal[\s\S]*EnrollDeviceModal[\s\S]*mydata-mnemonic-reveal/);
  });

  it('there is no old My data page: the screen paints a settings group, and nothing outside one', () => {
    expect(SRC).not.toMatch(/testID="circle-mydata"/);
    expect(SRC.match(/testID="circle-settings-group"/g)?.length).toBe(1);
    expect(SRC).not.toMatch(/myDataActionsMobile/);
  });
});

describe('the two moves out of My data, on mobile (web: contactsRoster.js, the awaiting chip on Vandaag)', () => {
  const read = (name) => readFileSync(fileURLToPath(new URL(`../src/screens/v2/${name}`, import.meta.url)), 'utf8');
  it('Contacten has the blocked door, also on an empty roster; the launcher opens the blocked list from it', () => {
    const contacts = read('ContactsScreen.js');
    expect(contacts).toMatch(/onBlocked = null/);
    expect(contacts.match(/\{blockedDoor\}/g)?.length).toBe(2);   // the empty roster and the list both
    expect(read('CircleLauncherScreen.js')).toMatch(/onBlocked=\{\(\) => setView\('blocked'\)\}/);
  });
  it('the persona panel opens Apparaten for its device and agent rows, through the shared settingsGroupForAction', () => {
    expect(read('CircleProfileScreen.js')).toMatch(/else if \(settingsGroupForAction\(a\)\)/);
    expect(read('CircleLauncherScreen.js')).toMatch(/onSettingsGroup=\{\(id\) => \{ setPanelOpen\(false\); setSettingsGroupId\(id\); setView\('settingsGroup'\); \}\}/);
  });
  it('Vandaag opens shared-with-me from its "Wacht op jou" chip, with the count handed in as a source', () => {
    const launcher = read('CircleLauncherScreen.js');
    expect(launcher).toMatch(/a\?\.kind === 'open-shared-with-me'\) setView\('sharedWithMe'\)/);
    expect(launcher).toMatch(/sharedWithMeCount: mijSources\.sharedWithMeCount/);
    expect(launcher).toMatch(/sharedWithMeCount: async \(\) =>/);
  });
});
