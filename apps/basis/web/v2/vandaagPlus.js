/**
 * basis v2 — Vandaag's "+" sheet (web DOM renderer): the person's own acts (the own-scope attach entries), a free line
 * at the top that fills them ("notitie: melk", "afspraak morgen 14:00 tandarts"), the fields, Save — and, opened on an
 * own row, Remove (and, for an act that shares, the contacts to share it with). Painted from the shared model (`PLUS_ACTS`); what a save, a read or a removal does is the host's.
 * Pure render.
 */
import { PLUS_ACTS, plusLabel } from '../../src/v2/vandaagPlus.js';
import { translatorOr } from '../../src/locales/translatorOr.js';
import { sectionsOf } from '../../src/v2/screenSections.js';

export function renderVandaagPlus(container, { t, actId = null, values = {}, line = '', editing = false, error = null, onPick, onSave, onRead, onRemove, onClose,
  // opened on an own row whose act shares ("Delen met…"): the contacts it can go to, and what a pick does
  shareTargets = null, onShare,
  // several selves ticked in the header: the sheet asks which one this is written as (`selves`: [{id, name}])
  selves = null, asSelf = null, onPickSelf,
  // the line named something that lives in a circle: where it lives (`[{circleId, name}]`) — opened, never acted on
  referral = null, onOpenCircle,
  // the Me actions (the manifest's `meActions`: share my card, scan) — the sheet's own section, one tap from any tab
  meActions = [], onMeAction } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'vandaagPlus.js');
  container.innerHTML = '';
  container.classList.add('circle-vandaag-plus');   // beside the host's card class (its theme colours), never over it
  const title = document.createElement('h3');
  title.textContent = tr(editing ? 'circle.vandaag.plus_edit' : 'circle.vandaag.plus');
  container.appendChild(title);
  // the sheet's DECLARED sections (`screenSections.js` plusSheet), in order, each by its id (= `data-section`)
  const sec = {};
  for (const d of sectionsOf('plusSheet')) {
    const el = document.createElement('div');
    el.className = 'circle-vandaag-plus__section';
    el.dataset.section = d.id;
    if (d.titleKey) { const h = document.createElement('h4'); h.textContent = tr(d.titleKey); el.appendChild(h); }
    container.appendChild(el);
    sec[d.id] = el;
  }
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
  const asking = Array.isArray(selves) && selves.length > 1 && !asSelf;
  if (asking) {
    const ask = document.createElement('p');
    ask.textContent = tr('circle.vandaag.plus_as');
    container.appendChild(ask);
    for (const self of selves) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__self';
      b.dataset.self = self.id;
      b.textContent = self.id === 'default' ? tr('circle.switcher.you') : (self.name || self.id);
      b.addEventListener('click', () => onPickSelf?.(self.id));
      container.appendChild(b);
    }
  } else {
    // the free line: say it; what was understood picks the act and fills the fields below (editable before Save)
    if (!editing && typeof onRead === 'function') {
      const lf = document.createElement('form');
      lf.className = 'circle-vandaag-plus__lineform';
      const li = document.createElement('input');
      li.type = 'text';
      li.className = 'circle-vandaag-plus__line';
      li.value = line ?? '';
      li.placeholder = tr('circle.vandaag.plus_line_ph');
      li.setAttribute('aria-label', tr('circle.vandaag.plus_line_ph'));
      lf.appendChild(li);
      lf.addEventListener('submit', (e) => { e.preventDefault(); onRead(li.value); });
      sec['plus-line'].appendChild(lf);
    }
  }
  if (asking) {
    /* the self is asked first */
  } else if (!act) {
    for (const a of acts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__act';
      b.dataset.act = a.id;
      b.textContent = plusLabel(tr, a);
      b.addEventListener('click', () => onPick?.(a.id));
      sec['plus-own'].appendChild(b);
      if (typeof onTogglePin === 'function') {
        const on = pinnedActIds.includes(a.id);
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'cc-btn cc-btn--ghost circle-vandaag-plus__pin';
        star.dataset.act = a.id;
        star.dataset.pinned = String(on);
        star.textContent = on ? '★' : '☆';
        star.setAttribute('aria-label', tr(on ? 'circle.vandaag.unpin' : 'circle.vandaag.pin'));
        star.addEventListener('click', () => onTogglePin(a.id));
        sec['plus-own'].appendChild(star);
      }
    }
  } else {
    const form = document.createElement('form');
    form.className = 'circle-vandaag-plus__form';
    form.dataset.act = act.id;
    const inputs = {};
    for (const f of act.fields) {
      const label = document.createElement('label');
      label.textContent = f.labelKey ? tr(f.labelKey) : f.name;
      const input = document.createElement('input');
      input.type = f.kind === 'datetime' ? 'datetime-local' : 'text';
      input.name = f.name;
      if (values?.[f.name] != null) input.value = values[f.name];
      input.className = `circle-vandaag-plus__${f.name}`;
      label.appendChild(input);
      form.appendChild(label);
      inputs[f.name] = input;
    }
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__save';
    save.textContent = tr('circle.vandaag.plus_save');
    form.appendChild(save);
    // opened on an own row: take it away
    if (editing && typeof onRemove === 'function') {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__remove';
      rm.textContent = tr('circle.vandaag.plus_remove');
      rm.addEventListener('click', () => onRemove(act.id));
      form.appendChild(rm);
    }
    // …and share it with a contact: one button per contact a pair circle connects
    if (editing && act.share && typeof onShare === 'function' && Array.isArray(shareTargets)) {
      const share = document.createElement('div');
      share.className = 'circle-vandaag-plus__share';
      const head = document.createElement('p');
      head.textContent = tr(`circle.button.${act.appOrigin}.${act.share}`);
      share.appendChild(head);
      if (!shareTargets.length) {
        const none = document.createElement('p');
        none.className = 'circle-vandaag-plus__share-none';
        none.textContent = tr('circle.vandaag.plus_share_none');
        share.appendChild(none);
      }
      for (const c of shareTargets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__share-to';
        b.dataset.contact = c.id;
        b.textContent = c.label;
        b.addEventListener('click', () => onShare(act.id, c.id));
        share.appendChild(b);
      }
      form.appendChild(share);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSave?.(act.id, Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
    });
    sec['plus-own'].appendChild(form);
  }
  // Vastgezet — on a fresh sheet: own pins choose their act here; a bookmark OPENS its circle with that op (never runs it)
  if (!editing && !asking && !act) {
    for (const p of Array.isArray(pinned) ? pinned : []) {
      const row = document.createElement('span');
      row.className = 'circle-vandaag-plus__pinned';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__pinned-open';
      b.dataset.pin = p.key;
      b.textContent = p.label;
      b.addEventListener('click', () => onOpenPin?.(p));
      row.appendChild(b);
      if (typeof onUnpin === 'function') {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'cc-btn cc-btn--ghost circle-vandaag-plus__unpin';
        x.textContent = '×';
        x.setAttribute('aria-label', tr('circle.vandaag.unpin'));
        x.addEventListener('click', () => onUnpin(p.key));
        row.appendChild(x);
      }
      sec['plus-pinned'].appendChild(row);
    }
  }
  // the Me actions — on a fresh sheet only (not while an own row is being changed, nor before the self is picked)
  if (!editing && !asking && !act) {
    for (const m of Array.isArray(meActions) ? meActions : []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__me';
      b.dataset.me = m.id;
      b.textContent = tr(m.labelKey);
      b.addEventListener('click', () => onMeAction?.(m.id));
      sec['plus-me'].appendChild(b);
    }
  }
  // a section with nothing in it is not shown (its heading over nothing would be noise)
  for (const el of Object.values(sec)) if (!el.querySelector('button, form, input')) el.hidden = true;
  if (Array.isArray(referral) && referral.length) {
    const box = document.createElement('div');
    box.className = 'circle-vandaag-plus__referral';
    for (const r of referral) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__referral-open';
      b.dataset.circleId = r.circleId;
      b.textContent = tr('circle.vandaag.plus_referral', { name: r.name || tr('circle.screens.untitled') });
      b.addEventListener('click', () => onOpenCircle?.(r.circleId));
      box.appendChild(b);
    }
    container.appendChild(box);
  }
  if (error) {
    const p = document.createElement('p');
    p.className = 'circle-vandaag-plus__error';
    p.textContent = error;
    container.appendChild(p);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cc-btn cc-btn--quiet circle-vandaag-plus__close';
  close.textContent = tr('circle.vandaag.done');
  close.addEventListener('click', () => onClose?.());
  container.appendChild(close);
  return container;
}
