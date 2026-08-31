/**
 * guidedSetupPanel — the web UI for the settings chatbot (Theme B).
 *
 * Pure DOM renderer for ONE step of a guided-setup template: the bot's line +
 * the answer affordance (choice buttons / multiselect + Continue / a plain
 * Continue for statements). The host (circleApp showSettings) owns the run state
 * — it calls `submitGuidedStep` on each answer, re-renders, and on done applies
 * the policy patch + hands off to the settings form. Mirrors the other
 * `renderX(container, ctx)` components so it's happy-dom-testable.
 */

import { stepOf } from '../../src/v2/guidedSetup.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderGuidedSetup(container, { template, state, t, onAnswer, onClose } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'guidedSetupPanel.js');
  container.innerHTML = '';
  container.className = 'cc-guided';

  const head = document.createElement('div');
  head.className = 'cc-guided__head';
  const title = document.createElement('h3');
  title.className = 'cc-guided__title';
  title.textContent = tr('circle.guided.title');
  head.appendChild(title);
  if (typeof onClose === 'function') {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cc-guided__close';
    close.setAttribute('aria-label', tr('common.close'));
    close.textContent = '✕';
    close.addEventListener('click', () => onClose({ handoff: false }));
    head.appendChild(close);
  }
  container.appendChild(head);

  const step = template ? stepOf(template, state) : null;

  // End of flow — show nothing to answer; the host already applied the patch.
  if (!step) {
    const done = document.createElement('p');
    done.className = 'cc-guided__done';
    done.textContent = tr('circle.guided.applied');
    container.appendChild(done);
    return container;
  }

  // The bot's line (template content — say or ask).
  const line = document.createElement('p');
  line.className = 'cc-guided__say';
  line.textContent = step.say ?? step.ask ?? '';
  container.appendChild(line);

  const actions = document.createElement('div');
  actions.className = 'cc-guided__actions';

  if (step.ask) {
    const options = Array.isArray(step.options) ? step.options : [];
    if (step.kind === 'multiselect') {
      const list = document.createElement('div');
      list.className = 'cc-guided__multi';
      for (const opt of options) {
        const lbl = document.createElement('label');
        lbl.className = 'cc-guided__opt';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.value = opt.value;
        const span = document.createElement('span');
        span.textContent = opt.label ?? opt.value;
        lbl.append(box, span);
        list.appendChild(lbl);
      }
      container.appendChild(list);
      const cont = mkBtn(tr('circle.guided.continue'), 'primary', () => {
        const chosen = [...list.querySelectorAll('input:checked')].map((b) => b.dataset.value);
        onAnswer?.(chosen);
      });
      actions.appendChild(cont);
    } else {
      // choice — one button per option dispatches the answer immediately.
      for (const opt of options) {
        actions.appendChild(mkBtn(opt.label ?? opt.value, 'option', () => onAnswer?.(opt.value), opt.value));
      }
    }
    actions.appendChild(mkBtn(tr('circle.guided.skip'), 'secondary', () => onAnswer?.(undefined)));
  } else {
    // statement — just continue.
    actions.appendChild(mkBtn(tr(step.handoff ? 'circle.guided.open_settings' : 'circle.guided.continue'), 'primary', () => onAnswer?.(undefined)));
  }

  container.appendChild(actions);
  return container;

  function mkBtn(label, kind, onClick, value) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cc-guided__btn cc-guided__btn--${kind}`;
    if (value != null) b.dataset.value = value;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
}
