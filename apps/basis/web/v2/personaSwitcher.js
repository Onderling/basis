/**
 * basis v2 — the header switcher (web DOM renderer): which of this device's selves the app shows now. Painted from the
 * shared model (`switcherModel`): one row per self (a tick; the last one on cannot be turned off), "Alle", and each
 * self's own editor. Every act is the op the model compiles (`screen-set-personas`); the host runs it.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderPersonaSwitcher(container, { model, t, onAct, onEdit, onClose } = {}) {
  if (!container || !model) return container;
  const tr = translatorOr(t, 'personaSwitcher.js');
  container.innerHTML = '';
  container.classList.add('cc-persona-switcher');   // ADD: it paints into a borrowed card whose class carries the theme's background
  const title = document.createElement('h3');
  title.textContent = tr('circle.switcher.title');
  container.appendChild(title);
  for (const row of model.rows) {
    const line = document.createElement('div');
    line.className = 'cc-persona-switcher__row';
    line.dataset.self = row.id;
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'cc-btn cc-btn--quiet cc-persona-switcher__tick';
    tick.setAttribute('aria-pressed', String(row.on));
    tick.disabled = !row.canToggle;
    tick.textContent = `${row.on ? '☑' : '☐'} ${row.id === 'default' ? tr('circle.switcher.you') : (row.name || row.id)}`;
    tick.addEventListener('click', () => { const op = model.toggle(row.id); if (op) onAct?.(op); });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'cc-btn cc-btn--quiet cc-persona-switcher__edit';
    edit.textContent = `${tr('circle.switcher.edit')} ▸`;
    edit.addEventListener('click', () => onEdit?.(row.id));
    line.append(tick, edit);
    container.appendChild(line);
  }
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'cc-btn cc-btn--quiet cc-persona-switcher__all';
  all.disabled = model.allOn;
  all.textContent = tr('circle.switcher.all');
  all.addEventListener('click', () => onAct?.(model.all()));
  container.appendChild(all);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cc-btn cc-btn--quiet cc-persona-switcher__close';
  close.textContent = tr('circle.vandaag.done');
  close.addEventListener('click', () => onClose?.());
  container.appendChild(close);
  return container;
}
