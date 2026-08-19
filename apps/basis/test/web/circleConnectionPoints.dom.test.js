// @vitest-environment happy-dom
/**
 * Connection points, web surface (Nearby step I).
 *
 * The load-bearing test here is the removal warning. "Cut off" and "still reachable another way" must
 * render as two separate statements — merging them into one list of affected circles is how a person clicks
 * through the warning that actually mattered.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderConnectionPoints } from '../../web/v2/circleConnectionPoints.js';

const t = (k) => k;
const point = (over = {}) => ({
  url: 'wss://a.example', source: 'join', addedAt: 1, adopted: true, circles: ['Circle'], ...over,
});

function render(opts = {}) {
  const el = document.createElement('div');
  renderConnectionPoints(el, { t, ...opts });
  return el;
}

describe('the list', () => {
  it('says what a connection point IS, in terms of what it does for you', () => {
    const el = render({ points: [] });
    expect(el.querySelector('.circle-points__intro').textContent)
      .toBe('circle.nearbyScreen.points_intro');
  });

  it('an empty list also says HOW one arrives', () => {
    // You never hand-configure one to join something, so "you have none" without "joining adds one" would
    // send people looking for a setting that should not exist.
    const el = render({ points: [] });
    expect(el.querySelector('.circle-points__empty').textContent)
      .toBe('circle.nearbyScreen.points_empty');
  });

  it('shows provenance — a circle bringing one reads differently from typing one in', () => {
    expect(render({ points: [point({ source: 'join' })] })
      .querySelector('.circle-points__source').textContent).toBe('circle.nearbyScreen.point_from_join');
    expect(render({ points: [point({ source: 'manual' })] })
      .querySelector('.circle-points__source').textContent).toBe('circle.nearbyScreen.point_from_manual');
  });

  it('shows what rides each point (the both-ways mapping)', () => {
    const el = render({ points: [point({ circles: ['Circle', 'Straat'] })] });
    expect(el.querySelector('.circle-points__carries').textContent)
      .toBe('circle.nearbyScreen.point_carries');
  });

  it('a point nothing uses says so', () => {
    const el = render({ points: [point({ circles: [] })] });
    expect(el.querySelector('.circle-points__carries').textContent)
      .toBe('circle.nearbyScreen.point_carries_none');
  });
});

describe('the circle suggests, the device decides', () => {
  it('a suggestion is marked and offers Adopt', () => {
    const onAdopt = vi.fn();
    const el = render({ points: [point({ source: 'suggested', adopted: false })], onAdopt });
    expect(el.querySelector('.circle-points__point').classList.contains('is-suggested')).toBe(true);
    el.querySelector('.circle-points__adopt').click();
    expect(onAdopt).toHaveBeenCalledWith('wss://a.example');
  });

  it('an adopted point offers no Adopt button', () => {
    expect(render({ points: [point()] }).querySelector('.circle-points__adopt')).toBeNull();
  });
});

describe('removal is honest', () => {
  it('THE ONE THAT MATTERS: cut-off and still-reachable are SEPARATE statements', () => {
    const el = render({
      points: [point()],
      removing: { url: 'wss://a.example', losesReachability: ['Circle'], stillReachable: ['Straat'] },
    });
    const impact = el.querySelector('.circle-points__impact');
    expect(impact.getAttribute('role')).toBe('alert');
    expect(impact.querySelector('.circle-points__impact-cutoff').textContent)
      .toBe('circle.nearbyScreen.remove_cuts_off');
    expect(impact.querySelector('.circle-points__impact-ok').textContent)
      .toBe('circle.nearbyScreen.remove_still_ok');
  });

  it('with nothing cut off, no cut-off line appears at all', () => {
    // The severe statement must not render as an empty shell — an alert that always shows is one nobody
    // reads.
    const el = render({
      points: [point()],
      removing: { url: 'wss://a.example', losesReachability: [], stillReachable: ['Straat'] },
    });
    expect(el.querySelector('.circle-points__impact-cutoff')).toBeNull();
  });

  it('a point nothing depends on says exactly that', () => {
    const el = render({
      points: [point({ circles: [] })],
      removing: { url: 'wss://a.example', losesReachability: [], stillReachable: [] },
    });
    expect(el.querySelector('.circle-points__impact-none').textContent)
      .toBe('circle.nearbyScreen.remove_nothing');
  });

  it('the impact shows only on the point being removed', () => {
    const el = render({
      points: [point(), point({ url: 'wss://b.example' })],
      removing: { url: 'wss://b.example', losesReachability: [], stillReachable: [] },
    });
    const impacts = el.querySelectorAll('.circle-points__impact');
    expect(impacts).toHaveLength(1);
    expect(impacts[0].closest('.circle-points__point').dataset.url).toBe('wss://b.example');
  });

  it('confirm and cancel are both offered, and report', () => {
    const onConfirmRemove = vi.fn(); const onCancelRemove = vi.fn();
    const el = render({
      points: [point()],
      removing: { url: 'wss://a.example', losesReachability: ['Circle'], stillReachable: [] },
      onConfirmRemove, onCancelRemove,
    });
    el.querySelector('.circle-points__confirm').click();
    el.querySelector('.circle-points__cancel').click();
    expect(onConfirmRemove).toHaveBeenCalledWith('wss://a.example');
    expect(onCancelRemove).toHaveBeenCalled();
  });

  it('remove asks first — it does not remove on the first click', () => {
    const onRemove = vi.fn(); const onConfirmRemove = vi.fn();
    const el = render({ points: [point()], onRemove, onConfirmRemove });
    el.querySelector('.circle-points__remove').click();
    expect(onRemove).toHaveBeenCalledWith('wss://a.example');
    expect(onConfirmRemove).not.toHaveBeenCalled();
  });
});

describe('invariant 8', () => {
  it('no untranslated strings anywhere', () => {
    const el = render({
      points: [point(), point({ url: 'wss://b.example', source: 'suggested', adopted: false, circles: [] })],
      removing: { url: 'wss://a.example', losesReachability: ['Circle'], stillReachable: ['Straat'] },
      onBack: () => {},
    });
    const sel = 'button, .circle-points__intro, .circle-points__source, .circle-points__carries,'
      + ' .circle-points__impact-cutoff, .circle-points__impact-ok';
    for (const n of el.querySelectorAll(sel)) {
      const txt = n.textContent.trim();
      if (txt) expect(txt.startsWith('circle.'), `untranslated: "${txt}"`).toBe(true);
    }
  });
});

describe('one is live, the rest are standby', () => {
  it('marks the point actually in use, and the others as standby', () => {
    // The substrate connects to one relay at a time; a list showing them all as equal would claim
    // something untrue.
    const el = render({
      points: [point({ active: true }), point({ url: 'wss://b.example', active: false })],
    });
    const labels = [...el.querySelectorAll('.circle-points__live')].map((n) => n.textContent);
    expect(labels).toEqual(['circle.nearbyScreen.point_active', 'circle.nearbyScreen.point_standby']);
  });

  it('removing the LIVE point warns about the disconnect, even with nothing cut off', () => {
    const el = render({
      points: [point({ active: true })],
      removing: { url: 'wss://a.example', losesReachability: [], stillReachable: ['Straat'], wasActive: true },
    });
    expect(el.querySelector('.circle-points__impact-active').textContent)
      .toBe('circle.nearbyScreen.remove_was_active');
    // …and it does NOT also claim nothing depends on it.
    expect(el.querySelector('.circle-points__impact-none')).toBeNull();
  });

  it('removing a STANDBY point does not warn about disconnecting', () => {
    const el = render({
      points: [point()],
      removing: { url: 'wss://a.example', losesReachability: [], stillReachable: [], wasActive: false },
    });
    expect(el.querySelector('.circle-points__impact-active')).toBeNull();
    expect(el.querySelector('.circle-points__impact-none')).toBeTruthy();
  });
});

