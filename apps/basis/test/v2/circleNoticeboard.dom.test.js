// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleNoticeboard } from '../../web/v2/circleNoticeboard.js';

const t = (k) => k;   // identity → keys are the assertable text
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleNoticeboard — embeds[] surfacing', () => {
  it('renders a "See also" chip per embed (icon + type label + label/ref)', () => {
    const el = mount();
    renderCircleNoticeboard(el, { t, posts: [{
      id: 'p1', type: 'ask', text: 'Need help installing solar panels',
      embeds: [
        { type: 'task', ref: 'urn:dec:item:T-solar', label: 'Solar install' },
        { type: 'calendar-event', ref: 'evt-1' },
      ],
    }] });
    const chips = el.querySelectorAll('.cc-noticeboard__embed');
    expect(chips).toHaveLength(2);
    expect(el.querySelector('.cc-noticeboard__embeds-label').textContent).toBe('circle.embed.see_also');
    // identity t() returns the key → the renderer falls back to the RAW type
    // (in the app t() returns the localized "Task"). icon + type + the label.
    expect(chips[0].textContent).toBe('✅ task: Solar install');
    expect(chips[0].dataset.ref).toBe('urn:dec:item:T-solar');
    // event chip: no label → shortened ref
    expect(chips[1].textContent).toBe('📅 calendar-event: evt-1');
  });

  it('reads stoop-legacy source.embeds too', () => {
    const el = mount();
    renderCircleNoticeboard(el, { t, posts: [{
      id: 'p2', type: 'offer', text: 'x', source: { embeds: [{ type: 'request', ref: 'P-1' }] },
    }] });
    expect(el.querySelectorAll('.cc-noticeboard__embed')).toHaveLength(1);
  });

  it('renders no embeds block when a post has none', () => {
    const el = mount();
    renderCircleNoticeboard(el, { t, posts: [{ id: 'p3', type: 'ask', text: 'plain' }] });
    expect(el.querySelector('.cc-noticeboard__embeds')).toBeNull();
  });

  it('a task chip is tappable + a tap fires onEmbedOpen with the screen', () => {
    const el = mount();
    const onEmbedOpen = vi.fn();
    renderCircleNoticeboard(el, { t, onEmbedOpen, posts: [{
      id: 'p4', type: 'ask', text: 'help', embeds: [{ type: 'task', ref: 't9', label: 'Wire it' }],
    }] });
    const chip = el.querySelector('.cc-noticeboard__embed--tappable');
    expect(chip.tagName).toBe('BUTTON');
    chip.click();
    expect(onEmbedOpen).toHaveBeenCalledWith({ type: 'task', ref: 't9', screen: 'tasks' });
  });
});
