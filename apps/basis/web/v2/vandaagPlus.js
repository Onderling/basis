/**
 * basis v2 — Vandaag's "+" sheet (web DOM renderer): pick an own note or an own appointment, fill it in, save. Painted
 * from the shared model (`PLUS_ACTS`); what a save does is the host's (`onSave(actId, values)` → null, or the line to
 * show). Pure render.
 */
import { PLUS_ACTS, plusLabel } from '../../src/v2/vandaagPlus.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderVandaagPlus(container, { t, actId = null, error = null, onPick, onSave, onClose,
  // several selves ticked in the header: the sheet asks which one this is written as (`selves`: [{id, name}])
  selves = null, asSelf = null, onPickSelf } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'vandaagPlus.js');
  container.innerHTML = '';
  container.className = 'circle-vandaag-plus';
  const title = document.createElement('h3');
  title.textContent = tr('circle.vandaag.plus');
  container.appendChild(title);
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
  if (Array.isArray(selves) && selves.length > 1 && !asSelf) {
    const ask = document.createElement('p');
    ask.textContent = tr('circle.vandaag.plus_as');
    container.appendChild(ask);
    for (const self of selves) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'circle-vandaag-plus__self';
      b.dataset.self = self.id;
      b.textContent = self.id === 'default' ? tr('circle.switcher.you') : (self.name || self.id);
      b.addEventListener('click', () => onPickSelf?.(self.id));
      container.appendChild(b);
    }
  } else if (!act) {
    for (const a of PLUS_ACTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'circle-vandaag-plus__act';
      b.dataset.act = a.id;
      b.textContent = plusLabel(tr, a);
      b.addEventListener('click', () => onPick?.(a.id));
      container.appendChild(b);
    }
  } else {
    const form = document.createElement('form');
    form.className = 'circle-vandaag-plus__form';
    form.dataset.act = act.id;
    const inputs = {};
    for (const f of act.fields) {
      const label = document.createElement('label');
      label.textContent = tr(f.labelKey);
      const input = document.createElement('input');
      input.type = f.kind === 'datetime' ? 'datetime-local' : 'text';
      input.name = f.name;
      input.className = `circle-vandaag-plus__${f.name}`;
      label.appendChild(input);
      form.appendChild(label);
      inputs[f.name] = input;
    }
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'circle-vandaag-plus__save';
    save.textContent = tr('circle.vandaag.plus_save');
    form.appendChild(save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSave?.(act.id, Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
    });
    container.appendChild(form);
  }
  if (error) {
    const p = document.createElement('p');
    p.className = 'circle-vandaag-plus__error';
    p.textContent = error;
    container.appendChild(p);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'circle-vandaag-plus__close';
  close.textContent = tr('circle.vandaag.done');
  close.addEventListener('click', () => onClose?.());
  container.appendChild(close);
  return container;
}
