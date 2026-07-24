/**
 * basis v2 — member-persona card + self-view (web DOM renderers, §2 of the
 * peer-connectivity Phase-4 design).
 *
 * Two thin renderers over the shared `memberCards.js` projections — the reveal
 * logic lives in `viewAsAttributes`/`circleViewAs`, these only draw the split:
 *
 *   • renderMemberPersonaCard — tap a member row → what THIS viewer (me) sees of
 *     THAT member: the `{sees, hides}` split the host computed via `memberPersonaView`.
 *   • renderSelfViewCard — tap your own row → "how others see me": a viewer picker
 *     (each member + a stranger + an agent) plus the `{sees, hides}` split of MY
 *     attributes as the chosen viewer sees them (host computes via `selfViewSplit`).
 *
 * Pure render; the host owns the roster / policy / picked-viewer state and re-invokes
 * on each pick (the `showViewAs` rerender pattern in circleApp.js). Unit-testable
 * under happy-dom.
 *
 * Both cards surface the AMOUNT PRESET the split lands at (`handle → profile → full`,
 * the C7 reveal-state vocabulary) as a small badge — the split now carries `preset`
 * from `memberCards.js` (`revealPresetOf`), the single reveal-state home.
 */

import { revealPresetLabelKey } from '../../src/v2/memberCards.js';

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {{id?:string, handle?:string|null, realName?:string|null}} opts.member
 * @param {{sees:object[], hides:object[]}} opts.split  from `memberPersonaView`
 * @param {function} opts.t
 * @param {function} [opts.onBack]
 */
export function renderMemberPersonaCard(container, { member = {}, split = { sees: [], hides: [] }, t, onBack, resolvePicture } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-membercard');

  container.appendChild(backButton(tr, onBack));

  const title = document.createElement('h2');
  title.className = 'circle-membercard__title';
  // Legible name — but never leak the real name in the title when the split HID it
  // from this viewer: show the real name only when it's in `sees`, else the handle.
  const realNameVisible = (split.sees || []).some((a) => a.key === 'realName');
  title.textContent = (realNameVisible && member.realName)
    ? member.realName
    : (member.handle ? `@${member.handle}` : (member.id || ''));
  container.appendChild(title);

  const lede = document.createElement('p');
  lede.className = 'circle-membercard__lede';
  lede.textContent = tr('circle.memberCard.persona_lede');
  container.appendChild(lede);

  const badge = presetBadge(tr, split.preset);
  if (badge) container.appendChild(badge);

  container.appendChild(attrColumn(tr, 'sees', split.sees, resolvePicture));
  container.appendChild(attrColumn(tr, 'hides', split.hides, resolvePicture));
  return container;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {{id?:string, handle?:string|null, realName?:string|null}} opts.me
 * @param {Array<{id:string, handle?:string|null}>} [opts.members]  other members (viewer chips)
 * @param {{kind?:string, id?:string|null}} [opts.viewer]  the currently-picked viewer
 * @param {{sees:object[], hides:object[]}} opts.split  from `selfViewSplit` for `viewer`
 * @param {function} opts.t
 * @param {function} [opts.onPickViewer]
 * @param {function} [opts.onBack]
 */
export function renderSelfViewCard(container, {
  me = {}, members = [], viewer = { kind: 'stranger' }, split = { sees: [], hides: [] },
  t, onPickViewer, onBack, resolvePicture,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const pick = (v) => { if (typeof onPickViewer === 'function') onPickViewer(v); };
  container.innerHTML = '';
  container.classList.add('circle-membercard', 'circle-membercard--self');

  container.appendChild(backButton(tr, onBack));

  const title = document.createElement('h2');
  title.className = 'circle-membercard__title';
  title.textContent = tr('circle.memberCard.self_title');
  container.appendChild(title);

  const lede = document.createElement('p');
  lede.className = 'circle-membercard__lede';
  lede.textContent = tr('circle.memberCard.self_lede');
  container.appendChild(lede);

  // Viewer picker — each other member, then the generic stranger / agent (mirrors
  // the existing "View as…" picker; a member picks who to feel exposed to).
  const picker = document.createElement('div');
  picker.className = 'circle-membercard__picker';
  const chips = [
    ...members
      .filter((m) => m && m.id && m.id !== me.id)
      .map((m) => ({ id: m.id, kind: 'member', label: m.handle ? `@${m.handle}` : (m.realName || m.id) })),
    { kind: 'stranger', label: tr('circle.viewAs.stranger') },
    { kind: 'agent',    label: tr('circle.viewAs.agent') },
  ];
  for (const c of chips) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'circle-membercard__viewer';
    chip.dataset.kind = c.kind;
    if (c.id) chip.dataset.viewerId = c.id;
    const active = c.kind === viewer.kind && (c.kind !== 'member' || c.id === viewer.id);
    if (active) { chip.classList.add('is-active'); chip.setAttribute('aria-pressed', 'true'); }
    chip.textContent = c.label;
    chip.addEventListener('click', () => pick({ id: c.id, kind: c.kind }));
    picker.appendChild(chip);
  }
  container.appendChild(picker);

  const badge = presetBadge(tr, split.preset);
  if (badge) container.appendChild(badge);

  container.appendChild(attrColumn(tr, 'sees', split.sees, resolvePicture));
  container.appendChild(attrColumn(tr, 'hides', split.hides, resolvePicture));
  return container;
}

/* ── internals ── */

/**
 * The amount-preset badge (`handle → profile → full`) — surfaces how much of the persona
 * this split reveals, resolved through `t()` (invariant 8). Null preset → no badge.
 */
function presetBadge(tr, preset) {
  const labelKey = revealPresetLabelKey(preset);
  if (!labelKey) return null;
  const badge = document.createElement('div');
  badge.className = 'circle-membercard__preset';
  badge.dataset.preset = preset;
  const name = document.createElement('span');
  name.className = 'circle-membercard__preset-label';
  name.textContent = tr('circle.memberCard.preset_label');
  const value = document.createElement('span');
  value.className = 'circle-membercard__preset-value';
  value.textContent = tr(labelKey);
  badge.appendChild(name);
  badge.appendChild(value);
  return badge;
}

function backButton(tr, onBack) {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-membercard__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  return back;
}

/**
 * One "WHAT THEY SEE" / "WHAT THEY DON'T SEE" column of attribute rows. Each row
 * shows the attribute's label (via its `labelKey`) + — for a visible one — its
 * value; a hidden one shows a muted "verborgen" marker instead.
 */
function attrColumn(tr, kind, attrs, resolvePicture) {
  const col = document.createElement('div');
  col.className = `circle-membercard__col circle-membercard__col--${kind}`;
  col.dataset.col = kind;

  const heading = document.createElement('h3');
  heading.className = 'circle-membercard__col-title';
  heading.textContent = tr(kind === 'sees' ? 'circle.memberCard.sees' : 'circle.memberCard.hides');
  col.appendChild(heading);

  const list = Array.isArray(attrs) ? attrs : [];
  if (!list.length) {
    const none = document.createElement('div');
    none.className = 'circle-membercard__none';
    none.textContent = tr('circle.memberCard.none');
    col.appendChild(none);
    return col;
  }

  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'circle-membercard__attr';
    row.dataset.attr = a.key ?? '';

    const label = document.createElement('span');
    label.className = 'circle-membercard__attr-label';
    label.textContent = a.labelKey ? tr(a.labelKey) : (a.label || a.key || '');
    row.appendChild(label);

    if (a.media && kind === 'sees') {
      // A media-typed attribute (the profile picture): render the SEALED ref as an
      // <img>, resolving ref→url via the injected host resolver (fetch + unseal +
      // object-url through the circle media gateway). No resolver / a failure leaves
      // an empty <img> — never the raw ref object as text, never plaintext bytes.
      const img = document.createElement('img');
      img.className = 'circle-membercard__attr-pic';
      img.alt = a.labelKey ? tr(a.labelKey) : (a.key || '');
      if (typeof resolvePicture === 'function' && a.value) {
        Promise.resolve(resolvePicture(a.value)).then((url) => { if (url) img.src = url; }).catch(() => { /* keep empty */ });
      }
      row.appendChild(img);
    } else {
      const value = document.createElement('span');
      value.className = 'circle-membercard__attr-value';
      if (kind === 'sees') value.textContent = a.value != null && a.value !== '' ? String(a.value) : '—';
      else value.textContent = tr('circle.memberCard.hidden_marker');
      row.appendChild(value);
    }

    col.appendChild(row);
  }
  return col;
}
