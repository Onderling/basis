/**
 * contactThread — the contact DM thread DOM render (feedback-extension).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactThread } from '../web/v2/contactThread.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('renderContactThread', () => {
  it('renders user + bot bubbles in order', () => {
    const el = renderContactThread(document.createElement('div'), {
      name: 'Feedback bot', t,
      messages: [
        { origin: 'user', text: 'de wachtlijst is te lang' },
        { origin: 'bot', text: 'bedankt, ik stuur dit door' },
      ],
    });
    const msgs = el.querySelectorAll('.cc-cthread__msg');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].classList.contains('cc-cthread__msg--user')).toBe(true);
    expect(msgs[0].querySelector('.cc-cthread__bubble').textContent).toBe('de wachtlijst is te lang');
    expect(msgs[1].classList.contains('cc-cthread__msg--bot')).toBe(true);
  });

  it('submitting the composer fires onSend with the trimmed text + clears the input', () => {
    const onSend = vi.fn();
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, onSend });
    const input = el.querySelector('.cc-cthread__input');
    input.value = '  hello  ';
    el.querySelector('.cc-cthread__composer').dispatchEvent(new Event('submit'));
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
  });

  it('does not fire onSend for an empty/whitespace message', () => {
    const onSend = vi.fn();
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, onSend });
    el.querySelector('.cc-cthread__input').value = '   ';
    el.querySelector('.cc-cthread__composer').dispatchEvent(new Event('submit'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders reply buttons + routes a tap to onButtonTap', () => {
    const onButtonTap = vi.fn();
    const msg = { origin: 'bot', text: 'Doorsturen?', buttons: [{ id: 'yes', label: 'Ja' }] };
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, messages: [msg], onButtonTap });
    const btn = el.querySelector('.cc-cthread__btn');
    expect(btn.textContent).toBe('Ja');
    btn.click();
    expect(onButtonTap).toHaveBeenCalledWith({ id: 'yes', label: 'Ja' }, msg);
  });

  it('renders the language picker (langValue + onLangChange) + routes a tap', () => {
    const onLangChange = vi.fn();
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, langValue: 'nl', onLangChange });
    const btns = [...el.querySelectorAll('.cc-cthread__lang-btn')];
    expect(btns.map((b) => b.textContent)).toEqual(['NL', 'EN']);
    expect(el.querySelector('.cc-cthread__lang-btn.is-active').textContent).toBe('NL');
    btns.find((b) => b.dataset.lang === 'en').click();
    expect(onLangChange).toHaveBeenCalledWith('en');
  });

  it('omits the language picker when langValue is not set', () => {
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t });
    expect(el.querySelector('.cc-cthread__lang')).toBe(null);
  });

  it('renders the per-circle privacy badge (icon + label) + routes a tap to onPrivacyTap', () => {
    const onPrivacyTap = vi.fn();
    const el = renderContactThread(document.createElement('div'), {
      name: 'Bot', t, privacy: { level: 'sharing', icon: '🛡', label: 'Privacy: sharing' }, onPrivacyTap,
    });
    const badge = el.querySelector('.cc-cthread__privacy');
    expect(badge).not.toBe(null);
    expect(badge.dataset.level).toBe('sharing');
    expect(badge.textContent).toContain('Privacy: sharing');
    badge.click();
    expect(onPrivacyTap).toHaveBeenCalled();
  });

  it('uses the ⚠️ icon + risk modifier + pulse class for the earned risk state', () => {
    const el = renderContactThread(document.createElement('div'), {
      name: 'Bot', t, privacy: { level: 'risk', icon: '⚠️', label: 'Privacy: ⚠ risk', pulse: true },
    });
    const badge = el.querySelector('.cc-cthread__privacy--risk');
    expect(badge).not.toBe(null);
    expect(badge.textContent).toContain('⚠️');
    expect(badge.classList.contains('is-pulse')).toBe(true);
  });

  it('says the pre-send floor under the header when the contact declared one, and nothing otherwise', () => {
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, floor: { label: 'circle.contacts.presend_floor' } });
    expect(el.querySelector('.cc-cthread__floor').textContent).toContain('circle.contacts.presend_floor');
    const none = renderContactThread(document.createElement('div'), { name: 'Bot', t, floor: null });
    expect(none.querySelector('.cc-cthread__floor')).toBeNull();
  });

  it('omits the privacy badge when privacy is not applicable (null)', () => {
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, privacy: null });
    expect(el.querySelector('.cc-cthread__privacy')).toBe(null);
  });

  it('shows the busy + error states', () => {
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, busy: true, error: true });
    expect(el.querySelector('.cc-cthread__sending').textContent).toBe('circle.contacts.sending');
    expect(el.querySelector('.cc-cthread__error').textContent).toContain('circle.contacts.send_failed');
  });

  it('back link fires onBack', () => {
    const onBack = vi.fn();
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, onBack });
    el.querySelector('.cc-cthread__back').click();
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the bot’s skills as /chips + a tap fires onSkillTap (P4 in-thread)', () => {
    const onSkillTap = vi.fn();
    const el = renderContactThread(document.createElement('div'), {
      name: 'Bot', t, onSkillTap,
      skills: [{ id: 'summarise', description: 'Summarise' }, { id: 'sentiment' }],
    });
    const chips = el.querySelectorAll('.cc-cthread__skill');
    expect([...chips].map((c) => c.textContent)).toEqual(['/summarise', '/sentiment']);
    expect(chips[0].title).toBe('Summarise');
    chips[0].click();
    expect(onSkillTap).toHaveBeenCalledWith({ id: 'summarise', description: 'Summarise' });
  });

  it('omits the skills row when the contact exposes none', () => {
    const el = renderContactThread(document.createElement('div'), { name: 'Bot', t, skills: [] });
    expect(el.querySelector('.cc-cthread__skills')).toBeNull();
  });
});
