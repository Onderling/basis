// @vitest-environment happy-dom
/**
 * Web paints "Mijn overzicht" on Mij: one section, the shared blocks drawn by the screen's own block painter, each
 * under its own title — and no screens-book affordance (no rename, delete, set-active or add-a-block).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';

const t = (k, v) => (v ? `T:${k}:${JSON.stringify(v)}` : `T:${k}`);
const mount = () => { const el = document.createElement('div'); document.body.appendChild(el); return el; };

const blocks = [
  { blockId: 'mij-my-things', type: 'items', status: 'ok', titleKey: 'circle.screens.seed_my_things',
    content: { noun: 'task', scope: 'mine', items: [{ id: 't1', text: 'afwas', label: 'afwas', circleName: 'Huis' }] } },
  { blockId: 'mij-my-agenda', type: 'items', status: 'empty', titleKey: 'circle.screens.seed_my_calendar',
    content: { noun: 'calendar-event', scope: 'all', items: [] } },
];

describe('Mij — Mijn overzicht (web)', () => {
  it('paints one section titled Mijn overzicht with both blocks under their own titles', () => {
    const el = renderCircleProfile(mount(), { profile: {}, t, overviewBlocks: blocks });
    const sec = el.querySelector('.cc-profile__overview');
    expect(sec).not.toBeNull();
    expect(sec.querySelector('.cc-profile__section-title').textContent).toBe('T:circle.profile.overview_title');
    const painted = [...sec.querySelectorAll('.circle-screen__block')];
    expect(painted.map((b) => b.dataset.blockId)).toEqual(['mij-my-things', 'mij-my-agenda']);
    expect(painted[0].querySelector('.circle-screen__block-title').textContent).toBe('T:circle.screens.seed_my_things');
    expect(painted[0].textContent).toContain('afwas');
    expect(painted[0].textContent).toContain('Huis');
    // an empty block says which one is empty in the person's words, not the block type
    expect(painted[1].textContent).toBe('T:circle.screen.block_empty:{"type":"T:circle.screens.seed_my_calendar"}');
  });

  it('says it is loading while the blocks materialize; absent = no section', () => {
    const loading = renderCircleProfile(mount(), { profile: {}, t, overviewBlocks: null });
    expect(loading.querySelector('.cc-profile__overview .circle-screen__loading').textContent).toBe('T:circle.screen.loading');
    const none = renderCircleProfile(mount(), { profile: {}, t });
    expect(none.querySelector('.cc-profile__overview')).toBeNull();
  });

  it('carries no screens-book controls', () => {
    const el = renderCircleProfile(mount(), { profile: {}, t, overviewBlocks: blocks });
    const sec = el.querySelector('.cc-profile__overview');
    expect(sec.querySelector('button, input')).toBeNull();
  });

  it('the web shell fills it from the shared helper on the Mij tab', () => {
    const app = readFileSync(resolve(__dirname, '../../web/v2/circleApp.js'), 'utf8');
    const at = app.indexOf('async function showMij(');
    const showMij = app.slice(at, app.indexOf('\n}\n', at));
    expect(showMij).toMatch(/mijOverviewBlocks\(/);
    expect(showMij).toMatch(/overviewBlocks/);
  });
});
