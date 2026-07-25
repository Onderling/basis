/**
 * circleAdminPanel — the S3 group admin panel. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAdminPanel } from '../web/v2/circleAdminPanel.js';

const t = (k) => k;

describe('renderCircleAdminPanel', () => {
  it('lists members with role badges + a remove action', () => {
    const onRemove = vi.fn();
    const el = renderCircleAdminPanel(document.createElement('div'), {
      t, onRemove,
      members: [
        { webid: 'w-admin', displayName: 'Ann', role: 'admin' },
        { webid: 'w-bob', handle: 'bob', role: 'member' },
      ],
    });
    const rows = el.querySelectorAll('.cc-admin__member');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.cc-admin__member-name').textContent).toBe('Ann');
    expect(rows[0].querySelector('.cc-admin__member-role').textContent).toBe('circle.admin.role.admin');
    expect(rows[1].querySelector('.cc-admin__member-role')).toBeNull();   // plain member → no badge
    rows[1].querySelector('.cc-admin__member-remove').click();
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ webid: 'w-bob' }));
  });

  it('shows the empty roster state', () => {
    const el = renderCircleAdminPanel(document.createElement('div'), { t, members: [] });
    expect(el.querySelector('.cc-admin__empty').textContent).toBe('circle.admin.no_members');
  });

  it('posts an announcement (trimmed) + clears the box', () => {
    const onAnnounce = vi.fn();
    const el = renderCircleAdminPanel(document.createElement('div'), { t, members: [], onAnnounce });
    const area = el.querySelector('.cc-admin__announce-input');
    area.value = '  street party saturday  ';
    el.querySelector('.cc-admin__announce').dispatchEvent(new Event('submit'));
    expect(onAnnounce).toHaveBeenCalledWith('street party saturday');
    expect(area.value).toBe('');
  });

  it('renders a notice (e.g. admin-only refusal) + fires onBack', () => {
    const onBack = vi.fn();
    const el = renderCircleAdminPanel(document.createElement('div'), { t, members: [], notice: 'nope', onBack });
    expect(el.querySelector('.cc-admin__notice').textContent).toBe('nope');
    el.querySelector('.cc-admin__back').click();
    expect(onBack).toHaveBeenCalled();
  });

  it('lists muted peers; unmute fires onUnmute (S3 moderation)', () => {
    const onUnmute = vi.fn();
    const el = renderCircleAdminPanel(document.createElement('div'), {
      t, members: [], onUnmute,
      muted: ['webid:https://bob.example/me', 'stable-7'],
    });
    // Reports are NOT in the admin panel — they live on the §8 governance Reports surface.
    expect(el.querySelector('.cc-admin__report')).toBeNull();
    const muted = el.querySelectorAll('.cc-admin__muted');
    expect(muted).toHaveLength(2);
    expect(muted[0].querySelector('.cc-admin__muted-key').textContent).toBe('https://bob.example/me'); // webid: stripped
    muted[1].querySelector('.cc-admin__unmute').click();
    expect(onUnmute).toHaveBeenCalledWith('stable-7');
  });
});
