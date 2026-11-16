// @vitest-environment happy-dom
/**
 * What a contact sees of you — the web paint (L125). The add sheet and the thread header's control are one form
 * (`contactLensPanel.js`) over the shared model (`src/v2/contactLens.js`); the header offers it only on a person's
 * thread, beside Verbergen.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactLensPanel } from '../../web/v2/contactLensPanel.js';
import { renderContactThread } from '../../web/v2/contactThread.js';

const model = {
  name: 'Anne',
  personas: [{ id: 'default', name: 'Frits' }, { id: 'buurt', name: 'Buurt' }],
  persona: 'default', presets: ['handle', 'profile', 'full'], revealPreset: 'profile',
};

describe('the lens form', () => {
  it('prefills the default persona and the level, and hands back what was chosen', async () => {
    const container = document.createElement('div');
    const onSubmit = vi.fn(); const onClose = vi.fn();
    renderContactLensPanel({ container, t: (k) => k, onClose, mode: 'add', model, onSubmit });
    expect(container.querySelector('[data-testid=contact-add-sheet]')).toBeTruthy();
    const persona = container.querySelector('.cc-lens__persona');
    const level = container.querySelector('.cc-lens__level');
    expect(persona.value).toBe('default');
    expect(level.value).toBe('profile');
    persona.value = 'buurt'; persona.dispatchEvent(new Event('change'));
    level.value = 'handle'; level.dispatchEvent(new Event('change'));
    container.querySelector('.cc-lens__ok').click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ persona: 'buurt', revealPreset: 'handle' });
  });

  it('says the honest sentence — a different view, not a different you', () => {
    const container = document.createElement('div');
    renderContactLensPanel({ container, t: (k) => k, onClose: vi.fn(), mode: 'change', model, onSubmit: vi.fn() });
    expect(container.textContent).toContain('circle.contacts.lens.hint');
  });

  it('cancel adds nothing', () => {
    const container = document.createElement('div');
    const onSubmit = vi.fn(); const onCancel = vi.fn();
    renderContactLensPanel({ container, t: (k) => k, onClose: vi.fn(), mode: 'add', model, onSubmit, onCancel });
    container.querySelector('.cc-lens__cancel').click();
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the thread header offers it', () => {
  it('on a person\'s thread: the avatar top right is who you are here, and its tap opens the lens', () => {
    const container = document.createElement('div');
    const onOpenLens = vi.fn();
    renderContactThread(container, { name: 'Anne', messages: [], t: (k, v) => (v ? `${k}:${v.name}` : k), hidden: false, onToggleHidden: vi.fn(), onOpenLens, self: { id: 'werk', name: 'Werk' } });
    const me = container.querySelector('.cc-cthread__self');
    expect(me.getAttribute('aria-label')).toBe('circle.contacts.self_here:Werk');
    me.click();
    expect(onOpenLens).toHaveBeenCalled();
  });

  it('the ⋯ holds Verbergen and Verwijderen (with the note on hiding); closed until tapped', () => {
    const container = document.createElement('div');
    const onDelete = vi.fn();
    renderContactThread(container, { name: 'Anne', messages: [], t: (k) => k, hidden: false, onToggleHidden: vi.fn(), onOpenLens: vi.fn(), onDelete });
    const menu = container.querySelector('.cc-cthread__menu');
    expect(menu.hidden).toBe(true);
    expect([...menu.children].map((c) => c.className)).toEqual(['cc-cthread__hide', 'cc-cthread__hide-note', 'cc-btn cc-btn--danger cc-cthread__delete']);
    container.querySelector('.cc-cthread__more').click();
    expect(menu.hidden).toBe(false);
    menu.querySelector('.cc-cthread__delete').click();
    expect(onDelete).toHaveBeenCalled();
    // the header carries no separate Hide, lens or Delete buttons any more
    expect(container.querySelector('.cc-cthread__lens')).toBeNull();
    expect([...container.querySelector('.cc-cthread__header').children].some((c) => c.classList?.contains('cc-cthread__hide'))).toBe(false);
  });

  it('not on a bot\'s thread (no hidden mark = not a person)', () => {
    const container = document.createElement('div');
    renderContactThread(container, { name: 'Bot', messages: [], t: (k) => k, hidden: null, onOpenLens: vi.fn() });
    expect(container.querySelector('.cc-cthread__self')).toBeNull();
    expect(container.querySelector('.cc-cthread__more')).toBeNull();
  });
});

describe('closing by clicking outside', () => {
  it('counts as a cancel, once — a caller waiting on the choice is never left waiting', () => {
    const container = document.createElement('div');
    let guard = null; const onCancel = vi.fn();
    renderContactLensPanel({ container, t: (k) => k, onClose: vi.fn(), mode: 'add', model, onSubmit: vi.fn(), onCancel, setCloseGuard: (fn) => { guard = fn; } });
    expect(guard()).toBe(true);
    guard();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('delete, on the thread header (L114)', () => {
  it('offers Verwijderen on a person\'s thread and hands the act to the shell', () => {
    const container = document.createElement('div');
    const onDelete = vi.fn();
    renderContactThread(container, { name: 'Anne', messages: [], t: (k) => k, hidden: false, onToggleHidden: vi.fn(), onDelete });
    container.querySelector('.cc-cthread__delete').click();
    expect(onDelete).toHaveBeenCalled();
  });
  it('a return after a deletion says "verwijderd"', () => {
    const container = document.createElement('div');
    renderContactThread(container, { name: 'Anne', t: (k) => k, hidden: false, deletedAt: 5,
      messages: [{ origin: 'bot', text: 'hoi', returned: true, ts: 10 }] });
    expect(container.querySelector('.cc-cthread__system').textContent).toBe('circle.contacts.returned_deleted_marker');
  });
});
