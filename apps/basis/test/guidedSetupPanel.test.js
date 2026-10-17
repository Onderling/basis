/**
 * Settings chatbot panel — renders a step + feeds answers back. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderGuidedSetup } from '../web/v2/guidedSetupPanel.js';
import { DEFAULT_SETTINGS_TEMPLATE, startGuidedSetup, submitGuidedStep } from '../src/v2/guidedSetup.js';

const t = (k) => k;
const T = DEFAULT_SETTINGS_TEMPLATE;

describe('renderGuidedSetup', () => {
  it('a statement step shows the bot line + a Continue that advances (no answer)', () => {
    const onAnswer = vi.fn();
    const el = renderGuidedSetup(document.createElement('div'), { template: T, state: startGuidedSetup(T), t, onAnswer });
    expect(el.querySelector('.cc-guided__say').textContent).toMatch(/set up this circle/i);
    el.querySelector('.cc-guided__btn--primary').click();
    expect(onAnswer).toHaveBeenCalledWith(undefined);
  });

  it('a multiselect step collects the checked values on Continue', () => {
    const onAnswer = vi.fn();
    let s = startGuidedSetup(T);
    s = submitGuidedStep(T, s, undefined).state;   // → apps (multiselect)
    const el = renderGuidedSetup(document.createElement('div'), { template: T, state: s, t, onAnswer });
    el.querySelector('input[data-value="pinboard"]').checked = true;
    el.querySelector('input[data-value="tasks"]').checked = true;
    el.querySelector('.cc-guided__btn--primary').click();
    expect(onAnswer).toHaveBeenCalledWith(['pinboard', 'tasks']);
  });

  it('a choice step dispatches the chosen value immediately', () => {
    const onAnswer = vi.fn();
    let s = startGuidedSetup(T);
    s = submitGuidedStep(T, s, undefined).state;       // apps
    s = submitGuidedStep(T, s, ['pinboard']).state;       // → storage (choice)
    const el = renderGuidedSetup(document.createElement('div'), { template: T, state: s, t, onAnswer });
    el.querySelector('.cc-guided__btn--option[data-value="p2"]').click();
    expect(onAnswer).toHaveBeenCalledWith('p2');
  });

  it('close fires onClose', () => {
    const onClose = vi.fn();
    const el = renderGuidedSetup(document.createElement('div'), { template: T, state: startGuidedSetup(T), t, onClose });
    el.querySelector('.cc-guided__close').click();
    expect(onClose).toHaveBeenCalled();
  });
});
