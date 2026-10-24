/**
 * basis v2 — the person's settings (web DOM renderer), behind the gear on Mij: the home lists the declared groups and,
 * last, the door to the circles' own settings; the chooser lists the person's circles, each opening that circle's
 * settings screen. What is listed and in which order is the manifest's (`settingsHomeFor`); this only paints.
 */
import { versionLine } from '../../src/v2/versionLine.js';
import { settingsHomeFor } from '../../src/v2/settingsHome.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderSettingsHome(container, { t, onBack, onOpenGroup, onOpenPerCircle, onOpenDoor, version } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleSettingsHome.js');
  page(container, tr, tr('circle.settings_home.title'), onBack);
  const list = document.createElement('div');
  list.className = 'cc-settings__list';
  const { groups, perCircle, doors } = settingsHomeFor(basisManifest);
  for (const g of groups) list.appendChild(door(tr(g.labelKey), `cc-settings__group cc-settings__group--${g.id}`, () => onOpenGroup?.(g.id), g.id));
  if (perCircle && typeof onOpenPerCircle === 'function') list.appendChild(door(tr(perCircle.labelKey), 'cc-settings__per-circle', () => onOpenPerCircle(), perCircle.id));
  if (typeof onOpenDoor === 'function') for (const d of doors) list.appendChild(door(tr(d.labelKey), `cc-settings__door-row cc-settings__door-row--${d.id}`, () => onOpenDoor(d), d.id));
  container.appendChild(list);
  // the build this tab runs (the tag the publish baked in; '' on a dev server): "which version are you on" has an answer
  // at the foot of the settings (2026-09-19: a laptop on last week's build looked like a laptop that receives nothing)
  if (typeof version === 'string') {
    const v = document.createElement('p');
    v.className = 'cc-settings__fact cc-settings__version';
    v.textContent = versionLine(version, tr);
    container.appendChild(v);
  }
  return container;
}

/** The person's circles, each a door to that circle's own settings (never a copy of them). */
export function renderCircleSettingsChooser(container, { t, circles = [], onBack, onOpenCircle } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleSettingsHome.js');
  page(container, tr, tr('circle.settings_home.per_circle'), onBack);
  const list = document.createElement('div');
  list.className = 'cc-settings__list';
  if (!circles.length) {
    const none = document.createElement('p');
    none.className = 'cc-settings__fact';
    none.textContent = tr('circle.settings_home.no_circles');
    list.appendChild(none);
  }
  for (const c of circles) list.appendChild(door(c.name || c.id, 'cc-settings__circle', () => onOpenCircle?.(c.id), c.id));
  container.appendChild(list);
  return container;
}

function page(container, tr, titleText, onBack) {
  container.innerHTML = '';
  container.className = 'cc-mydata cc-settings';
  const header = document.createElement('div');
  header.className = 'cc-mydata__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-mydata__back';
    back.textContent = tr('circle.mydata.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const h = document.createElement('h2');
  h.className = 'cc-mydata__title';
  h.textContent = titleText;
  header.appendChild(h);
  container.appendChild(header);
}

function door(text, cls, onClick, id) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `cc-settings__row ${cls}`;
  b.dataset.id = id;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
