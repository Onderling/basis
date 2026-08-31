/**
 * basis v2 — "View as…" preview (web DOM renderer).
 *
 * A read-only directory preview: pick a viewer (each member, plus a
 * generic "stranger" + "agent"), and the member list re-renders showing
 * what THAT viewer would see under the circle's reveal policy. Pure render
 * over the shared `viewAsDirectory` projection; the host supplies members +
 * policy + the current viewer and handles `onPickViewer`. Unit-testable
 * under happy-dom.
 */
import { viewAsDirectory, VIEWER_KINDS } from '../../src/v2/circleViewAs.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleViewAs(container, {
  members = [],
  policy = 'pairwise',
  viewer = { kind: 'stranger' },
  t,
  onPickViewer,
  onBack,
} = {}) {
  const tr = translatorOr(t, 'circleViewAs.js');
  const pick = (v) => { if (typeof onPickViewer === 'function') onPickViewer(v); };
  container.innerHTML = '';
  container.classList.add('circle-viewas');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-viewas__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-viewas__title';
  head.textContent = tr('circle.viewAs.title');
  container.appendChild(head);

  // Viewer picker: members first, then the generic stranger / agent.
  const picker = document.createElement('div');
  picker.className = 'circle-viewas__picker';
  const chips = [
    ...members.map((m) => ({ id: m.id, kind: 'member', label: m.handle || m.id })),
    { kind: 'stranger', label: tr('circle.viewAs.stranger') },
    { kind: 'agent',    label: tr('circle.viewAs.agent') },
  ];
  for (const c of chips) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'circle-viewas__viewer';
    chip.dataset.kind = c.kind;
    if (c.id) chip.dataset.viewerId = c.id;
    const active = c.kind === viewer.kind && (c.kind !== 'member' || c.id === viewer.id);
    if (active) chip.setAttribute('aria-pressed', 'true');
    chip.textContent = c.label;
    chip.addEventListener('click', () => pick({ id: c.id, kind: c.kind }));
    picker.appendChild(chip);
  }
  container.appendChild(picker);

  const rows = viewAsDirectory({ members, viewer, policy });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-viewas__empty';
    empty.textContent = tr('circle.viewAs.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-viewas__list';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'circle-viewas__row';
    row.dataset.memberId = r.id;
    row.dataset.revealed = r.revealed ? 'true' : 'false';

    const name = document.createElement('span');
    name.className = 'circle-viewas__name';
    name.textContent = r.displayName;
    row.appendChild(name);

    const badge = document.createElement('span');
    badge.className = 'circle-viewas__badge';
    badge.textContent = r.revealed ? tr('circle.viewAs.revealed') : tr('circle.viewAs.hidden');
    row.appendChild(badge);

    list.appendChild(row);
  }
  container.appendChild(list);

  return container;
}

export { VIEWER_KINDS };
