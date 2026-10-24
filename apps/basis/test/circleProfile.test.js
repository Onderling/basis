/**
 * Mij — the declared screen (name + readings, agents, the Me actions, one door to My data), the person's own basics
 * (handle, name, location — in their own editor), and the doors that moved behind My data. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../web/v2/circleProfile.js';
import { renderProfileBasics } from '../web/v2/profileBasics.js';
import { renderCircleMyData } from '../web/v2/circleMyData.js';
import { settingsGroupFor } from '../src/v2/settingsHome.js';
import { basisManifest as settingsManifest } from '../manifest.js';
const WEERGAVE = settingsGroupFor(settingsManifest, 'appearance').sections.map((x) => x.id);

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

const identityBlock = (content) => ({ blockId: 'mij-identityLine-0', type: 'identityLine', status: 'ok', content });
const agentsBlock = (items) => ({ blockId: 'mij-agents-1', type: 'agents', status: 'ok', titleKey: 'circle.recipe.block.agents', content: { items } });

describe('renderCircleProfile — the declared screen', () => {
  it('the name is the title, the readings one line under it, "Edit" opens the person\'s own editor', () => {
    const onBlockAction = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      t, onBlockAction,
      blocks: [identityBlock({ name: 'Frits', readings: [{ key: 'online', on: true }, { key: 'unread', count: 2 }] }), agentsBlock([])],
    });
    expect(el.querySelectorAll('.cc-profile__title')).toHaveLength(1);
    expect(el.querySelector('.cc-profile__title').textContent).toBe('Frits');
    expect(el.querySelector('.circle-screen__identity-readings').textContent).toBe('circle.profile.reading_online · circle.profile.reading_unread:{"count":2}');
    el.querySelector('.circle-screen__identity-edit').click();
    expect(onBlockAction).toHaveBeenCalledWith({ kind: 'edit-me' });
  });

  it('the agents block: one sentence a row; a tap opens My data', () => {
    const onBlockAction = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), {
      t, onBlockAction,
      blocks: [identityBlock({ name: 'Frits', readings: [] }), agentsBlock([{ kind: 'device', label: null, here: true }, { kind: 'bot', label: 'Huishoudbot' }])],
    });
    const rows = [...el.querySelectorAll('.circle-screen__agents-row')];
    expect(rows.map((r) => r.textContent)).toEqual(['circle.profile.agent_here', 'circle.profile.agent_bot:{"label":"Huishoudbot"}']);
    rows[1].click();
    expect(onBlockAction).toHaveBeenCalledWith({ kind: 'open-my-data' });
  });

  it('one door to My data; Advanced only behind the developer switch; no hand-listed section', () => {
    const onMyData = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { t, onMyData, blocks: [] });
    el.querySelector('.cc-profile__mydata').click();
    expect(onMyData).toHaveBeenCalled();
    expect(el.querySelector('.cc-profile__advanced')).toBeNull();
    expect(renderCircleProfile(document.createElement('div'), { t, onAdvanced: () => {} }).querySelector('.cc-profile__advanced')).not.toBeNull();
    for (const gone of ['.cc-profile__section', '.cc-profile__availability', '.cc-profile__shared-with-me', '.cc-profile__blocked', '.cc-profile__version', '.cc-profile__handle']) {
      expect(el.querySelector(gone), gone).toBeNull();
    }
  });
});

describe('renderProfileBasics — identity (the person\'s own editor)', () => {
  it('prefills handle + displayName and saves the trimmed values', () => {
    const onSaveProfile = vi.fn();
    const el = renderProfileBasics(document.createElement('div'), {
      profile: { handle: 'jan', displayName: 'Jan de Buur' }, t, onSaveProfile,
    });
    expect(el.querySelector('.cc-profile__handle').value).toBe('jan');
    expect(el.querySelector('.cc-profile__display').value).toBe('Jan de Buur');
    el.querySelector('.cc-profile__handle').value = '  janb  ';
    el.querySelector('.cc-profile__save').click();
    expect(onSaveProfile).toHaveBeenCalledWith({ handle: 'janb', displayName: 'Jan de Buur' });
  });
});

describe('renderProfileBasics — location', () => {
  it('shows no-location + geocodes a query', () => {
    const onGeocode = vi.fn();
    const el = renderProfileBasics(document.createElement('div'), { profile: {}, t, onGeocode });
    expect(el.querySelector('.cc-profile__loc-current').textContent).toBe('circle.profile.loc_none');
    el.querySelector('.cc-profile__geo-input').value = 'Groningen';
    el.querySelector('.cc-profile__geo-search').click();
    expect(onGeocode).toHaveBeenCalledWith('Groningen');
  });

  it('who sees the location is said where it is set: in the same editor, below', () => {
    const el = renderProfileBasics(document.createElement('div'), { profile: {}, t });
    expect(el.querySelector('.cc-profile__loc-disclosure-hint').textContent).toBe('circle.profile.loc_disclosure_hint');
  });

  it('renders a geocode result + saves it; shows current + clear when set', () => {
    const onSaveLocation = vi.fn(); const onClearLocation = vi.fn();
    const el = renderProfileBasics(document.createElement('div'), {
      profile: { location: { label: 'Selwerd' } }, geocodeResult: { cell: 'g', label: 'Groningen' },
      t, onSaveLocation, onClearLocation,
    });
    expect(el.querySelector('.cc-profile__loc-current').textContent).toContain('Selwerd');
    el.querySelector('.cc-profile__geo-use').click();
    expect(onSaveLocation).toHaveBeenCalled();
    el.querySelector('.cc-profile__loc-clear').click();
    expect(onClearLocation).toHaveBeenCalled();
  });
});

describe('My data — the doors Mij gave up', () => {
  it('paints the declared doors this shell can open (only the log report since the settings regroup); each fires its own', () => {
    const logReport = vi.fn(); const availability = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), { t, doors: { logReport, availability } });   // keyed by the view each opens
    const btns = [...el.querySelectorAll('.cc-mydata__doors button')];
    expect(btns.map((b) => b.textContent)).toEqual(['circle.profile.logReport']);   // availability is a Verbinding door now
    btns[0].click();
    expect(logReport).toHaveBeenCalled();
    expect(renderCircleMyData(document.createElement('div'), { t }).querySelector('.cc-mydata__doors')).toBeNull();
  });

  it('the week-overview switch is on the Weergave screen, as a real switch, and gone from the old page', () => {
    const onToggle = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), { t, only: WEERGAVE, weekOverview: { on: false, onToggle } });
    const btn = el.querySelector('.cc-profile__week-toggle');
    expect(btn.textContent).toBe('circle.profile.week_off');
    expect(btn.getAttribute('role')).toBe('switch');
    expect(btn.getAttribute('aria-checked')).toBe('false');
    expect(renderCircleMyData(document.createElement('div'), { t, weekOverview: { on: false, onToggle } }).querySelector('.cc-profile__week-toggle')).toBeNull();
    btn.click();
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('My data — the version line (2026-09-19)', () => {
  it('says which build this tab runs, at the bottom; a build without a tag says so', () => {
    const el = renderCircleMyData(document.createElement('div'), { t, version: 'v0.1.13-alpha' });
    const line = el.querySelector('.cc-profile__version');
    expect(line.textContent).toBe('circle.profile.version:{"tag":"v0.1.13-alpha"}');
    expect(el.lastElementChild).toBe(line);
    expect(renderCircleMyData(document.createElement('div'), { t, version: '' }).querySelector('.cc-profile__version').textContent).toBe('circle.profile.version:{"tag":"circle.profile.version_dev"}');
    expect(renderCircleMyData(document.createElement('div'), { t }).querySelector('.cc-profile__version')).toBeNull();
  });
});

describe('renderCircleProfile — the Me actions, from the declaration (share my contact 2026-09-19 · scan 2026-10-09)', () => {
  it('paints the declared Me actions (share-contact, scan) and hands the chosen id back; none without the seam', () => {
    const onMeAction = vi.fn();
    const el = renderCircleProfile(document.createElement('div'), { t, onMeAction });
    const link = el.querySelector('.cc-profile__share-contact');
    expect(link.textContent).toBe('circle.profile.share_contact');
    link.click();
    expect(onMeAction).toHaveBeenCalledWith('share-contact');
    el.querySelector('.cc-profile__scan').click();
    expect(onMeAction).toHaveBeenCalledWith('scan');
    expect(renderCircleProfile(document.createElement('div'), { t }).querySelector('.cc-profile__share-contact')).toBeNull();
  });
});
