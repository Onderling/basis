// @vitest-environment happy-dom
/**
 * The person's settings behind the gear on Mij (web): the gear opens the home, the home lists the declared groups and
 * then "Per kring", the chooser lists the circles (each opening that circle's own settings), and a group's screen
 * paints exactly its declared sections, in the manifest's order. A section lives in one place: none of a group's
 * sections is painted on the old My data page.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';
import { renderSettingsHome, renderCircleSettingsChooser } from '../../web/v2/circleSettingsHome.js';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { settingsHomeFor, settingsSectionIds } from '../../src/v2/settingsHome.js';
import { basisManifest } from '../../manifest.js';

const t = (k) => k;
const div = () => document.createElement('div');

// every section of every declared group switched on: the props each painter needs
const allSettingsProps = () => ({
  t,
  onSetTheme: vi.fn(), themePref: 'system',
  onSetAppLang: vi.fn(), appLang: 'nl',
  startScreen: { value: 'vandaag', choices: [{ value: 'vandaag', labelKey: 'x' }] }, onSetStartScreen: vi.fn(),
  onSetSurfacePref: vi.fn(), surfacePref: 'inline',
  weekOverview: { on: true, onToggle: vi.fn() },
  notifications: { supported: true, subscribed: false }, onToggleNotifications: vi.fn(),
  onSaveUserLlm: vi.fn(), userLlm: {}, validateUserLlm: () => null,
  doors: { availability: vi.fn(), points: vi.fn(), logReport: vi.fn() },
  delivery: { sendReceipts: true, allowFallback: false }, onSetDelivery: vi.fn(),
  shareNknAddress: true, onSetShareAddress: vi.fn(),
  dataLocation: { relayUrl: 'wss://relay.example' }, onOpenRelayPanel: vi.fn(), relayUrl: 'wss://relay.example',
  syncSelection: { silos: { chat: true, tasks: true, contacts: true }, fileBytes: 'full', kringenOff: new Set(), kringen: [] }, onSetSync: vi.fn(),
  historyMirror: { enabled: false, status: null }, onToggleHistoryMirror: vi.fn(), onExportHistory: vi.fn(),
  onPurgeMessages: vi.fn(async () => 0),
  privacy: [{ title: 'P', body: 'b' }],
  metrics: { opens: 3 },
  frequent: [], onClearFrequent: vi.fn(),
  podStatus: { signedIn: false }, onExportRecovery: vi.fn(),
  devices: [{ deviceId: 'dev-1', label: 'telefoon', revoked: false }], onRevokeDevice: vi.fn(),
  companions: [{ node: 'N'.repeat(43), short: 'NNNNNNNN…' }], onOpenCompanionGrant: vi.fn(), onGrantCompanion: vi.fn(),
  connections: [{ viewPubKey: 'v1', short: 'v1…', label: 'scherm', sees: null, opCount: 1 }], onUnpairConnection: vi.fn(),
  connectionChoices: { ops: [], sections: [] }, onPairConnection: vi.fn(), parseConnectionOffer: () => null,
});

describe('settings behind the gear (web)', () => {
  it('the gear on Mij opens the settings', () => {
    const onSettings = vi.fn();
    const el = renderCircleProfile(div(), { t, onSettings });
    el.querySelector('.cc-profile__gear').click();
    expect(onSettings).toHaveBeenCalled();
    expect(renderCircleProfile(div(), { t }).querySelector('.cc-profile__gear')).toBeNull();
  });

  it('the home lists the declared groups, then Per kring, each a door', () => {
    const onOpenGroup = vi.fn(); const onOpenPerCircle = vi.fn();
    const el = renderSettingsHome(div(), { t, onOpenGroup, onOpenPerCircle });
    const rows = [...el.querySelectorAll('.cc-settings__row')];
    const { groups } = settingsHomeFor(basisManifest);
    expect(rows.map((r) => r.dataset.id)).toEqual([...groups.map((g) => g.id), 'per-circle']);
    rows[0].click();
    expect(onOpenGroup).toHaveBeenCalledWith(groups[0].id);
    rows.at(-1).click();
    expect(onOpenPerCircle).toHaveBeenCalled();
  });

  it('the chooser lists the circles, each opening that circle\'s own settings; none says so', () => {
    const onOpenCircle = vi.fn();
    const el = renderCircleSettingsChooser(div(), { t, circles: [{ id: 'c1', name: 'Huis' }, { id: 'c2', name: '' }], onOpenCircle });
    const rows = [...el.querySelectorAll('.cc-settings__circle')];
    expect(rows.map((r) => r.textContent)).toEqual(['Huis', 'c2']);
    rows[0].click();
    expect(onOpenCircle).toHaveBeenCalledWith('c1');
    expect(renderCircleSettingsChooser(div(), { t, circles: [] }).querySelector('.cc-settings__fact').textContent).toBe('circle.settings_home.no_circles');
  });

  for (const group of settingsHomeFor(basisManifest).groups) {
    it(`${group.id}: its screen paints exactly its declared sections, in order`, () => {
      const ids = group.sections.map((s) => s.id);
      const el = renderCircleMyData(div(), { ...allSettingsProps(), only: ids, groupTitle: 'G' });
      const painted = [...new Set([...el.querySelectorAll('[data-section]')].map((n) => n.dataset.section))];
      expect(painted).toEqual(ids);
      expect(el.querySelector('.cc-mydata__title').textContent).toBe('G');
    });
  }

  it('a section lives in one place: the old My data page paints none of the declared ones', () => {
    const titlesOf = (el) => [...el.querySelectorAll('.cc-mydata__section-title')].map((h) => h.textContent);
    const declared = [...settingsSectionIds(basisManifest)];
    const onGroups = titlesOf(renderCircleMyData(div(), { ...allSettingsProps(), only: declared }));
    const onOld = titlesOf(renderCircleMyData(div(), allSettingsProps()));
    expect(onGroups.length).toBeGreaterThan(0);
    expect(onOld.filter((x) => onGroups.includes(x))).toEqual([]);
  });
});
