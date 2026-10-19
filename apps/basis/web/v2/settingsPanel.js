/**
 * The settings, painted from the shared projection (`settingsProjection` over the register's `list-user-params`): a group
 * per scope, each value with its label and the control its kind takes. Paint only — every change goes back through the
 * host's `onSet(row, input)` (the one `set-param` op), which answers `{ok}` or `{errorKey}`.
 */

/**
 * @param {HTMLElement} container
 * @param {{projection: {groups: Array}, t: Function, onSet: (row: object, input: *) => Promise<{ok?: boolean, errorKey?: string}>}} a
 */
export function renderSettingsGroups(container, { projection, t, onSet }) {
  for (const g of projection?.groups ?? []) {
    const sec = document.createElement('section');
    sec.className = 'cc-settings__group';
    sec.dataset.scope = g.scope;
    const h = document.createElement('h3');
    h.textContent = t(g.labelKey);
    sec.appendChild(h);
    for (const row of g.rows) sec.appendChild(settingRow(row, { t, onSet }));
    container.appendChild(sec);
  }
}

function settingRow(row, { t, onSet }) {
  const el = document.createElement('div');
  el.className = 'cc-settings__row';
  el.dataset.param = row.key;
  const label = document.createElement('label');
  label.className = 'cc-settings__label';
  label.textContent = t(row.labelKey);
  // the raw key, small: a value whose label is missing stays findable
  const key = document.createElement('code');
  key.className = 'cc-settings__key';
  key.textContent = row.key;
  const said = document.createElement('span');
  said.className = 'cc-settings__said';
  const commit = async (input) => {
    said.textContent = '';
    const r = await onSet(row, input);
    said.textContent = r?.ok ? '✓' : t(r?.errorKey ?? 'circle.params.bad_number');
  };
  let control;
  const { kind, options, unit } = row.control;
  if (kind === 'switch') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = row.value === true;
    control.addEventListener('change', () => commit(control.checked));
  } else if (kind === 'choice') {
    control = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.value);
      opt.textContent = t(o.labelKey);
      opt.selected = o.value === row.value;
      control.appendChild(opt);
    }
    control.addEventListener('change', () => commit(options[control.selectedIndex].value));
  } else {
    control = document.createElement('input');
    control.type = kind === 'number' || kind === 'duration' ? 'number' : 'text';
    control.value = String(row.shown ?? '');
    control.addEventListener('change', () => commit(control.value));
  }
  control.className = 'cc-settings__control';
  control.dataset.param = row.key;
  label.htmlFor = control.id = `param-${row.key}`;
  el.append(label, control);
  if (kind === 'duration') { const u = document.createElement('span'); u.className = 'cc-settings__unit'; u.textContent = t(`circle.params.unit_${unit}`); el.appendChild(u); }
  if (kind === 'list') { const h = document.createElement('span'); h.className = 'cc-settings__unit'; h.textContent = t('circle.params.list_hint'); el.appendChild(h); }
  el.append(said, key);
  return el;
}
