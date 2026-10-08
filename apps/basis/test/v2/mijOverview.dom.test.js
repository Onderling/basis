// @vitest-environment happy-dom
/**
 * Web paints ONE section on Mij, "Mijn overzicht": Gepland's rows at the top (the coming days, as Gepland always
 * listed them, with the week-overview switch that lived beside them), and below them the shared "Mijn dingen" block
 * drawn by the screen's own block painter under its own title. No separate Gepland section, no "Mijn agenda" block,
 * and no screens-book affordance (no rename, delete, set-active or add-a-block).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';

const t = (k, v) => (v ? `T:${k}:${JSON.stringify(v)}` : `T:${k}`);
const mount = () => { const el = document.createElement('div'); document.body.appendChild(el); return el; };

const things = { blockId: 'mij-my-things', type: 'items', status: 'ok', titleKey: 'circle.screens.seed_my_things',
  content: { noun: 'task', scope: 'mine', items: [{ id: 't1', text: 'afwas', label: 'afwas', circleName: 'Huis' }] } };
const lines = ['do 8 14:00 · tandarts · Huis', 'vr 9 · vuilnis'];

describe('Mij — Mijn overzicht (web)', () => {
  it('one section: Gepland\'s rows on top, then Mijn dingen under its own title', () => {
    const el = renderCircleProfile(mount(), { profile: {}, t, plannedLines: lines, overviewBlocks: [things] });
    const sections = [...el.querySelectorAll('.cc-profile__section-title')].map((h) => h.textContent);
    expect(sections.filter((s) => s === 'T:circle.profile.overview_title')).toHaveLength(1);
    expect(sections).not.toContain('T:circle.profile.planned_title');   // Gepland's own heading is absorbed
    const sec = el.querySelector('.cc-profile__overview');
    expect(sec.querySelectorAll('.cc-profile__section-title')).toHaveLength(1);
    expect([...sec.querySelectorAll('.cc-profile__planned-item')].map((li) => li.textContent)).toEqual(lines);
    const painted = [...sec.querySelectorAll('.circle-screen__block')];
    expect(painted.map((b) => b.dataset.blockId)).toEqual(['mij-my-things']);
    expect(painted[0].querySelector('.circle-screen__block-title').textContent).toBe('T:circle.screens.seed_my_things');
    expect(painted[0].textContent).toContain('afwas');
    // Gepland's rows come first, the block after them
    const planned = sec.querySelector('.cc-profile__planned');
    expect(planned.compareDocumentPosition(painted[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the week-overview switch stays with Gepland\'s rows, inside the section', () => {
    const onToggle = vi.fn();
    const el = renderCircleProfile(mount(), { profile: {}, t, plannedLines: lines, overviewBlocks: [things], weekOverview: { on: false, onToggle } });
    const toggle = el.querySelector('.cc-profile__overview .cc-profile__week-toggle');
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(onToggle).toHaveBeenCalled();
  });

  it('an empty block says which one is empty in the person\'s words; loading says so', () => {
    const empty = renderCircleProfile(mount(), { profile: {}, t, plannedLines: [], overviewBlocks: [{ ...things, status: 'empty', content: { noun: 'task', items: [] } }] });
    expect(empty.querySelector('.cc-profile__overview .circle-screen__block').textContent)
      .toBe('T:circle.screen.block_empty:{"type":"T:circle.screens.seed_my_things"}');
    expect(empty.querySelector('.cc-profile__overview .cc-profile__planned').textContent).toContain('T:circle.profile.planned_none');
    const loading = renderCircleProfile(mount(), { profile: {}, t, plannedLines: null, overviewBlocks: null });
    expect(loading.querySelector('.cc-profile__overview .circle-screen__loading').textContent).toBe('T:circle.screen.loading');
    expect(loading.querySelector('.cc-profile__overview .cc-profile__planned').textContent).toContain('T:circle.profile.planned_loading');
  });

  it('absent both = no section; the block part carries no screens-book controls', () => {
    expect(renderCircleProfile(mount(), { profile: {}, t }).querySelector('.cc-profile__overview')).toBeNull();
    const el = renderCircleProfile(mount(), { profile: {}, t, plannedLines: lines, overviewBlocks: [things] });
    expect(el.querySelector('.cc-profile__overview .circle-screen').querySelector('button, input')).toBeNull();
  });

  it('the web shell fills it from the shared helper on the Mij tab, beside Gepland', () => {
    const app = readFileSync(resolve(__dirname, '../../web/v2/circleApp.js'), 'utf8');
    const at = app.indexOf('async function showMij(');
    const showMij = app.slice(at, app.indexOf('\n}\n', at));
    expect(showMij).toMatch(/mijOverviewBlocks\(/);
    expect(showMij).toMatch(/plannedForMe\(/);
    expect(showMij).toMatch(/overviewBlocks/);
  });
});
