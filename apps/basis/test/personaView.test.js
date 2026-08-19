/**
 * personas#1 — the "About me" persona surface: the shared read-model
 * (buildPersonaViewModel) + the web renderer (renderAboutMe), and the
 * "Mij → persona's" bulletin surface (buildMijViewModel + renderMij).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { buildPersonaViewModel, buildMijViewModel, PROPERTY_LADDERS } from '../src/v2/personaView.js';
import { renderAboutMe } from '../web/v2/circleAboutMe.js';
import { renderMij } from '../web/v2/circleMij.js';
import { attributeKeys } from '@onderling/attribute-charter';

// Minimal t(): return the key with any {{placeholder}} substituted (mirrors the
// app's i18n enough for structural assertions; exact copy isn't under test).
const t = (k, v) => {
  let s = k;
  if (v && typeof v === 'object') {
    for (const [kk, vv] of Object.entries(v)) {
      if (kk === 'defaultValue') continue;
      s = s.replace(new RegExp(`{{${kk}}}`, 'g'), String(vv));
    }
  }
  return s;
};

const view = {
  ok: true,
  id: 'persona-a',
  properties: { place: 'Amsterdam', ageBand: '35-54' },
  disclosure: { perContext: { 'circle-1': { place: { enabled: true, rung: null } } } },
};
const circles = [{ id: 'circle-1', name: 'Circle' }, { id: 'circle-2', name: 'Werk' }];

describe('buildPersonaViewModel', () => {
  it('lists every charter attribute with the persona value or null', () => {
    const m = buildPersonaViewModel({ view, circles });
    expect(m.ok).toBe(true);
    expect(m.id).toBe('persona-a');
    expect(m.properties.map((p) => p.key).sort()).toEqual(attributeKeys().sort());
    const place = m.properties.find((p) => p.key === 'place');
    expect(place.value).toBe('Amsterdam');
    expect(place.free).toBe(true);          // place = open-coarse (free text)
    expect(place.buckets).toBe(null);
    const age = m.properties.find((p) => p.key === 'ageBand');
    expect(age.value).toBe('35-54');
    expect(age.buckets).toContain('35-54'); // enum → buckets
    const role = m.properties.find((p) => p.key === 'role');
    expect(role.value).toBe(null);          // unset
    expect(role.set).toBe(false);
  });

  it('defaults sharing to WITHHOLD and only offers valued properties', () => {
    const m = buildPersonaViewModel({ view, circles });
    expect(m.circles.map((c) => c.circleId)).toEqual(['circle-1', 'circle-2']);
    const c1 = m.circles[0];
    // Only place + ageBand have values → only those are togglable rows.
    expect(c1.rows.map((r) => r.key).sort()).toEqual(['ageBand', 'place']);
    const place = c1.rows.find((r) => r.key === 'place');
    expect(place.enabled).toBe(true);       // persisted policy enabled place in circle-1
    const age = c1.rows.find((r) => r.key === 'ageBand');
    expect(age.enabled).toBe(false);        // default withhold
    // Honest summary: circle-1 sees only place; circle-2 sees nothing.
    expect(c1.sharedKeys).toEqual(['place']);
    expect(m.circles[1].sharedKeys).toEqual([]);
  });

  it('reports not-ok for a degraded reply', () => {
    const m = buildPersonaViewModel({ view: { ok: false, reason: 'profiles-unavailable' }, circles });
    expect(m.ok).toBe(false);
    expect(m.reason).toBe('profiles-unavailable');
  });
});

describe('renderAboutMe', () => {
  it('renders the property pickers and fires onSetProperty', () => {
    const onSetProperty = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onSetProperty });
    // ageBand buckets render as buttons; the current one is active.
    const active = el.querySelector('.cc-aboutme__bucket--active');
    expect(active.textContent).toBe('35-54');
    // Click a different bucket → onSetProperty(key, bucket).
    const buttons = [...el.querySelectorAll('.cc-aboutme__prop[data-key="ageBand"] .cc-aboutme__bucket')];
    const other = buttons.find((b) => b.textContent === '18-34');
    other.click();
    expect(onSetProperty).toHaveBeenCalledWith('ageBand', '18-34');
  });

  it('place renders a free-text field that saves the trimmed value', () => {
    const onSetProperty = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onSetProperty });
    const input = el.querySelector('.cc-aboutme__prop[data-key="place"] .cc-aboutme__prop-input');
    expect(input.value).toBe('Amsterdam');
    input.value = '  Utrecht  ';
    el.querySelector('.cc-aboutme__prop[data-key="place"] .cc-aboutme__prop-save').click();
    expect(onSetProperty).toHaveBeenCalledWith('place', 'Utrecht');
  });

  it('shows the honest per-circle summary and toggles disclosure', () => {
    const onToggleDisclosure = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onToggleDisclosure });
    const cards = [...el.querySelectorAll('.cc-aboutme__circle')];
    expect(cards).toHaveLength(2);
    // circle-1: place checkbox is checked (persisted), ageBand unchecked (withheld).
    const c1 = el.querySelector('.cc-aboutme__circle[data-circle-id="circle-1"]');
    const placeBox = c1.querySelector('.cc-aboutme__toggle-box[data-key="place"]');
    expect(placeBox.checked).toBe(true);
    const ageBox = c1.querySelector('.cc-aboutme__toggle-box[data-key="ageBand"]');
    expect(ageBox.checked).toBe(false);
    // Toggling ageBand on fires onToggleDisclosure(circleId, key, true).
    ageBox.checked = true;
    ageBox.dispatchEvent(new window.Event('change'));
    expect(onToggleDisclosure).toHaveBeenCalledWith('circle-1', 'ageBand', true);
  });

  it('renders an unavailable notice for a not-ok model', () => {
    const m = buildPersonaViewModel({ view: { ok: false }, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t });
    expect(el.querySelector('.cc-aboutme__empty')).toBeTruthy();
  });
});

describe('buildPersonaViewModel — drivers (#5)', () => {
  it('surfaces driver-typed properties separately from coarse attributes', async () => {
    const { buildPersonaViewModel } = await import('../src/v2/personaView.js');
    const { createDriver } = await import('@onderling/agent-registry');
    const view = {
      ok: true, id: 'default',
      properties: {
        place: 'Groningen',                                                  // coarse-enum
        sailing: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing'] }),
      },
      disclosure: { perContext: {} },
    };
    const model = buildPersonaViewModel({ view, circles: [] });
    expect(model.drivers).toEqual([{ key: 'sailing', kind: 'goal', text: 'learn to sail', tags: ['sailing'] }]);
    // the coarse attribute is NOT in drivers, and the driver is NOT in the coarse property picker
    expect(model.properties.find((p) => p.key === 'sailing')).toBeUndefined();
  });

  it('no drivers → empty array', async () => {
    const { buildPersonaViewModel } = await import('../src/v2/personaView.js');
    const model = buildPersonaViewModel({ view: { ok: true, id: 'x', properties: { place: 'Groningen' }, disclosure: { perContext: {} } }, circles: [] });
    expect(model.drivers).toEqual([]);
  });

  it('accepts the live registry own/inherit map shape (mode entries)', () => {
    const model = buildPersonaViewModel({
      view: {
        ok: true, id: 'default',
        properties: {
          place:   { mode: 'own', value: 'Amsterdam' },
          ageBand: { mode: 'inherit' },     // unresolvable from a single-profile view → unset
          sailing: { mode: 'own', value: { kind: 'goal', text: 'learn to sail', tags: ['sailing'] } },
        },
        disclosure: { perContext: {} },
      },
      circles: [],
    });
    expect(model.properties.find((p) => p.key === 'place').value).toBe('Amsterdam');
    expect(model.properties.find((p) => p.key === 'ageBand').value).toBe(null);
    expect(model.drivers).toEqual([{ key: 'sailing', kind: 'goal', text: 'learn to sail', tags: ['sailing'] }]);
  });
});

/* ── Mij → persona's ──────────────────────────────────────────────────────── */

const mijPersonas = [
  {
    id: 'default', name: 'default',
    properties: {
      place:   { mode: 'own', value: 'Amsterdam' },
      ageBand: { mode: 'own', value: '35-54' },
      zeilen:  { mode: 'own', value: { kind: 'hobby', text: 'leren zeilen', tags: ['zeilen', 'water'] } },
    },
    disclosure: { perContext: { 'circle-1': { place: { enabled: true, rung: 'municipality' }, ageBand: { enabled: false } } } },
  },
  {
    id: 'werk', name: 'Werk',
    properties: {
      place:   { mode: 'own', value: 'Utrecht' },   // override
      ageBand: { mode: 'inherit' },                  // declared inherit
      // role/tenure/household/zeilen undeclared → implicit inherit / absent
    },
    disclosure: { perContext: { 'circle-2': { place: { enabled: true, rung: null } } } },
  },
];
const mijCircles = [
  { id: 'circle-1', name: 'Circle', charter: { requests: [{ key: 'place', maxRung: 'municipality', purpose: 'spreiding' }] } },
  { id: 'circle-2', name: 'Werkclub' },
];
const mijReleases = {
  default: { 'circle-1': { place: 'Amsterdam' } },
  werk:    { 'circle-2': { place: 'Utrecht' } },
};

describe('buildMijViewModel', () => {
  it('builds the general (truth-layer) section with ladder hints + skills chips', () => {
    const m = buildMijViewModel({ personas: mijPersonas, circles: mijCircles, releases: mijReleases });
    expect(m.ok).toBe(true);
    expect(m.defaultId).toBe('default');
    const place = m.general.properties.find((p) => p.key === 'place');
    expect(place.value).toBe('Amsterdam');
    expect(place.ladder).toEqual(PROPERTY_LADDERS.place);
    // every charter attribute gets a row + the folded-in availability & location rows, each with a ladder
    expect(m.general.properties.map((p) => p.key).sort()).toEqual([...attributeKeys(), 'availability', 'location'].sort());
    for (const p of m.general.properties) expect(Array.isArray(p.ladder)).toBe(true);
    // the driver shows as a chip entry, not as a coarse property
    expect(m.general.drivers).toHaveLength(1);
    expect(m.general.drivers[0]).toMatchObject({ key: 'zeilen', kind: 'hobby', text: 'leren zeilen', tags: ['zeilen', 'water'] });
    expect(m.general.properties.find((p) => p.key === 'zeilen')).toBeUndefined();
  });

  it('marks per persona per key: own / inherit (declared + implicit) / absent', () => {
    const m = buildMijViewModel({ personas: mijPersonas, circles: [], releases: {} });
    const werk = m.personas.find((p) => p.id === 'werk');
    expect(werk.isDefault).toBe(false);
    const entry = (k) => werk.entries.find((e) => e.key === k);
    expect(entry('place')).toMatchObject({ state: 'own', value: 'Utrecht' });          // override
    expect(entry('ageBand')).toMatchObject({ state: 'inherit', value: '35-54' });      // declared inherit
    expect(entry('zeilen')).toMatchObject({ state: 'inherit', value: 'leren zeilen' }); // implicit inherit (undeclared)
    expect(entry('role').state).toBe('absent');                                        // nothing anywhere → ∅
    // the root card is marked and holds its own values
    const root = m.personas.find((p) => p.id === 'default');
    expect(root.isDefault).toBe(true);
    expect(root.entries.find((e) => e.key === 'place')).toMatchObject({ state: 'own', value: 'Amsterdam' });
    expect(root.entries.find((e) => e.key === 'role').state).toBe('absent');
  });

  it('builds the per-circle table: persona × key × rung × released value + charter + addable', () => {
    const m = buildMijViewModel({ personas: mijPersonas, circles: mijCircles, releases: mijReleases });
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    // only ENABLED entries become rows (ageBand enabled:false stays out)
    expect(c1.rows).toEqual([
      { personaId: 'default', personaName: 'default', key: 'place', rung: 'municipality', released: 'Amsterdam', l10n: null },
    ]);
    expect(c1.charter).toEqual({ requests: [{ key: 'place', maxRung: 'municipality', purpose: 'spreiding' }] });
    // addable = the general persona's valued keys not yet shared here
    expect(c1.addable.sort()).toEqual(['ageBand', 'zeilen']);
    const c2 = m.circles.find((c) => c.circleId === 'circle-2');
    expect(c2.rows).toEqual([
      { personaId: 'werk', personaName: 'Werk', key: 'place', rung: null, released: 'Utrecht', l10n: null },
    ]);
    expect(c2.charter).toBe(null);   // no charter → clean empty state
  });

  it('reports not-ok without a default persona', () => {
    const m = buildMijViewModel({ personas: [], circles: mijCircles });
    expect(m.ok).toBe(false);
  });

  it('renders availability as a unified coarse-enum property row (Q5)', () => {
    // an availability value on the default profile surfaces as a general property row
    const personas = [{
      id: 'default', name: 'default',
      properties: { availability: { mode: 'own', value: 'away' } },
      disclosure: { perContext: {} },
    }];
    const m = buildMijViewModel({ personas, circles: mijCircles, releases: {} });
    const avail = m.general.properties.find((p) => p.key === 'availability');
    expect(avail).toMatchObject({
      key: 'availability', value: 'away', free: false, set: true, l10n: 'circle.mij.availability',
    });
    expect(avail.buckets).toEqual(['open', 'limited', 'away']);
    // it is shareable per circle like any valued property (disclosure-controlled)
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    expect(c1.addable).toContain('availability');
  });

  it('availability is absent (unset) when the profile has no value', () => {
    const m = buildMijViewModel({ personas: mijPersonas, circles: mijCircles, releases: mijReleases });
    const avail = m.general.properties.find((p) => p.key === 'availability');
    expect(avail).toMatchObject({ key: 'availability', value: null, set: false });
    // an unset property is not offered for sharing
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    expect(c1.addable).not.toContain('availability');
  });

  it('availability polish 1 — exposes the detail rung + an optional free-text "when"', () => {
    const bare = buildMijViewModel({
      personas: [{ id: 'default', name: 'default', properties: { availability: { mode: 'own', value: 'limited' } }, disclosure: { perContext: {} } }],
      circles: [], releases: {},
    });
    const a = bare.general.properties.find((p) => p.key === 'availability');
    // display ladder now ends state → detail → ∅ (the descriptor's finest rung is surfaced)
    expect(a.ladder).toEqual(['state', 'detail', 'none']);
    expect(a).toMatchObject({ whenField: true, when: null });   // no when yet

    // a structured { state, when } value: state still drives the row value; the when is exposed
    const rich = buildMijViewModel({
      personas: [{ id: 'default', name: 'default', properties: { availability: { mode: 'own', value: { state: 'limited', when: 'weekends' } } }, disclosure: { perContext: {} } }],
      circles: [], releases: {},
    });
    const r = rich.general.properties.find((p) => p.key === 'availability');
    expect(r).toMatchObject({ key: 'availability', value: 'limited', set: true, whenField: true, when: 'weekends' });
  });

  it('availability polish 2 — carries the value-l10n hint onto persona cards + released rows', () => {
    const personas = [{
      id: 'default', name: 'default',
      properties: { availability: { mode: 'own', value: 'away' } },
      disclosure: { perContext: { 'circle-1': { availability: { enabled: true, rung: 'state' } } } },
    }];
    const releases = { default: { 'circle-1': { availability: 'away' } } };
    const m = buildMijViewModel({ personas, circles: mijCircles, releases });
    // section 2: the persona card entry for availability carries the l10n prefix so the shell
    // localises the raw token; the value stays the token (localisation happens in the shell).
    const card = m.personas.find((p) => p.id === 'default');
    const entry = card.entries.find((e) => e.key === 'availability');
    expect(entry).toMatchObject({ key: 'availability', value: 'away', l10n: 'circle.mij.availability' });
    // a non-l10n key (place) carries a null hint → rendered raw
    expect(card.entries.find((e) => e.key === 'place').l10n).toBe(null);
    // section 3: the per-circle released row also carries the hint
    const row = m.circles.find((c) => c.circleId === 'circle-1').rows.find((rr) => rr.key === 'availability');
    expect(row).toMatchObject({ key: 'availability', released: 'away', l10n: 'circle.mij.availability' });
  });

  it('interests fold-in — an interest-kind driver shows as a general chip (audit §4/Q6)', () => {
    const personas = [{
      id: 'default', name: 'default',
      properties: { interests: { mode: 'own', value: { kind: 'interest', text: '', tags: ['zeilen', 'houtbewerking'] } } },
      disclosure: { perContext: {} },
    }];
    const m = buildMijViewModel({ personas, circles: mijCircles, releases: {} });
    // interests are FREE drivers → a chip, not a coarse property row
    expect(m.general.properties.find((p) => p.key === 'interests')).toBeUndefined();
    const chip = m.general.drivers.find((d) => d.key === 'interests');
    expect(chip).toMatchObject({ key: 'interests', kind: 'interest', text: '', tags: ['zeilen', 'houtbewerking'] });
    expect(chip.categoryId).toBeUndefined();   // no taxonomy / coarse rung for interests
    // shareable per circle like any driver (disclosure-controlled)
    expect(m.circles.find((c) => c.circleId === 'circle-1').addable).toContain('interests');
  });

  it('renders location as a folded-in coarse place property row (audit §4)', () => {
    // a location value on the default profile surfaces as a general property row: an
    // OPEN coarse label (free-text like place) with the design's canonical ladder.
    const personas = [{
      id: 'default', name: 'default',
      properties: { location: { mode: 'own', value: 'Amsterdam' } },
      disclosure: { perContext: {} },
    }];
    const m = buildMijViewModel({ personas, circles: mijCircles, releases: {} });
    const loc = m.general.properties.find((p) => p.key === 'location');
    expect(loc).toMatchObject({ key: 'location', value: 'Amsterdam', free: true, set: true, buckets: null });
    // finest→coarsest display ladder ending in ∅ (coords → district → … → in-area → none)
    expect(loc.ladder).toEqual(['coords', 'district', 'municipality', 'region', 'in-area', 'none']);
    // it is shareable per circle like any valued property (disclosure-controlled)
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    expect(c1.addable).toContain('location');
  });

  it('accepts a structured location value and shows its coarse label', () => {
    const personas = [{
      id: 'default', name: 'default',
      properties: { location: { mode: 'own', value: { label: 'Amsterdam', coords: { lat: 52.3, long: 4.9 } } } },
      disclosure: { perContext: {} },
    }];
    const m = buildMijViewModel({ personas, circles: [], releases: {} });
    const loc = m.general.properties.find((p) => p.key === 'location');
    expect(loc).toMatchObject({ key: 'location', value: 'Amsterdam', set: true });   // label, not raw coords
  });

  it('location is absent (unset) when the profile has no value', () => {
    const m = buildMijViewModel({ personas: mijPersonas, circles: mijCircles, releases: mijReleases });
    const loc = m.general.properties.find((p) => p.key === 'location');
    expect(loc).toMatchObject({ key: 'location', value: null, set: false });
    const c1 = m.circles.find((c) => c.circleId === 'circle-1');
    expect(c1.addable).not.toContain('location');
  });
});

describe('renderMij', () => {
  const build = () => buildMijViewModel({ personas: mijPersonas, circles: mijCircles, releases: mijReleases });
  // Param-echoing t(): "<key> <param values>" — lets assertions see interpolated
  // content (ladder rungs, charter rungs) without pinning real copy.
  const t = (k, v) => {
    if (!v || typeof v !== 'object') return k;
    const vals = Object.entries(v).filter(([kk]) => kk !== 'defaultValue').map(([, vv]) => String(vv)).join(' ');
    return vals ? `${k} ${vals}` : k;
  };

  it('renders the three bulletin sections', () => {
    const el = renderMij(document.createElement('div'), { model: build(), t });
    const eyebrows = [...el.querySelectorAll('.cc-mij__eyebrow')].map((e) => e.textContent);
    expect(eyebrows).toEqual(['circle.mij.general_eyebrow', 'circle.mij.personas_eyebrow', 'circle.mij.circles_eyebrow']);
    expect(el.querySelectorAll('.cc-mij__section')).toHaveLength(3);
    // section 1: a property row with a ladder hint, and the skill chip
    const placeRow = el.querySelector('.cc-mij__row[data-key="place"]');
    expect(placeRow.querySelector('.cc-mij__value-btn').textContent).toBe('Amsterdam');
    expect(placeRow.querySelector('.cc-mij__ladder').textContent).toContain('circle.mij.rung.municipality');
    const chip = el.querySelector('.cc-mij__chip');
    expect(chip.querySelector('.cc-mij__chip-text').textContent).toBe('leren zeilen');
    expect([...chip.querySelectorAll('.cc-mij__chip-tag')].map((x) => x.textContent)).toEqual(['zeilen', 'water']);
    expect(chip.querySelector('.cc-mij__chip-badge').textContent).toContain('circle.mij.approx');
    // section 2: the root card is marked; the werk card shows OWN + follows-general
    const root = el.querySelector('.cc-mij__card--root');
    expect(root.dataset.personaId).toBe('default');
    expect(root.querySelector('.cc-mij__card-tag').textContent).toBe('circle.mij.truth_tag');
    const werk = el.querySelector('.cc-mij__card[data-persona-id="werk"]');
    expect(werk.querySelector('.cc-mij__entry[data-key="place"] .cc-mij__own-mark').textContent).toBe('circle.mij.own_mark');
    expect(werk.querySelector('.cc-mij__entry[data-key="place"] .cc-mij__own-value').textContent).toBe('Utrecht');
    expect(werk.querySelector('.cc-mij__entry[data-key="ageBand"] .cc-mij__inherit')).toBeTruthy();
    expect(werk.querySelector('.cc-mij__entry[data-key="role"] .cc-mij__absent')).toBeTruthy();
    // section 3: the released value + the charter cell
    const row = el.querySelector('.cc-mij__table tr[data-circle-id="circle-1"][data-key="place"]');
    expect(row.querySelector('.cc-mij__cell-released').textContent).toBe('Amsterdam');
    expect(row.querySelector('.cc-mij__cell-charter').textContent).toContain('circle.mij.rung.municipality');
  });

  it('adds a skill through the dashed inline form (text + tags)', () => {
    const onAddOffering = vi.fn();
    const el = renderMij(document.createElement('div'), { model: build(), t, onAddOffering });
    el.querySelector('.cc-mij__add').click();
    const form = el.querySelector('.cc-mij__form');
    const [text, tags] = form.querySelectorAll('.cc-mij__input');
    text.value = 'banden plakken';
    tags.value = 'fiets, repareren';
    form.querySelector('.cc-btn--primary').click();
    expect(onAddOffering).toHaveBeenCalledWith({ text: 'banden plakken', tags: 'fiets, repareren' });
  });

  it('edits a general property and toggles disclosure from the circle table', () => {
    const onSetProperty = vi.fn();
    const onToggleDisclosure = vi.fn();
    const el = renderMij(document.createElement('div'), { model: build(), t, onSetProperty, onToggleDisclosure });
    // bucket edit: open the ageBand editor, pick another bucket
    const ageRow = el.querySelector('.cc-mij__row[data-key="ageBand"]');
    ageRow.querySelector('.cc-mij__value-btn').click();
    const other = [...ageRow.querySelectorAll('.cc-mij__editor .cc-btn')].find((b) => b.textContent === '18-34');
    other.click();
    expect(onSetProperty).toHaveBeenCalledWith('ageBand', '18-34');
    // withdraw a share (×) → disable for THAT persona
    el.querySelector('.cc-mij__table tr[data-circle-id="circle-2"] .cc-mij__row-remove').click();
    expect(onToggleDisclosure).toHaveBeenCalledWith('circle-2', 'place', false, 'werk');
    // dashed opt-up affordance → enable for the default persona
    const c1Add = [...el.querySelectorAll('tr[data-circle-id="circle-1"] .cc-mij__add-share')][0];
    c1Add.click();
    const keyBtn = [...el.querySelectorAll('tr[data-circle-id="circle-1"] .cc-mij__form .cc-btn')]
      .find((b) => b.textContent === 'circle.aboutme.key.ageBand');
    keyBtn.click();
    expect(onToggleDisclosure).toHaveBeenCalledWith('circle-1', 'ageBand', true, 'default');
  });

  it('creates a persona through the dashed card, and disables it without the callback', () => {
    const onCreatePersona = vi.fn();
    const el = renderMij(document.createElement('div'), { model: build(), t, onCreatePersona });
    el.querySelector('.cc-mij__add-card').click();
    const form = el.querySelector('.cc-mij__grid .cc-mij__form');
    form.querySelector('.cc-mij__input').value = 'spel';
    form.querySelector('.cc-btn--primary').click();
    expect(onCreatePersona).toHaveBeenCalledWith('spel');
    const el2 = renderMij(document.createElement('div'), { model: build(), t });
    expect(el2.querySelector('.cc-mij__add-card').disabled).toBe(true);
  });

  it('renders clean empty states (not-ok model, no circles)', () => {
    const bad = renderMij(document.createElement('div'), { model: buildMijViewModel({ personas: [] }), t });
    expect(bad.querySelector('.cc-mij__empty-note').textContent).toBe('circle.mij.unavailable');
    const noCircles = renderMij(document.createElement('div'), {
      model: buildMijViewModel({ personas: mijPersonas, circles: [] }), t,
    });
    expect(noCircles.querySelectorAll('.cc-mij__section')).toHaveLength(3);
    expect(noCircles.querySelector('.cc-mij__empty-note').textContent).toBe('circle.mij.no_circles');
  });
});
