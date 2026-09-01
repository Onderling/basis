// @vitest-environment happy-dom
/**
 * The typed door in a contact thread — the web half.
 *
 * Until 2026-09-01 this thread showed the peer's skills as chips and offered no way to TYPE one: a `/`
 * line went out as chat. Mobile had a hand-written parser doing the same job in one place only. Both now
 * read `createComposerCommands`, so the answer to "what can I do here" has one implementation and one
 * filter — and in a contact thread the filter is what THAT PEER exposes, not what your own circle can do.
 *
 * A bot is a contact, so this is also the surface where a person asks a bot what it offers.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactThread } from '../../web/v2/contactThread.js';

const SKILLS = [
  { id: 'summarise', description: 'summarise a thread' },
  { id: 'translate', description: 'translate a message' },
];

function mount(over = {}) {
  const container = document.createElement('div');
  const onSend = vi.fn();
  const onSkillTap = vi.fn();
  renderContactThread(container, {
    name: 'Ada', messages: [], skills: SKILLS, t: (k) => k, onSend, onSkillTap, ...over,
  });
  const input = container.querySelector('.cc-cthread__input');
  const form = container.querySelector('.cc-cthread__composer');
  const suggest = container.querySelector('.cc-cthread__suggest');
  const type = (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { container, input, form, suggest, type, submit, onSend, onSkillTap };
}

describe('typing a command in a contact thread', () => {
  it('offers nothing until a slash is typed', () => {
    const { suggest, type } = mount();
    expect(suggest.hidden).toBe(true);
    type('hallo');
    expect(suggest.hidden).toBe(true);
  });

  it('offers what THIS peer exposes, filtered as you type', () => {
    const { suggest, type } = mount();
    type('/');
    expect(suggest.hidden).toBe(false);
    expect([...suggest.querySelectorAll('.cc-cthread__suggest-cmd')].map((e) => e.textContent))
      .toEqual(['/summarise', '/translate']);
    type('/t');
    expect([...suggest.querySelectorAll('.cc-cthread__suggest-cmd')].map((e) => e.textContent))
      .toEqual(['/translate']);
    type('/translate hallo');
    expect(suggest.hidden, 'past the command word the person is into arguments').toBe(true);
  });

  it('runs the skill when the typed command is one the peer offers', () => {
    const { type, submit, onSkillTap, onSend } = mount();
    type('/translate hallo daar');
    submit();
    expect(onSkillTap).toHaveBeenCalledWith({ id: 'translate' }, 'hallo daar');
    expect(onSend, 'a command is not also sent as chat').not.toHaveBeenCalled();
  });

  it('sends a slash line the peer does NOT offer as ordinary chat', () => {
    // The load-bearing case: in a conversation a slash is sometimes just a slash, and refusing it would
    // tell a person their sentence was wrong when the peer's list was simply narrow.
    const { type, submit, onSkillTap, onSend } = mount();
    type('/find something');
    submit();
    expect(onSkillTap).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith('/find something');
  });

  it('a peer that exposes nothing offers nothing — and still takes chat', () => {
    const { suggest, type, submit, onSend } = mount({ skills: [] });
    type('/');
    expect(suggest.hidden).toBe(true);
    type('/anything');
    submit();
    expect(onSend).toHaveBeenCalledWith('/anything');
  });

  it('tapping a row fills the command and leaves the caret after it', () => {
    const { suggest, input, type } = mount();
    type('/s');
    const row = suggest.querySelector('.cc-cthread__suggest-item');
    row.dispatchEvent(new Event('mousedown', { bubbles: true, cancelable: true }));
    expect(input.value).toBe('/summarise ');
  });
});
