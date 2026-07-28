/**
 * basis v2 — profile editor (web DOM renderer, S2 — identity + matching).
 *
 * The "Mij" surface: your handle + display name (#5) and your coarse location
 * (#7). Pure render — the host (`circleApp.js` showMij) loads `getMyProfile`
 * and dispatches the stoop mutations behind the callbacks.
 *
 * Offering→property fold-in phase C (2026-07-17, NOTE-skills-properties-audit §3c):
 * the personal-offering editor (`cc-profile__offering*` + onAddOffering/onRemoveOffering)
 * LEFT this screen — offerings are driver-like items on the persona truth layer
 * now (`circleMij.js`, "Mij → persona's"). A quiet pointer row (`onOpenMij`)
 * replaces it. NOT to be confused with `showSkills` (the circle's openness
 * *policy* surface, circleOfferingEditor.js — a different feature, untouched).
 *
 * D / consumer-switch (second live surface) — the "Mij" (Me) screen
 * header is sourced from the manifest PAGE projection: the `me` op declares
 * `surfaces.page`, renderWeb projects it into NavModel.pages[], and the header
 * label flows `page.labelKey → t()` via the shared `pageLabel` selector — not a
 * hardcoded tr('circle.profile.title'). Pure selector lives in shared src.
 */
import { pageLabel } from '../../src/v2/pageProjection.js';

export function renderCircleProfile(container, {
  profile = {},
  geocodeResult = null,
  busy = false,
  t,
  onSaveProfile,
  // Fold-in phase C — open the "Mij → persona's" surface (where offerings live now).
  // Absent ⇒ the pointer renders as plain text (older callers / tests).
  onOpenMij,
  onGeocode,
  onSaveLocation,
  onClearLocation,
  onAvailability,
  onMyData,
  // Nearby step I — the connection-point list. Absent ⇒ the link is simply omitted, like the others.
  onConnectionPoints,
  // SILENT out-of-circle delivery — open the personal, cross-circle "shared with me"
  // inbox (sealed copies peers pushed to this device). A Mij sub-screen link, peer of
  // availability/my-data. Absent ⇒ the link is simply omitted (older callers / tests).
  onSharedWithMe,
  // D / consumer-switch — the projected PAGE surface for the `me` op
  // (renderWeb(manifest).pages[] entry, selected via pageForOp). When present,
  // the header label is derived from `page.labelKey` via t, making this
  // a genuine runtime consumer of the manifest projection. Absent (older callers
  // / tests) ⇒ the header falls back to tr('circle.profile.title') bit-for-bit.
  profilePage = null,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-profile';

  const heading = document.createElement('h2');
  heading.className = 'cc-profile__title';
  // D / consumer-switch — label FROM the manifest projection: the `me`
  // op's `surfaces.page.labelKey`, projected by renderWeb, resolved through t()
  // . Falls back to the raw page.title, then to the pre-existing
  // tr('circle.profile.title') when no projected page is passed.
  heading.textContent = pageLabel(profilePage, tr, tr('circle.profile.title'));
  container.appendChild(heading);

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

  // ── offerings — moved (fold-in phase C, 2026-07-17) ──────────────────────
  // A single quiet pointer to the "Mij → persona's" surface where offerings live
  // now. Clickable when the host wires onOpenMij; plain text otherwise.
  const moved = document.createElement('p');
  moved.className = 'cc-profile__offerings-moved';
  if (typeof onOpenMij === 'function') {
    moved.appendChild(button(tr('circle.profile.offerings_moved'), 'cc-profile__offerings-moved-link', onOpenMij));
  } else {
    moved.textContent = tr('circle.profile.offerings_moved');
  }
  container.appendChild(moved);

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
  // location fold-in (audit §4) — this geo editor stays (it sets the coarse place),
  // but WHO sees your location is now a disclosure-controlled property on the Mij
  // persona layer. A quiet pointer (like offerings' onOpenMij), never a removal.
  const locHint = document.createElement('p');
  locHint.className = 'cc-profile__loc-disclosure-hint';
  if (typeof onOpenMij === 'function') {
    locHint.appendChild(button(tr('circle.profile.loc_disclosure_hint'), 'cc-profile__loc-disclosure-link', onOpenMij));
  } else {
    locHint.textContent = tr('circle.profile.loc_disclosure_hint');
  }
  locSection.appendChild(locHint);
  container.appendChild(locSection);

  // ── availability + my-data links ──────────────────────────────────────────
  if (typeof onAvailability === 'function') {
    const avail = button(tr('circle.profile.availability'), 'cc-profile__availability', onAvailability);
    container.appendChild(avail);
  }
  if (typeof onMyData === 'function') {
    const myData = button(tr('circle.profile.mydata'), 'cc-profile__mydata', onMyData);
    container.appendChild(myData);
  }
  if (typeof onConnectionPoints === 'function') {
    const points = button(
      tr('circle.nearbyScreen.points_open'), 'cc-profile__connection-points', onConnectionPoints,
    );
    container.appendChild(points);
  }
  if (typeof onSharedWithMe === 'function') {
    const shared = button(tr('circle.profile.sharedWithMe'), 'cc-profile__shared-with-me', onSharedWithMe);
    container.appendChild(shared);
  }

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
