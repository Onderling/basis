/**
 * circleTabBar — the v2 bottom nav (feedback-extension adds Contacten).
 *
 * D / Surface 1 — the tab roster is now PROJECTED from `manifest.tabs` via
 * the shared `circleTabs` selector, not a per-shell `TABS` literal.  These
 * tests assert the bar renders the projected ids/labels (invariants #1/#3/#4).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleTabBar } from '../web/v2/circleTabBar.js';
import { circleTabs } from '../src/v2/tabProjection.js';
import { basisManifest } from '../src/index.js';

const t = (k) => k;

describe('renderCircleTabBar', () => {
  it('renders the four tabs in order, Contacten between Circles and Mij', () => {
    const el = renderCircleTabBar(document.createElement('nav'), { active: 'circles', t });
    const tabs = [...el.querySelectorAll('.circle-tabbar__tab')].map((b) => b.dataset.tab);
    expect(tabs).toEqual(['screens', 'circles', 'contacten', 'mij']);
    expect(el.querySelector('[data-tab="circles"]').classList.contains('is-active')).toBe(true);
  });

  it('wires onContacts to the Contacten tab', () => {
    const onContacts = vi.fn();
    const el = renderCircleTabBar(document.createElement('nav'), { active: 'contacten', t, onContacts });
    const tab = el.querySelector('[data-tab="contacten"]');
    expect(tab.classList.contains('is-active')).toBe(true);
    expect(tab.getAttribute('aria-current')).toBe('page');
    tab.click();
    expect(onContacts).toHaveBeenCalled();
  });

  it('is a genuine projection consumer: the DOM tabs match manifest.tabs (ids + labels)', () => {
    const projected = circleTabs(basisManifest);
    // The manifest is the single source of the roster (no per-shell literal).
    expect(projected.map((tab) => tab.id)).toEqual(['screens', 'circles', 'contacten', 'mij']);
    const el = renderCircleTabBar(document.createElement('nav'), { active: 'screens', t });
    const btns = [...el.querySelectorAll('.circle-tabbar__tab')];
    expect(btns.map((b) => b.dataset.tab)).toEqual(projected.map((tab) => tab.id));
    // Each button's label is the projected labelKey resolved via t().
    expect(btns.map((b) => b.textContent)).toEqual(projected.map((tab) => t(tab.labelKey)));
  });
});
