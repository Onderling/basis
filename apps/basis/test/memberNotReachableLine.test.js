/**
 * The members tab says, on a member's row, that this device cannot reach them yet — only for the members the host
 * names (no address here past the re-tell window), in the circle's own words, with the reveal-gated name.
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderCircleView } from '../web/v2/circleView.js';

const t = (k, p) => (p?.name ? `${k}:${p.name}` : k);
const members = [
  { id: 'webid:anna', webid: 'webid:anna', handle: 'anna', role: 'admin' },
  { id: 'webid:dirk', webid: 'webid:dirk', handle: 'dirk', role: 'member' },
];
const paint = (unreachable) => renderCircleView(document.createElement('div'), {
  circle: { id: 'c1', name: 'Buren' }, t, activeTab: 'members', tabs: [{ id: 'members' }], members, selfWebid: 'webid:anna', unreachable,
});

describe('the not-reachable line on a member row', () => {
  it('is on the named member\'s row, with their shown name — and on nobody else\'s', () => {
    const el = paint(new Set(['webid:dirk']));
    const lines = [...el.querySelectorAll('[data-not-reachable="true"]')];
    expect(lines).toHaveLength(1);
    expect(lines[0].closest('[data-member-id]')?.dataset.memberId).toBe('webid:dirk');
    expect(lines[0].textContent).toBe('circle.membership.not_reachable:@dirk');
  });
  it('is absent when everyone is reachable', () => {
    expect(paint(new Set()).querySelectorAll('[data-not-reachable="true"]')).toHaveLength(0);
    expect(paint(null).querySelectorAll('[data-not-reachable="true"]')).toHaveLength(0);
  });
});
