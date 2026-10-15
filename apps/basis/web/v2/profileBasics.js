/**
 * basis v2 — the person's own basics (web DOM renderer): handle + display name, and the coarse location. Painted at
 * the top of the person's own editor (`openAboutMePanel`), where Mij's "Edit" door leads; Mij itself is the declared
 * screen (name, readings, devices) and lists no section by hand. Pure render — the host loads `getMyProfile` and
 * dispatches the stoop mutations behind the callbacks.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderProfileBasics(container, {
  profile = {},
  geocodeResult = null,
  busy = false,
  t,
  onSaveProfile,
  onGeocode,
  onSaveLocation,
  onClearLocation,
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'profileBasics.js');
  container.innerHTML = '';
  container.className = 'cc-profile';

  // ── identity (handle + display name) ────────────────────────────────────
  const idSection = section(tr('circle.profile.identity'));

  const handle = labelledInput(tr('circle.profile.handle'), profile.handle ?? '', 'cc-profile__handle');
  const display = labelledInput(tr('circle.profile.displayName'), profile.displayName ?? '', 'cc-profile__display');
  idSection.appendChild(handle.wrap);
  idSection.appendChild(display.wrap);
  const save = button(tr('circle.profile.save'), 'cc-profile__save', () => {
    if (typeof onSaveProfile === 'function') onSaveProfile({ handle: handle.input.value.trim(), displayName: display.input.value.trim() });
  });
  idSection.appendChild(save);
  container.appendChild(idSection);

  // ── location ──────────────────────────────────────────────────────────────
  const locSection = section(tr('circle.profile.location'));
  const current = document.createElement('p');
  current.className = 'cc-profile__loc-current';
  current.textContent = profile.location?.label
    ? tr('circle.profile.loc_current', { label: profile.location.label })
    : tr('circle.profile.loc_none');
  locSection.appendChild(current);
  const geoRow = document.createElement('div');
  geoRow.className = 'cc-profile__geo';
  const geoInput = document.createElement('input');
  geoInput.type = 'text';
  geoInput.className = 'cc-profile__geo-input';
  geoInput.placeholder = tr('circle.profile.geo_placeholder');
  geoRow.appendChild(geoInput);
  geoRow.appendChild(button(tr('circle.profile.geo_search'), 'cc-profile__geo-search', () => {
    const q = geoInput.value.trim();
    if (q && typeof onGeocode === 'function') onGeocode(q);
  }));
  locSection.appendChild(geoRow);
  if (geocodeResult?.label) {
    const res = document.createElement('div');
    res.className = 'cc-profile__geo-result';
    const lbl = document.createElement('span');
    lbl.textContent = geocodeResult.label;
    res.appendChild(lbl);
    res.appendChild(button(tr('circle.profile.geo_use'), 'cc-profile__geo-use', () => { if (typeof onSaveLocation === 'function') onSaveLocation(); }));
    locSection.appendChild(res);
  }
  if (profile.location?.label) {
    locSection.appendChild(button(tr('circle.profile.loc_clear'), 'cc-profile__loc-clear', () => { if (typeof onClearLocation === 'function') onClearLocation(); }));
  }
  // WHO sees the location is a disclosure on the persona layer — in this same editor, below
  const locHint = document.createElement('p');
  locHint.className = 'cc-profile__loc-disclosure-hint';
  locHint.textContent = tr('circle.profile.loc_disclosure_hint');
  locSection.appendChild(locHint);
  container.appendChild(locSection);


  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-profile__busy';
    b.textContent = tr('circle.profile.saving');
    container.appendChild(b);
  }
  return container;

  // ── helpers ──
  function section(titleText) {
    const s = document.createElement('section');
    s.className = 'cc-profile__section';
    const h = document.createElement('h3');
    h.className = 'cc-profile__section-title';
    h.textContent = titleText;
    s.appendChild(h);
    return s;
  }
  function labelledInput(labelText, value, cls) {
    const wrap = document.createElement('label');
    wrap.className = 'cc-profile__field';
    const span = document.createElement('span');
    span.className = 'cc-profile__field-label';
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.value = value;
    wrap.appendChild(span);
    wrap.appendChild(input);
    return { wrap, input };
  }
  function button(text, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
