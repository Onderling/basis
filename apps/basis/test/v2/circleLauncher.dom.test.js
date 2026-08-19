// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderCircleLauncher } from '../../web/v2/circleLauncher.js';

// β.5 — context menus mount on `document.body` (positioned absolutely),
// so they survive between tests if a test didn't dismiss the menu it
// opened.  Wipe both the body + the test container before each test.
beforeEach(() => {
  document.body.innerHTML = '';
});

// Stub t(): echo the key, and fold {{count}} so the members label is checkable.
const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

// Default fixture: mixed kinds → β.3 grouping is exercised.
const circles = [
  { id: 'g1', name: 'Selwerd',     kind: 'neighbourhood',         memberCount: 87 },
  { id: 'h1', name: 'Huisgenoten', kind: 'household',     memberCount: 4 },
  { id: 'p1', name: 'My things',                          memberCount: null },
];

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('renderCircleLauncher', () => {
  it('renders one tile per circle with name + member meta', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    const tiles = el.querySelectorAll('.circle-tile');
    expect(tiles).toHaveLength(3);
    // Tiles carry the kind data-attr (unchanged from pre-β).
    const byId = Object.fromEntries(
      Array.from(tiles).map((tl) => [tl.dataset.circleId, tl]),
    );
    expect(byId.g1.dataset.kind).toBe('neighbourhood');
    expect(byId.h1.dataset.kind).toBe('household');
    expect(byId.g1.querySelector('.circle-tile__name').textContent).toBe('Selwerd');
    expect(byId.g1.querySelector('.circle-tile__meta').textContent).toBe('circle.members:87');
    // null memberCount → no meta row
    expect(byId.p1.querySelector('.circle-tile__meta')).toBeNull();
  });

  it('renders the title + new-circle button via t()', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    expect(el.querySelector('.circle-launcher__title').textContent).toBe('circle.title');
    expect(el.querySelector('.circle-launcher__new').textContent).toBe('circle.new');
  });

  it('fires onOpenCircle(id) on tile click and onNewCircle on new click', () => {
    const el = mount();
    const onOpenCircle = vi.fn();
    const onNewCircle = vi.fn();
    renderCircleLauncher(el, { circles, t, onOpenCircle, onNewCircle });
    // Click the tile for g1 specifically (sort order isn't lexical).
    el.querySelector('.circle-tile[data-circle-id="g1"]').click();
    el.querySelector('.circle-launcher__new').click();
    expect(onOpenCircle).toHaveBeenCalledWith('g1', circles[0]);
    expect(onNewCircle).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with no circles', () => {
    const el = mount();
    renderCircleLauncher(el, { circles: [], t });
    expect(el.querySelector('.circle-launcher__empty').textContent).toBe('circle.empty');
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(0);
  });

  it('shows the loading state and no tiles while loading', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, loading: true });
    expect(el.querySelector('.circle-launcher__loading').textContent).toBe('circle.loading');
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(0);
  });

  it('re-render clears previous content (idempotent mount)', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    renderCircleLauncher(el, { circles: circles.slice(0, 1), t });
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(1);
  });

  // β.1 — top-row Stream/Availability/Hop/Nearby/My-things buttons removed.
  it('β.1 — no Stream/Availability/Hop/Nearby/My-things buttons on the launcher', () => {
    const el = mount();
    renderCircleLauncher(el, {
      circles,
      t,
      // Even if a host passes these legacy handlers, no buttons must render.
      onStream:       vi.fn(),
      onAvailability: vi.fn(),
      onHop:          vi.fn(),
      onNearby:       vi.fn(),
      onMyThings:     vi.fn(),
    });
    expect(el.querySelector('.circle-launcher__stream')).toBeNull();
    expect(el.querySelector('.circle-launcher__availability')).toBeNull();
    expect(el.querySelector('.circle-launcher__hop')).toBeNull();
    expect(el.querySelector('.circle-launcher__nearby')).toBeNull();
    expect(el.querySelector('.circle-launcher__my-things')).toBeNull();
  });

  it('renders the voorstellen badge when proposals[id] > 0', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, proposals: { h1: 2 } });
    const tiles = el.querySelectorAll('.circle-tile');
    const byId = Object.fromEntries(
      Array.from(tiles).map((tl) => [tl.dataset.circleId, tl]),
    );
    // g1 + p1 have no pending proposals → no badge
    expect(byId.g1.querySelector('.circle-tile__proposals')).toBeNull();
    expect(byId.p1.querySelector('.circle-tile__proposals')).toBeNull();
    // h1 has 2 pending → badge shows the count
    const badge = byId.h1.querySelector('.circle-tile__proposals');
    expect(badge.textContent).toBe('2');
    expect(badge.getAttribute('aria-label')).toBe('circle.tile_proposals:2');
  });

  it('ignores non-positive / non-numeric proposal counts', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, proposals: { g1: 0, h1: 'nope', p1: null } });
    for (const tile of el.querySelectorAll('.circle-tile')) {
      expect(tile.querySelector('.circle-tile__proposals')).toBeNull();
    }
  });

  // β.2 — sort tiles by preview.ts desc; stable name tiebreak on equal ts.
  describe('β.2 — sort by recent activity', () => {
    it('sorts tiles by previews[c.id].ts descending', () => {
      const el = mount();
      // All same kind (household) so β.3 grouping degenerates to a flat
      // list and the order assertion is purely about β.2.
      const same = [
        { id: 'a', name: 'A', kind: 'household' },
        { id: 'b', name: 'B', kind: 'household' },
        { id: 'c', name: 'C', kind: 'household' },
      ];
      const previews = {
        a: { ts: 100 },
        b: { ts: 300 },
        c: { ts: 200 },
      };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('breaks ties on equal ts by name (stable, locale-aware)', () => {
      const el = mount();
      const same = [
        { id: 'x', name: 'Zeta',  kind: 'household' },
        { id: 'y', name: 'Alpha', kind: 'household' },
        { id: 'z', name: 'Mango', kind: 'household' },
      ];
      // Equal ts → name order: Alpha, Mango, Zeta.
      const previews = { x: { ts: 0 }, y: { ts: 0 }, z: { ts: 0 } };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      expect(ids).toEqual(['y', 'z', 'x']);
    });

    it('tiles without a preview.ts sort to the end (treated as 0)', () => {
      const el = mount();
      const same = [
        { id: 'old',  name: 'Old',  kind: 'household' },
        { id: 'new',  name: 'New',  kind: 'household' },
        { id: 'none', name: 'None', kind: 'household' },
      ];
      const previews = { old: { ts: 50 }, new: { ts: 500 } };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      // 'new' (500) → 'old' (50) → 'none' (0).
      expect(ids).toEqual(['new', 'old', 'none']);
    });
  });

  // β.3 — group tiles by kind under fixed-order section headers.
  describe('β.3 — group by kind', () => {
    it('renders section headers when ≥2 kinds are present', () => {
      const el = mount();
      renderCircleLauncher(el, { circles, t });
      const sections = el.querySelectorAll('.circle-launcher__section');
      // Three distinct kinds: 'household', 'neighbourhood', 'other' (p1 has no kind).
      expect(sections).toHaveLength(3);
      const headers = Array.from(el.querySelectorAll('.circle-launcher__section-title'))
        .map((h) => h.textContent);
      // Fixed order: household → circle → friends → other.
      // friends isn't present, so: household, circle, other.
      expect(headers).toEqual([
        'circle.kind.household',
        'circle.kind.neighbourhood',
        'circle.kind.other',
      ]);
    });

    it('skips section headers entirely when all circles share one kind', () => {
      const el = mount();
      const all = [
        { id: 'a', name: 'A', kind: 'household' },
        { id: 'b', name: 'B', kind: 'household' },
      ];
      renderCircleLauncher(el, { circles: all, t });
      expect(el.querySelectorAll('.circle-launcher__section')).toHaveLength(0);
      expect(el.querySelectorAll('.circle-launcher__section-title')).toHaveLength(0);
      // Flat list still renders the tiles.
      expect(el.querySelectorAll('.circle-tile')).toHaveLength(2);
    });

    it('buckets unknown kinds under the "other" header', () => {
      const el = mount();
      const mixed = [
        { id: 'h',  name: 'Home',  kind: 'household' },
        { id: 'w',  name: 'Work',  kind: 'team' },        // unknown
        { id: 'g',  name: 'Group', kind: 'gardening' },   // unknown
      ];
      renderCircleLauncher(el, { circles: mixed, t });
      const sections = el.querySelectorAll('.circle-launcher__section');
      expect(sections).toHaveLength(2); // household + other
      // The 'other' section should contain BOTH unknown-kind tiles.
      const otherSection = el.querySelector('.circle-launcher__section[data-kind="other"]');
      const otherIds = Array.from(otherSection.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId)
        .sort();
      expect(otherIds).toEqual(['g', 'w']);
    });

    it('respects KIND_ORDER (household → neighbourhood → friends → other) even if input is reordered', () => {
      const el = mount();
      const reordered = [
        { id: 'a', name: 'A', kind: 'friends' },
        { id: 'b', name: 'B', kind: 'other-thing' },
        { id: 'c', name: 'C', kind: 'neighbourhood' },
        { id: 'd', name: 'D', kind: 'household' },
      ];
      renderCircleLauncher(el, { circles: reordered, t });
      const headers = Array.from(el.querySelectorAll('.circle-launcher__section-title'))
        .map((h) => h.textContent);
      expect(headers).toEqual([
        'circle.kind.household',
        'circle.kind.neighbourhood',
        'circle.kind.friends',
        'circle.kind.other',
      ]);
    });

    it('sort-by-activity applies WITHIN each kind section', () => {
      const el = mount();
      const mixed = [
        { id: 'h-old', name: 'H-old', kind: 'household' },
        { id: 'h-new', name: 'H-new', kind: 'household' },
        { id: 'b-old', name: 'B-old', kind: 'neighbourhood' },
        { id: 'b-new', name: 'B-new', kind: 'neighbourhood' },
      ];
      const previews = {
        'h-old': { ts: 1 }, 'h-new': { ts: 99 },
        'b-old': { ts: 2 }, 'b-new': { ts: 98 },
      };
      renderCircleLauncher(el, { circles: mixed, previews, t });
      // Household section comes first; inside, h-new (99) before h-old (1).
      const hSection = el.querySelector('.circle-launcher__section[data-kind="household"]');
      const bSection = el.querySelector('.circle-launcher__section[data-kind="neighbourhood"]');
      const hIds = Array.from(hSection.querySelectorAll('.circle-tile')).map((tl) => tl.dataset.circleId);
      const bIds = Array.from(bSection.querySelectorAll('.circle-tile')).map((tl) => tl.dataset.circleId);
      expect(hIds).toEqual(['h-new', 'h-old']);
      expect(bIds).toEqual(['b-new', 'b-old']);
    });
  });

  // β.5 — per-tile context menu (pin / mute / settings / leave).
  describe('β.5 — per-tile context menu', () => {
    function rightClick(tile) {
      const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      tile.dispatchEvent(ev);
      return ev;
    }

    it('right-click on a tile opens a menu with the four actions', () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        onPin: vi.fn(), onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      rightClick(tile);
      const menu = document.querySelector('.circle-launcher__tile-menu');
      expect(menu).not.toBeNull();
      const items = menu.querySelectorAll('.circle-launcher__tile-menu-item');
      expect(items).toHaveLength(4);
      const actions = Array.from(items).map((b) => b.dataset.action);
      expect(actions).toEqual(['pin', 'mute', 'settings', 'leave']);
    });

    it('does NOT attach contextmenu when no menu handlers are provided', () => {
      const el = mount();
      renderCircleLauncher(el, { circles, t });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      const ev = rightClick(tile);
      // No menu was rendered, and the renderer did NOT preventDefault.
      expect(document.querySelector('.circle-launcher__tile-menu')).toBeNull();
      expect(ev.defaultPrevented).toBe(false);
    });

    it('right-click preventDefault is called when menu handlers are wired', () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        onPin: vi.fn(), onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      const ev = rightClick(tile);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('clicking [Pin] fires onPin with the circle id', () => {
      const el = mount();
      const onPin = vi.fn();
      renderCircleLauncher(el, {
        circles, t,
        onPin, onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      rightClick(tile);
      const pinBtn = document.querySelector('.circle-launcher__tile-menu-item[data-action="pin"]');
      pinBtn.click();
      expect(onPin).toHaveBeenCalledWith('g1', circles[0]);
      // Clicking dismisses the menu.
      expect(document.querySelector('.circle-launcher__tile-menu')).toBeNull();
    });

    it('clicking [Settings] / [Leave] / [Mute] dispatches the right handler', () => {
      const el = mount();
      const onPin = vi.fn(), onMute = vi.fn(), onSettings = vi.fn(), onLeave = vi.fn();
      renderCircleLauncher(el, { circles, t, onPin, onMute, onSettings, onLeave });

      const tile = el.querySelector('.circle-tile[data-circle-id="h1"]');
      rightClick(tile);
      document.querySelector('[data-action="settings"]').click();
      expect(onSettings).toHaveBeenCalledWith('h1', circles[1]);

      rightClick(tile);
      document.querySelector('[data-action="mute"]').click();
      expect(onMute).toHaveBeenCalledWith('h1', circles[1]);

      rightClick(tile);
      document.querySelector('[data-action="leave"]').click();
      expect(onLeave).toHaveBeenCalledWith('h1', circles[1]);
    });

    it('menu labels flip with pinnedMap / mutedMap state', () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        pinnedMap: { g1: true },
        mutedMap:  { g1: true },
        onPin: vi.fn(), onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      rightClick(tile);
      expect(document.querySelector('[data-action="pin"]').textContent)
        .toBe('circle.tile.menu.unpin');
      expect(document.querySelector('[data-action="mute"]').textContent)
        .toBe('circle.tile.menu.unmute');
    });

    it('only one menu is open at a time (re-right-click on a different tile)', () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        onPin: vi.fn(), onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      rightClick(el.querySelector('.circle-tile[data-circle-id="g1"]'));
      rightClick(el.querySelector('.circle-tile[data-circle-id="h1"]'));
      const menus = document.querySelectorAll('.circle-launcher__tile-menu');
      expect(menus).toHaveLength(1);
      expect(menus[0].dataset.circleId).toBe('h1');
    });

    it('pinned tiles get a pin-indicator AND the is-pinned class', () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        pinnedMap: { g1: true },
      });
      const tile = el.querySelector('.circle-tile[data-circle-id="g1"]');
      expect(tile.classList.contains('is-pinned')).toBe(true);
      expect(tile.querySelector('.circle-tile__pin-indicator')).not.toBeNull();
      // Unpinned tiles have neither.
      const other = el.querySelector('.circle-tile[data-circle-id="h1"]');
      expect(other.classList.contains('is-pinned')).toBe(false);
      expect(other.querySelector('.circle-tile__pin-indicator')).toBeNull();
    });

    it('pinned tiles float to the top of their kind section (β.5 partition)', () => {
      const el = mount();
      // Two household circles where h-old is the most-recent (β.2 says
      // h-old above h-new); but pinning h-new MUST flip the order so
      // h-new appears first WITHIN the household section.
      const same = [
        { id: 'h-old', name: 'A-old', kind: 'household' },
        { id: 'h-new', name: 'B-new', kind: 'household' },
      ];
      const previews = { 'h-old': { ts: 99 }, 'h-new': { ts: 1 } };
      renderCircleLauncher(el, {
        circles: same,
        previews,
        t,
        pinnedMap: { 'h-new': true },
      });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      // h-new is pinned → first, even though h-old has the newer ts.
      expect(ids).toEqual(['h-new', 'h-old']);
    });

    it('pin partition does NOT escape kind sections', () => {
      const el = mount();
      // Pinning a HOUSEHOLD tile must NOT float it above the circle tiles
      // (neighbourhood comes after household in KIND_ORDER, so the pinned
      // household stays inside the household section).
      const mixed = [
        { id: 'h1', name: 'Home',    kind: 'household' },
        { id: 'h2', name: 'Home2',   kind: 'household' },
        { id: 'b1', name: 'Selwerd', kind: 'neighbourhood' },
      ];
      renderCircleLauncher(el, {
        circles: mixed,
        t,
        pinnedMap: { h2: true },
      });
      // Sections are still household → neighbourhood; b1 is NOT first.
      const sections = Array.from(el.querySelectorAll('.circle-launcher__section'))
        .map((s) => s.dataset.kind);
      expect(sections).toEqual(['household', 'neighbourhood']);
      // Inside household, h2 (pinned) precedes h1.
      const hSection = el.querySelector('.circle-launcher__section[data-kind="household"]');
      const hIds = Array.from(hSection.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      expect(hIds).toEqual(['h2', 'h1']);
    });

    it('Escape closes the menu', async () => {
      const el = mount();
      renderCircleLauncher(el, {
        circles, t,
        onPin: vi.fn(), onMute: vi.fn(), onSettings: vi.fn(), onLeave: vi.fn(),
      });
      rightClick(el.querySelector('.circle-tile[data-circle-id="g1"]'));
      expect(document.querySelector('.circle-launcher__tile-menu')).not.toBeNull();
      // Wait a microtask so the deferred Escape listener attaches.
      await new Promise((r) => setTimeout(r, 5));
      const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(ev);
      expect(document.querySelector('.circle-launcher__tile-menu')).toBeNull();
    });
  });
});
