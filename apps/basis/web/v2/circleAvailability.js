/**
 * basis v2 — availability (web DOM renderer).
 *
 * Cross-circle personal availability: holiday mode (away until a date) +
 * quiet hours (defer pushes in a daily window, optionally weekends all
 * day). Controlled render over a `memberAvailability`
 * (`@onderling/memberAvailability`); inputs fire `onChange(patch)`; the host
 * merges + re-renders + persists. Pure → unit-testable under happy-dom.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleAvailability(container, { availability, t, onChange, onBack, onSave, onHop } = {}) {
  const tr = translatorOr(t, 'circleAvailability.js');
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  const a = availability || {};
  const h = a.holiday || {};
  const q = a.quietHours || {};
  container.innerHTML = '';
  container.classList.add('circle-availability');

  // Back link only when a handler is supplied — the Mij tab (reached via
  // the bottom bar) omits it; sub-screens keep it.
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'circle-availability__back';
    back.textContent = tr('circle.back');
    back.addEventListener('click', () => onBack());
    container.appendChild(back);
  }

  const head = document.createElement('h2');
  head.className = 'circle-availability__title';
  head.textContent = tr('circle.availability.title');
  container.appendChild(head);

  // ── Holiday mode ──
  const hSec = section(tr('circle.availability.holiday'));
  hSec.appendChild(toggle({
    field: 'holidayActive', checked: !!h.active, label: tr('circle.availability.holiday_on'),
    onToggle: (v) => emit({ holiday: { active: v } }),
  }));
  const until = document.createElement('input');
  until.type = 'date';
  until.className = 'circle-availability__until';
  until.dataset.field = 'holidayUntil';
  if (h.until) until.value = h.until;
  until.addEventListener('change', () => emit({ holiday: { until: until.value || null } }));
  const untilLabel = document.createElement('label');
  untilLabel.className = 'circle-availability__until-row';
  const us = document.createElement('span');
  us.textContent = tr('circle.availability.holiday_until');
  untilLabel.append(us, until);
  hSec.appendChild(untilLabel);
  container.appendChild(hSec);

  // ── Quiet hours ──
  const qSec = section(tr('circle.availability.quietHours'));
  qSec.appendChild(toggle({
    field: 'quietEnabled', checked: !!q.enabled, label: tr('circle.availability.quiet_on'),
    onToggle: (v) => emit({ quietHours: { enabled: v } }),
  }));
  qSec.appendChild(timeRow({ field: 'quietFrom', value: q.from, label: tr('circle.availability.from'), onTime: (v) => emit({ quietHours: { from: v } }) }));
  qSec.appendChild(timeRow({ field: 'quietTo', value: q.to, label: tr('circle.availability.to'), onTime: (v) => emit({ quietHours: { to: v } }) }));
  qSec.appendChild(toggle({
    field: 'quietWeekends', checked: !!q.weekends, label: tr('circle.availability.weekends'),
    onToggle: (v) => emit({ quietHours: { weekends: v } }),
  }));
  container.appendChild(qSec);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-availability__save';
  save.textContent = tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  // Mij tab also surfaces the device-global Hopping stance.
  if (typeof onHop === 'function') {
    const hop = document.createElement('button');
    hop.type = 'button';
    hop.className = 'circle-availability__hop';
    hop.textContent = tr('circle.hop.title');
    hop.addEventListener('click', () => onHop());
    container.appendChild(hop);
  }

  return container;
}

function section(title) {
  const sec = document.createElement('section');
  sec.className = 'circle-availability__section';
  const h = document.createElement('h3');
  h.className = 'circle-availability__section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function toggle({ field, checked, label, onToggle }) {
  const row = document.createElement('label');
  row.className = 'circle-availability__toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.dataset.field = field;
  box.addEventListener('change', () => onToggle(box.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.append(box, span);
  return row;
}

function timeRow({ field, value, label, onTime }) {
  const row = document.createElement('label');
  row.className = 'circle-availability__time-row';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'time';
  input.className = 'circle-availability__time';
  input.dataset.field = field;
  if (value) input.value = value;
  input.addEventListener('change', () => onTime(input.value));
  row.append(span, input);
  return row;
}
