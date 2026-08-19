/**
 * circleNoticeboard — the noticeboard surface (S1 #1). @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleNoticeboard } from '../web/v2/circleNoticeboard.js';

const t = (k) => k;

describe('renderCircleNoticeboard', () => {
  it('renders intent pills (active one marked) + composer; submit fires onPost', () => {
    const onPost = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, intent: 'offer', onPost });
    const pills = [...el.querySelectorAll('.cc-noticeboard__intent')];
    expect(pills.map((p) => p.dataset.intent)).toEqual(['ask', 'offer', 'lend']);
    expect(el.querySelector('.cc-noticeboard__intent.is-active').dataset.intent).toBe('offer');

    const input = el.querySelector('.cc-noticeboard__input');
    input.value = '  ladder te leen  ';
    el.querySelector('.cc-noticeboard__composer').dispatchEvent(new Event('submit'));
    expect(onPost).toHaveBeenCalledWith({ intent: 'offer', text: 'ladder te leen' });
    expect(input.value).toBe('');
  });

  it('an intent pill tap fires onIntent', () => {
    const onIntent = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, onIntent });
    el.querySelector('[data-intent="lend"]').click();
    expect(onIntent).toHaveBeenCalledWith('lend');
  });

  it('renders a post with type badge + text + actions; respond/report on others’ posts', () => {
    const onAction = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, onAction,
      posts: [{ id: 'p1', type: 'ask', text: 'wie heeft een boormachine?', addedByLabel: 'alice', mine: false }],
    });
    const row = el.querySelector('.cc-noticeboard__post-row');
    expect(row.dataset.postId).toBe('p1');
    expect(row.querySelector('.cc-noticeboard__badge--ask')).not.toBeNull();
    expect(row.querySelector('.cc-noticeboard__text').textContent).toContain('boormachine');
    const actions = [...row.querySelectorAll('.cc-noticeboard__chip')].map((c) => c.dataset.action);
    expect(actions).toEqual(['respond', 'report', 'mute']);   // not mine → help + report + mute; no cancel
    row.querySelector('[data-action="respond"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'respond', post: expect.objectContaining({ id: 'p1' }) });
  });

  it('a post by someone else shows mute alongside respond/report (S3)', () => {
    const onAction = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, onAction, posts: [{ id: 'p3', type: 'ask', text: 'x', addedBy: 'w-bob', mine: false }],
    });
    const actions = [...el.querySelectorAll('.cc-noticeboard__chip')].map((c) => c.dataset.action);
    expect(actions).toEqual(['respond', 'report', 'mute']);
    el.querySelector('[data-action="mute"]').click();
    expect(onAction).toHaveBeenCalledWith({ action: 'mute', post: expect.objectContaining({ id: 'p3' }) });
  });

  it('my own lend post shows assign + returned + withdraw (S1/S3)', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, posts: [{ id: 'p2', type: 'lend', text: 'mijn ladder', mine: true }],
    });
    const actions = [...el.querySelectorAll('.cc-noticeboard__chip')].map((c) => c.dataset.action);
    expect(actions).toEqual(['assign', 'markReturned', 'cancel']);
  });

  it('a lend post carries a due-date through onPost (S3 #4)', () => {
    const onPost = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { t, posts: [], intent: 'lend', onPost });
    const dueInput = el.querySelector('.cc-noticeboard__due-input');
    expect(dueInput).not.toBeNull();
    dueInput.value = '2026-07-01';
    el.querySelector('.cc-noticeboard__input').value = 'ladder te leen';
    el.querySelector('.cc-noticeboard__composer').dispatchEvent(new Event('submit'));
    expect(onPost).toHaveBeenCalledWith(expect.objectContaining({ intent: 'lend', text: 'ladder te leen', dueAt: Date.parse('2026-07-01') }));
  });

  it('shows the empty state with no posts', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t });
    expect(el.querySelector('.cc-noticeboard__empty').textContent).toBe('circle.noticeboard.empty');
    expect(el.querySelector('.cc-noticeboard__list')).toBeNull();
  });

  it('shows the busy state while posting', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, busy: true });
    expect(el.querySelector('.cc-noticeboard__busy').textContent).toBe('circle.noticeboard.posting');
  });

  // ── S5 attachments ──────────────────────────────────────────────────────────
  it('shows the attach button only when onAttach is wired; a file pick fires onAttach', () => {
    const bare = renderCircleNoticeboard(document.createElement('div'), { posts: [], t });
    expect(bare.querySelector('.cc-noticeboard__attach')).toBeNull();

    const onAttach = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), { posts: [], t, onAttach });
    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const input = el.querySelector('.cc-noticeboard__file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onAttach).toHaveBeenCalledWith(file);
  });

  it('previews a pending attachment + remove fires onClearAttach', () => {
    const onClearAttach = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, onAttach: () => {}, onClearAttach,
      attachment: { thumbnail: 'data:image/jpeg;base64,AAA', name: 'pic.jpg' },
    });
    expect(el.querySelector('.cc-noticeboard__attach-thumb').src).toContain('data:image/jpeg;base64,AAA');
    el.querySelector('.cc-noticeboard__attach-remove').click();
    expect(onClearAttach).toHaveBeenCalled();
  });

  it('lets an image-only post submit (no text) when an attachment is pending', () => {
    const onPost = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, intent: 'offer', onPost, onAttach: () => {},
      attachment: { thumbnail: 'data:image/jpeg;base64,AAA' },
    });
    el.querySelector('.cc-noticeboard__composer').dispatchEvent(new Event('submit'));
    expect(onPost).toHaveBeenCalledWith({ intent: 'offer', text: '' });
  });

  it('renders post thumbnails; a tap fires onViewAttachment', () => {
    const onViewAttachment = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      t, onViewAttachment,
      posts: [{ id: 'p9', type: 'offer', text: 'free chair', mine: false,
        attachments: [{ id: 'a1', thumbnail: 'data:image/jpeg;base64,TTT', width: 100, height: 80 }] }],
    });
    const img = el.querySelector('.cc-noticeboard__att');
    expect(img.src).toContain('data:image/jpeg;base64,TTT');
    img.click();
    expect(onViewAttachment).toHaveBeenCalledWith({ post: expect.objectContaining({ id: 'p9' }), att: expect.objectContaining({ id: 'a1' }) });
  });
});
