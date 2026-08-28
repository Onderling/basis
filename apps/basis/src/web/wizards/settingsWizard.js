/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — /settings panel renderer (2026-05-24).
 *
 * Brings the per-app settings that used to live as individual slash
 * commands into a single grouped panel:
 *
 *   - General      — locale (EN/NL), transport mode (NKN / relay / both)
 *   - Stoop        — handle + displayName + holiday-mode toggle
 *   - Privacy      — clear ContactBook + show mute list (read-only)
 *
 * The panel is opened via the /settings slash → surfaces.page side-panel.
 * Each control wires its own substrate skill (or chat-shell built-in
 * for language) — no monolithic dispatch.
 */

import {
  LANG_OPTIONS, TRANSPORT_MODES,
  initialState, loadSettings,
  saveHandle, saveDisplayName, setHolidayMode,
} from '../../core/wizards/settingsState.js';
import { t } from '../../localisation.js';

export function renderSettingsWizard(opts) {
  const { container, doc, callSkill, onClose, getLang, setLang } = opts;
  const state = { ...initialState(), saving: {} };

  loadSettings({ state, callSkill })
    .then(rerender)
    .catch((err) => {
      state.loading   = false;
      state.loadError = err?.message ?? String(err);
      rerender();
    });

  rerender();

  function rerender() {
    container.innerHTML = '';
    const body = doc.createElement('div');
    body.className = 'cc-settings-panel';

    if (state.loading) {
      const note = doc.createElement('div');
      note.className = 'cc-wizard-blurb';
      note.textContent = t('wizard.settings.loading');
      body.appendChild(note);
      container.appendChild(body);
      return;
    }

    body.appendChild(renderSection(doc, t('wizard.settings.general'), [
      renderLangControl(doc, state, getLang, setLang, rerender),
      renderTransportControl(doc, opts),
    ]));

    body.appendChild(renderSection(doc, t('wizard.settings.circle'), [
      renderHandleControl(doc, state, callSkill, rerender),
      renderDisplayNameControl(doc, state, callSkill, rerender),
      renderHolidayControl(doc, state, callSkill, rerender),
    ]));

    body.appendChild(renderSection(doc, t('wizard.settings.about'), [
      renderInfo(doc, 'peer address',
        opts.getMyPeerAddr ? (opts.getMyPeerAddr() ?? '(not connected)') : '(unknown)'),
    ]));

    container.appendChild(body);

    const actions = doc.createElement('div');
    actions.className = 'cc-wizard-actions';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'cc-wizard-btn cc-wizard-btn-primary';
    close.textContent = t('wizard.settings.close');
    close.addEventListener('click', onClose);
    actions.appendChild(close);
    container.appendChild(actions);
  }
}

/* ─── sections + controls ─────────────────────────────────── */

function renderSection(doc, title, controls) {
  const sec = doc.createElement('section');
  sec.className = 'cc-settings-section';
  const h = doc.createElement('h3');
  h.className = 'cc-settings-section-title';
  h.textContent = title;
  sec.appendChild(h);
  for (const c of controls) if (c) sec.appendChild(c);
  return sec;
}

function renderLangControl(doc, state, getLang, setLang, rerender) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const label = doc.createElement('label');
  label.className = 'cc-settings-label';
  label.textContent = t('wizard.settings.language');
  row.appendChild(label);
  const cur = (typeof getLang === 'function') ? getLang() : 'en';
  const select = doc.createElement('select');
  select.className = 'cc-settings-control';
  for (const { code, name } of LANG_OPTIONS) {
    const opt = doc.createElement('option');
    opt.value = code;
    opt.textContent = name;
    if (code === cur) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', async () => {
    if (typeof setLang === 'function') {
      await setLang(select.value);
      rerender();
    }
  });
  row.appendChild(select);
  return row;
}

function renderTransportControl(doc, opts) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const label = doc.createElement('label');
  label.className = 'cc-settings-label';
  label.textContent = t('wizard.settings.transport');
  row.appendChild(label);
  const select = doc.createElement('select');
  select.className = 'cc-settings-control';
  const cur = (typeof opts.getTransportMode === 'function')
    ? (opts.getTransportMode() ?? 'nkn') : 'nkn';
  for (const m of TRANSPORT_MODES) {
    const o = doc.createElement('option');
    o.value = m; o.textContent = m.toUpperCase();
    if (m === cur) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    try { opts.setTransportMode?.(select.value); } catch { /* swallow */ }
  });
  row.appendChild(select);
  return row;
}

function renderHandleControl(doc, state, callSkill, rerender) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const label = doc.createElement('label');
  label.className = 'cc-settings-label';
  label.textContent = t('wizard.settings.handle');
  row.appendChild(label);
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'cc-settings-control';
  input.value = state.profile?.handle ?? '';
  input.placeholder = t('wizard.settings.handle_hint');
  const save = doc.createElement('button');
  save.type = 'button';
  save.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  save.textContent = t('wizard.settings.save');
  save.addEventListener('click', async () => {
    save.disabled = true;
    const r = await saveHandle({ callSkill, handle: input.value });
    if (r.ok) {
      save.textContent = '✓';
      setTimeout(() => { save.textContent = t('wizard.settings.save'); save.disabled = false; }, 1500);
    } else {
      save.textContent = '✗';
      setTimeout(() => { save.textContent = t('wizard.settings.save'); save.disabled = false; }, 2000);
    }
  });
  row.appendChild(input);
  row.appendChild(save);
  return row;
}

function renderDisplayNameControl(doc, state, callSkill, rerender) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const label = doc.createElement('label');
  label.className = 'cc-settings-label';
  label.textContent = t('wizard.settings.display_name');
  row.appendChild(label);
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'cc-settings-control';
  input.value = state.profile?.displayName ?? '';
  input.placeholder = t('wizard.settings.display_hint');
  const save = doc.createElement('button');
  save.type = 'button';
  save.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  save.textContent = t('wizard.settings.save');
  save.addEventListener('click', async () => {
    save.disabled = true;
    const r = await saveDisplayName({ callSkill, displayName: input.value });
    if (r.ok) {
      save.textContent = '✓';
      setTimeout(() => { save.textContent = t('wizard.settings.save'); save.disabled = false; }, 1500);
    } else {
      save.textContent = '✗';
      setTimeout(() => { save.textContent = t('wizard.settings.save'); save.disabled = false; }, 2000);
    }
  });
  row.appendChild(input);
  row.appendChild(save);
  return row;
}

function renderHolidayControl(doc, state, callSkill, rerender) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const label = doc.createElement('label');
  label.className = 'cc-settings-label';
  label.textContent = t('wizard.settings.holiday');
  row.appendChild(label);
  const toggle = doc.createElement('label');
  toggle.className = 'cc-settings-toggle';
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.checked = !!state.holiday;
  box.addEventListener('change', async () => {
    box.disabled = true;
    const r = await setHolidayMode({ callSkill, on: box.checked });
    if (r.ok) {
      state.holiday = r.holidayMode;
    } else {
      box.checked = !box.checked;   // revert
    }
    box.disabled = false;
  });
  toggle.appendChild(box);
  toggle.appendChild(doc.createTextNode(' Suppress notifications + mark me unavailable.'));
  row.appendChild(toggle);
  return row;
}

function renderInfo(doc, label, value) {
  const row = doc.createElement('div');
  row.className = 'cc-settings-row';
  const lab = doc.createElement('span');
  lab.className = 'cc-settings-label';
  lab.textContent = label;
  const val = doc.createElement('code');
  val.className = 'cc-settings-info';
  val.textContent = value;
  row.appendChild(lab);
  row.appendChild(val);
  return row;
}
