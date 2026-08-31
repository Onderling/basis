/**
 * basis v2 — skill editor (web DOM renderer).
 *
 * Controlled render of a skill's four axes (`@onderling/circleOfferings`):
 * openness · posture · status · radius. Each axis is a single-choice radio
 * group (mirrors circleSettings' enum axes); selecting an option fires
 * `onChange({ [axis]: value })` and the host merges + re-renders. A Save
 * button fires `onSave`, Back fires `onBack`. Pure render → unit-testable
 * under happy-dom. Local discovery is out of scope for this slice.
 */
import { OFFERING_AXES } from '@onderling/kring-host/circleOfferings';
import { translatorOr } from '../../src/locales/translatorOr.js';

const AXES = ['openness', 'posture', 'status', 'radius'];

export function renderOfferingEditor(container, {
  skill, t, onChange, onBack, onSave,
} = {}) {
  const tr = translatorOr(t, 'circleOfferingEditor.js');
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-offering');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-offering__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-offering__title';
  head.textContent = tr('circle.offerings.editor_title');
  container.appendChild(head);

  for (const axis of AXES) {
    const sec = document.createElement('section');
    sec.className = 'circle-offering__axis';
    sec.dataset.axis = axis;

    const h = document.createElement('h3');
    h.className = 'circle-offering__axis-title';
    h.textContent = tr(`circle.offerings.axis.${axis}`);
    sec.appendChild(h);

    for (const opt of OFFERING_AXES[axis]) {
      const label = document.createElement('label');
      label.className = 'circle-offering__opt';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = axis;
      radio.value = opt;
      radio.checked = skill?.[axis] === opt;
      radio.addEventListener('change', () => { if (radio.checked) emit({ [axis]: opt }); });
      const span = document.createElement('span');
      span.textContent = tr(`circle.offerings.opt.${opt}`);
      label.append(radio, span);
      sec.appendChild(label);
    }
    container.appendChild(sec);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-offering__save';
  save.textContent = tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}
